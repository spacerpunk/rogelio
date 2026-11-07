import sharp from "sharp";
import { z } from "zod";
import { getTextEngine, listVideoEngines } from "@/lib/engines/registry";
import type { JobContext } from "@/lib/jobs/types";
import { downloadBuffer } from "@/lib/storage";
import { activeTextContent } from "./context";
import { imageSettings, loadShotContext } from "./frames";
import { buildImagePromptInput, imagePromptSchema } from "./prompts";
import { referencesKey, type ReferenceTarget } from "./references";
import { buildVideoPromptInput, getVideoEngineMaxSec, loadVideoShotContext, videoSettings } from "./video";

const REVIEW_MAX_SIDE = 1536;

export const promptEditPayloadSchema = z.object({
  shotId: z.uuid(),
  target: z.enum(["image", "video"]),
  instruction: z.string().trim().min(1).max(4000),
  engine: z.string(),
  /** Lo que hay en el editor en el momento del pedido (puede no estar guardado todavía). */
  prompt: z.string(),
  negative: z.string().nullable(),
  seconds: z.number().nullable().optional(),
  /** Variante que el productor está mirando: el motor de texto la ve para entender qué corregir. */
  frameId: z.uuid().nullable().optional(),
});
export type PromptEditPayload = z.infer<typeof promptEditPayloadSchema>;

/** Resultado del trabajo: una propuesta que el productor aplica o descarta. */
export type PromptEditResult = {
  state: "proposed" | "applied" | "dismissed";
  target: ReferenceTarget;
  instruction: string;
  prompt: string;
  negative: string | null;
  seconds: number | null;
  /** Qué cambió, en castellano. */
  changes: string;
  referencesKey: string;
  /** Video: el frame aprobado que miró el motor (el prompt queda escrito para ese frame). */
  frameId: string | null;
};

const imageEditSchema = imagePromptSchema.extend({ changes: z.string() });
const videoEditSchema = z.object({ prompt: z.string(), avoid: z.string(), generate_seconds: z.number(), changes: z.string() });

async function forReview(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize({ width: REVIEW_MAX_SIDE, height: REVIEW_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

function editRequest(instruction: string, current: string[], returnSpec: string[]): string {
  return [
    "",
    "=== EDIT REQUEST ===",
    "The prompt below was already written for this shot. The producer reviewed the result and asks for a change.",
    ...current,
    "",
    `Producer's request (Spanish): «${instruction}»`,
    "",
    "Rewrite the prompt applying that change and keep everything else as it is (same structure, same rules of the system prompt,",
    "same characters, PPE and continuity) unless the change requires touching it. If the request contradicts a hard rule of the",
    "system prompt (PPE, safety, likeness), keep the rule and explain it in changes.",
    "",
    "Return JSON:",
    ...returnSpec,
    '- changes: in Spanish, one or two short lines saying what you changed (and anything you could not change, and why).',
  ].join("\n");
}

/** Reescribe el prompt de imagen de un plano según el pedido del productor. */
async function editImagePrompt(job: JobContext, payload: PromptEditPayload): Promise<PromptEditResult> {
  const { db } = job;
  const ctx = await loadShotContext(db, payload.shotId);
  const clientId = ctx.project.client_id;
  const [system, clientNegative] = await Promise.all([
    activeTextContent(db, clientId, "image_system_prompt"),
    activeTextContent(db, clientId, "negative_prompt"),
  ]);
  if (!system) throw new Error("El cliente no tiene un system prompt de imagen activo (biblioteca → Textos).");

  let frameBlock: { type: "image"; data: Buffer; mimeType: string } | null = null;
  if (payload.frameId) {
    const { data: frame } = await db.from("frames").select("storage_path").eq("id", payload.frameId).eq("shot_id", ctx.shot.id).maybeSingle();
    if (frame) frameBlock = { type: "image", data: await forReview(await downloadBuffer(db, "projects", frame.storage_path)), mimeType: "image/jpeg" };
  }

  const brief = buildImagePromptInput({
    shot: ctx.shot,
    characters: ctx.characters,
    location: ctx.location,
    aspectRatio: ctx.project.aspect_ratio,
    engine: payload.engine,
    model: imageSettings(ctx.project, payload.engine).model,
    imageSize: ctx.project.image_size,
    clientNegative,
    referenceLabels: ctx.references.map((r) => r.label),
  });
  const text = getTextEngine(ctx.project.text_engine);
  const result = await job.track(text, "image_prompt_edit", () =>
    text.structured(
      {
        system,
        content: [
          ...(frameBlock ? [frameBlock] : []),
          {
            type: "text" as const,
            text: [
              brief,
              editRequest(
                payload.instruction,
                [
                  frameBlock ? "Attached: the variant the producer is looking at, generated with the current prompt." : "",
                  `CURRENT FINAL PROMPT:\n${payload.prompt}`,
                  `CURRENT NEGATIVE:\n${payload.negative ?? "(none)"}`,
                ].filter(Boolean),
                [
                  "- final_prompt: the full rewritten FINAL PROMPT ready to paste.",
                  "- negative: the full NEGATIVE / AVOID line (keep the client standard negative).",
                  '- ppe_check: the PPE CHECK line (or "n/a"). assumptions: the ASSUMPTIONS line.',
                ],
              ),
            ].join("\n"),
          },
        ],
        maxTokens: 16_000,
        effort: "medium",
        cacheSystem: true,
      },
      imageEditSchema,
    ),
  );
  return {
    state: "proposed",
    target: "image",
    instruction: payload.instruction,
    prompt: result.data.final_prompt.trim(),
    negative: result.data.negative.trim() || clientNegative,
    seconds: null,
    changes: result.data.changes.trim(),
    referencesKey: referencesKey(ctx.references),
    frameId: null,
  };
}

/** Reescribe el prompt de video de un plano mirando el frame aprobado, según el pedido del productor. */
async function editVideoPrompt(job: JobContext, payload: PromptEditPayload): Promise<PromptEditResult> {
  const { db } = job;
  const ctx = await loadVideoShotContext(db, payload.shotId);
  if (!ctx.frame) throw new Error(`El plano ${ctx.shot.order_index + 1} no tiene frame aprobado: aprobá una imagen en Frames.`);
  const system = await activeTextContent(db, ctx.project.client_id, "video_system_prompt");
  if (!system) throw new Error("El cliente no tiene un system prompt de video activo (Settings o biblioteca → Textos).");

  const engineInfo = listVideoEngines().find((e) => e.name === payload.engine);
  const maxSec = getVideoEngineMaxSec(payload.engine);
  const frame = await forReview(await downloadBuffer(db, "projects", ctx.frame.storage_path));
  const text = getTextEngine(ctx.project.text_engine);
  const result = await job.track(text, "video_prompt_edit", () =>
    text.structured(
      {
        system,
        content: [
          { type: "image", data: frame, mimeType: "image/jpeg" },
          {
            type: "text",
            text: [
              buildVideoPromptInput(ctx, {
                engine: payload.engine,
                model: videoSettings(ctx.project, payload.engine).model ?? engineInfo?.model ?? null,
                maxSec,
                outputSpec: false,
              }),
              editRequest(
                payload.instruction,
                [
                  "Attached: the approved first frame of this shot.",
                  `CURRENT PROMPT:\n${payload.prompt}`,
                  `CURRENT AVOID:\n${payload.negative ?? "(none)"}`,
                  `CURRENT SECONDS TO GENERATE: ${payload.seconds ?? "not set"}`,
                ],
                [
                  "- prompt: the full rewritten Prompt in English, WITHOUT the final Avoid sentence.",
                  '- avoid: the Avoid line, comma-separated, without the "Avoid:" prefix.',
                  `- generate_seconds: seconds to generate (integer, between 4 and ${maxSec}).`,
                ],
              ),
            ].join("\n"),
          },
        ],
        maxTokens: 16_000,
        effort: "medium",
        cacheSystem: true,
      },
      videoEditSchema,
    ),
  );
  return {
    state: "proposed",
    target: "video",
    instruction: payload.instruction,
    prompt: result.data.prompt.trim(),
    negative: result.data.avoid.trim().replace(/^avoid:\s*/i, "") || null,
    seconds: Math.min(maxSec, Math.max(4, Math.round(result.data.generate_seconds || 4))),
    changes: result.data.changes.trim(),
    referencesKey: referencesKey(ctx.videoReferences),
    frameId: ctx.frame.id,
  };
}

export async function editPrompt(job: JobContext, payload: PromptEditPayload): Promise<PromptEditResult> {
  await job.progress(0, 1, "Reescribiendo el prompt");
  return payload.target === "image" ? editImagePrompt(job, payload) : editVideoPrompt(job, payload);
}
