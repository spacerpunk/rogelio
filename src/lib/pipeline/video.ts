import sharp from "sharp";
import { z } from "zod";
import { defaultVideoEngineName, getTextEngine, getVideoEngine, listVideoEngines } from "@/lib/engines/registry";
import type { AspectRatio, VideoResolution } from "@/lib/engines/types";
import { locationLabel } from "@/lib/library/locations";
import type { Db, JobContext } from "@/lib/jobs/types";
import { downloadBuffer } from "@/lib/storage";
import type { Database } from "@/lib/supabase/database.types";
import { activeTextContent } from "./context";
import { assertConsent, loadShotContext, type ShotContext } from "./frames";
import { SHOT_LIBRARY } from "./prompts";
import { loadReferenceBuffers, referencesKey, referencesUsed, resolveShotReferences, type ReferenceAsset } from "./references";
import { FRAMING_LABEL } from "./shotlist";

type FrameRow = Database["public"]["Tables"]["frames"]["Row"];

/** Mínimo de segundos a generar: lo esencial tiene que pasar dentro del tramo útil (system prompt de video). */
const VIDEO_MIN_SEC = 4;
const FRAME_MAX_SIDE = 1536;

const TARGET_MODEL: Record<string, string> = {
  gemini: "Gemini Omni (Flash)",
};

export const videoPromptSchema = z.object({
  frame_qa: z.string(),
  camera: z.string(),
  prompt: z.string(),
  avoid: z.string(),
  generate_seconds: z.number(),
  trim_seconds: z.number(),
  continuity: z.string(),
  notes: z.string(),
});
export type VideoPromptOutput = z.infer<typeof videoPromptSchema>;

/** videoReferences: lo que acompaña al primer frame (sheets automáticas y extras del plano). */
export type VideoShotContext = ShotContext & { frame: FrameRow | null; videoReferences: ReferenceAsset[] };

export async function loadVideoShotContext(db: Db, shotId: string): Promise<VideoShotContext> {
  const ctx = await loadShotContext(db, shotId);
  const [{ data: frame }, videoReferences] = await Promise.all([
    db.from("frames").select("*").eq("shot_id", shotId).eq("selected", true).is("deleted_at", null).maybeSingle(),
    resolveShotReferences(db, ctx.project.client_id, ctx.shot, ctx.characters, ctx.location, "video"),
  ]);
  return { ...ctx, frame, videoReferences };
}

/** Motor y modelo de video del proyecto. El modelo guardado solo vale para el motor al que pertenece. */
export function videoSettings(project: ShotContext["project"], engineName: string) {
  const savedModel = (project.video_engine ?? defaultVideoEngineName()) === engineName ? project.video_model : null;
  return {
    savedModel,
    model: savedModel ?? listVideoEngines().find((e) => e.name === engineName)?.model ?? null,
    resolution: project.video_resolution as VideoResolution,
  };
}

/** Número visible del plano (S01, S02…), el mismo que ve el productor en la UI. */
function shotId(ctx: ShotContext): string {
  return `S${String(ctx.shot.order_index + 1).padStart(2, "0")}`;
}

/** Input para el motor de texto con el video system prompt del cliente como system. */
export function buildVideoPromptInput(
  ctx: VideoShotContext,
  opts: { engine: string; model: string | null; maxSec: number; /** false: sin el formato de salida (la edición pide el suyo). */ outputSpec?: boolean },
): string {
  const { shot, project, characters, location } = ctx;
  const editSec = Math.round(Number(shot.est_duration_sec ?? 4));
  return [
    `Shot ID: ${shotId(ctx)} · Escena ${shot.scene_number}${shot.scene_title ? ` — ${shot.scene_title}` : ""}`,
    `Target model: ${TARGET_MODEL[opts.engine] ?? opts.engine}${opts.model ? ` (${opts.model})` : ""}. Maximum ${opts.maxSec} s per clip.`,
    `Aspect ratio: ${project.aspect_ratio} · Resolution: ${project.video_resolution}`,
    `Logo mode for this project: ${project.video_logo ? "[logo:on]" : "[logo:off]"}`,
    "Audio: ambient only (the narration is added later), unless the idea says a character speaks.",
    `Idea (Spanish): ${shot.action ?? "(none)"}`,
    shot.vo_line ? `Voice-over line (narration added in post, not spoken on screen): «${shot.vo_line}»` : "Voice-over: none",
    `Useful duration in the edit: about ${editSec} s (from the voice-over). Generate a little longer to trim, between ${VIDEO_MIN_SEC} and ${opts.maxSec} s.`,
    `Shot type in the shot list: ${SHOT_LIBRARY[shot.framing]} (${FRAMING_LABEL[shot.framing]})`,
    shot.lighting ? `Lighting: ${shot.lighting}` : "",
    shot.on_screen_text ? `On-screen text in the edit (added in post, not in the clip): "${shot.on_screen_text}"` : "",
    characters.length
      ? `Characters in frame (names only for "Entradas"; inside the prompt use the CAST TABLE labels):\n${characters
          .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}${c.visual_notes ? `: ${c.visual_notes}` : ""}`)
          .join("\n")}`
      : "Characters in frame: none",
    location ? `Location: ${locationLabel(location)}: ${location.description ?? ""}` : "Location: as seen in the frame",
    ctx.frame?.review_notes ? `Production review note on this frame: ${ctx.frame.review_notes}` : "",
    "",
    "Attached to this message: the approved first frame of this shot. Run the FRAME QA on it before writing the prompt.",
    `The video model receives, in this order: Image 1 = the approved first frame${ctx.videoReferences
      .map((ref, i) => `; Image ${i + 2} = ${ref.label}`)
      .join("")}.`,
    ...(opts.outputSpec === false ? [] : videoOutputSpec()),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function videoOutputSpec(): string[] {
  return [
    "",
    "Instead of the Markdown OUTPUT FORMAT, return JSON with these fields:",
    '- frame_qa: the "Correcciones antes de animar" in Spanish, one line per real problem (with inpaint / regenerate / accept); empty string if the frame is fine.',
    '- camera: "plano y movimiento" in Spanish, e.g. "Plano medio · Fijo".',
    "- prompt: the full Prompt in English, following the PROMPT ASSEMBLY ORDER, WITHOUT the final Avoid sentence (it is appended automatically from avoid).",
    '- avoid: the Avoid line (standard line + clip-specific additions), comma-separated, without the "Avoid:" prefix.',
    "- generate_seconds: seconds to generate (integer). trim_seconds: seconds to keep after trimming.",
    '- continuity: the "Continuidad" line in Spanish. notes: the "Nota" line in Spanish, or empty string.',
  ];
}

/** El primer frame achicado (máx. 1536 px) para que el motor de texto lo revise. */
async function frameForReview(frame: Buffer): Promise<Buffer> {
  return sharp(frame)
    .resize({ width: FRAME_MAX_SIDE, height: FRAME_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}


/**
 * El motor de texto del proyecto escribe el prompt de video mirando el frame aprobado, con el video system prompt
 * activo del cliente como system: prompt, Avoid, segundos a generar y correcciones antes de animar.
 */
export async function generateVideoPromptForShot(job: JobContext, ctx: VideoShotContext, engineName: string): Promise<void> {
  const { db } = job;
  if (!ctx.frame) throw new Error(`El plano ${ctx.shot.order_index + 1} no tiene frame aprobado: aprobá una imagen en Frames.`);
  const system = await activeTextContent(db, ctx.project.client_id, "video_system_prompt");
  if (!system) throw new Error("El cliente no tiene un system prompt de video activo (Settings o biblioteca → Textos).");

  const engineInfo = listVideoEngines().find((e) => e.name === engineName);
  const maxSec = getVideoEngineMaxSec(engineName);
  const frame = await frameForReview(await downloadBuffer(db, "projects", ctx.frame.storage_path));

  const text = getTextEngine(ctx.project.text_engine);
  const result = await job.track(text, "video_prompt", () =>
    text.structured(
      {
        system,
        content: [
          { type: "image", data: frame, mimeType: "image/jpeg" },
          {
            type: "text",
            text: buildVideoPromptInput(ctx, {
              engine: engineName,
              model: videoSettings(ctx.project, engineName).model ?? engineInfo?.model ?? null,
              maxSec,
            }),
          },
        ],
        maxTokens: 16_000,
        effort: "medium",
        cacheSystem: true,
      },
      videoPromptSchema,
    ),
  );

  const data = result.data;
  const seconds = Math.min(maxSec, Math.max(VIDEO_MIN_SEC, Math.round(data.generate_seconds || VIDEO_MIN_SEC)));
  const notes = [
    data.camera.trim() && `Plano: ${data.camera.trim()} · generar ${seconds} s, recortar a ${Math.round(data.trim_seconds) || seconds} s`,
    data.continuity.trim() && `Continuidad: ${data.continuity.trim()}`,
    data.notes.trim() && `Nota: ${data.notes.trim()}`,
  ].filter(Boolean);
  const qa = [data.frame_qa.trim(), ...notes].filter(Boolean).join("\n");

  const patch = {
    video_prompt: data.prompt.trim(),
    video_negative: data.avoid.trim().replace(/^avoid:\s*/i, "") || null,
    video_duration_sec: seconds,
    video_qa_notes: qa || null,
    video_prompt_frame_id: ctx.frame.id,
    video_prompt_references_key: referencesKey(ctx.videoReferences),
    video_prompt_generated_at: new Date().toISOString(),
  };
  const { error } = await db.from("shots").update(patch).eq("id", ctx.shot.id);
  if (error) throw new Error(`No se pudo guardar el prompt de video: ${error.message}`);
  Object.assign(ctx.shot, patch);
}

export function getVideoEngineMaxSec(engineName: string): number {
  // Sin instanciar el motor (no hace falta la clave para escribir el prompt): los límites conocidos por motor.
  return { gemini: 10 }[engineName] ?? 10;
}

/** Genera N variantes de clip desde el frame aprobado, con el prompt de video del plano. */
export async function generateClipsForShot(job: JobContext, ctx: VideoShotContext, engineName: string, n: number): Promise<number> {
  const { db } = job;
  assertConsent(ctx);
  if (!ctx.frame) throw new Error(`El plano ${ctx.shot.order_index + 1} no tiene frame aprobado: aprobá una imagen en Frames.`);
  // Sin prompt, o escrito para otro frame: se escribe de nuevo mirando el frame aprobado actual.
  if (!ctx.shot.video_prompt?.trim() || ctx.shot.video_prompt_frame_id !== ctx.frame.id) {
    await generateVideoPromptForShot(job, ctx, engineName);
  }

  const settings = videoSettings(ctx.project, engineName);
  const engine = getVideoEngine(engineName, settings.savedModel);
  const [firstFrame, references] = await Promise.all([
    downloadBuffer(db, "projects", ctx.frame.storage_path),
    loadReferenceBuffers(db, ctx.videoReferences),
  ]);
  const durationSec = Math.min(engine.maxDurationSec, Number(ctx.shot.video_duration_sec ?? ctx.shot.est_duration_sec ?? VIDEO_MIN_SEC));
  const request = {
    prompt: ctx.shot.video_prompt!,
    negative: ctx.shot.video_negative ?? undefined,
    firstFrame,
    references,
    aspectRatio: ctx.project.aspect_ratio as AspectRatio,
    resolution: settings.resolution,
    durationSec,
  };

  const { data: last } = await db
    .from("clips")
    .select("variant_index")
    .eq("shot_id", ctx.shot.id)
    .order("variant_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let variant = last?.variant_index ?? 0;

  // Cada variante es una llamada: se piden en paralelo y se guardan las que salen aunque otra falle.
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => job.track(engine, "generate_clips", () => engine.generate(request))),
  );
  let saved = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const clip = result.value;
    const clipId = crypto.randomUUID();
    const path = `${ctx.project.id}/clips/${ctx.shot.id}/${clipId}.mp4`;
    const { error: uploadError } = await db.storage.from("projects").upload(path, clip.video, { contentType: clip.mimeType });
    if (uploadError) throw new Error(`No se pudo guardar el clip: ${uploadError.message}`);
    const { error } = await db.from("clips").insert({
      id: clipId,
      shot_id: ctx.shot.id,
      frame_id: ctx.frame.id,
      variant_index: ++variant,
      engine: engine.name,
      model: clip.model,
      video_path: path,
      duration_sec: clip.durationSec,
      prompt_used: request.prompt,
      negative_used: request.negative ?? null,
      resolution: request.resolution,
      aspect_ratio: request.aspectRatio,
      references_used: referencesUsed(ctx.videoReferences),
      cost_usd: clip.costUsd,
      job_id: job.job.id,
    });
    if (error) throw new Error(`No se pudo registrar el clip: ${error.message}`);
    saved++;
  }

  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === results.length) throw failed[0].reason;
  if (failed.length) {
    const reason = failed[0].reason instanceof Error ? failed[0].reason.message : String(failed[0].reason);
    throw new Error(`Se guardaron ${saved} de ${n} variantes. Las demás fallaron: ${reason}`);
  }
  return saved;
}
