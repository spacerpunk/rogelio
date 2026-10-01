import { defaultImageEngineName, getImageEngine, getTextEngine, listImageEngines } from "@/lib/engines/registry";
import { EngineError } from "@/lib/engines/types";
import type { AspectRatio, ImageSize } from "@/lib/engines/types";
import type { Db, JobContext } from "@/lib/jobs/types";
import { ensureThumbnail } from "@/lib/storage";
import type { Database } from "@/lib/supabase/database.types";
import { activeTextContent } from "./context";
import { buildImagePromptInput, buildVideoPromptInput, imagePromptSchema, shotPromptHash, type PromptShotInput } from "./prompts";
import { loadReferenceBuffers, resolveShotReferences, type ReferenceAsset } from "./references";

type Tables = Database["public"]["Tables"];

export type ShotContext = {
  shot: Tables["shots"]["Row"];
  project: Tables["projects"]["Row"];
  characters: Tables["characters"]["Row"][];
  location: Tables["locations"]["Row"] | null;
  references: ReferenceAsset[];
};

export async function loadShotContext(db: Db, shotId: string): Promise<ShotContext> {
  const { data: shot } = await db.from("shots").select("*").eq("id", shotId).is("deleted_at", null).single();
  if (!shot) throw new Error("No encontré el plano (¿se borró o se regeneró el shot list?).");
  const { data: project } = await db.from("projects").select("*").eq("id", shot.project_id).single();
  if (!project) throw new Error("No encontré el proyecto.");

  const [characters, location] = await Promise.all([
    shot.character_ids.length
      ? db.from("characters").select("*").in("id", shot.character_ids).is("deleted_at", null)
      : Promise.resolve({ data: [] as Tables["characters"]["Row"][] }),
    shot.location_id
      ? db.from("locations").select("*").eq("id", shot.location_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  // Mismo orden que en el plano.
  const ordered = shot.character_ids.flatMap((id) => (characters.data ?? []).filter((c) => c.id === id));
  const references = await resolveShotReferences(db, project.client_id, ordered, location.data ?? null);
  return { shot, project, characters: ordered, location: location.data ?? null, references };
}

/**
 * Ajustes de imagen del proyecto para un motor. El modelo guardado solo vale para el motor al que pertenece;
 * con otro motor se usa el default de ese motor. model: el id efectivo (null si el motor no está configurado).
 */
export function imageSettings(project: ShotContext["project"], engineName: string) {
  const savedModel = (project.image_engine ?? defaultImageEngineName()) === engineName ? project.image_model : null;
  return {
    savedModel,
    model: savedModel ?? listImageEngines().find((e) => e.name === engineName)?.model ?? null,
    size: project.image_size as ImageSize,
  };
}

/** Personajes basados en personas reales sin consentimiento confirmado: no se generan frames con ellos. */
export function assertConsent(ctx: ShotContext) {
  const missing = ctx.characters.filter((c) => c.based_on_real_person && !c.consent_confirmed);
  if (missing.length) {
    throw new EngineError(
      "config",
      `Falta confirmar el consentimiento de ${missing.map((c) => c.name).join(", ")} (persona real). Confirmalo en la biblioteca del cliente.`,
      "likeness",
    );
  }
}

/** El motor de texto del proyecto escribe image_prompt e image_negative (image system prompt) y un borrador de video_prompt. */
export async function generatePromptsForShot(job: JobContext, ctx: ShotContext, engineName: string): Promise<void> {
  const { db } = job;
  const clientId = ctx.project.client_id;
  const [imageSystem, videoSystem, clientNegative] = await Promise.all([
    activeTextContent(db, clientId, "image_system_prompt"),
    activeTextContent(db, clientId, "video_system_prompt"),
    activeTextContent(db, clientId, "negative_prompt"),
  ]);
  if (!imageSystem) throw new Error("El cliente no tiene un system prompt de imagen activo (biblioteca → Textos).");

  const input: PromptShotInput = {
    shot: ctx.shot,
    characters: ctx.characters,
    location: ctx.location,
    aspectRatio: ctx.project.aspect_ratio,
    engine: engineName,
    model: imageSettings(ctx.project, engineName).model,
    imageSize: ctx.project.image_size,
    clientNegative,
    referenceLabels: ctx.references.map((r) => r.label),
  };

  const text = getTextEngine(ctx.project.text_engine);
  const image = await job.track(text, "image_prompt", () =>
    text.structured(
      { system: imageSystem, content: buildImagePromptInput(input), maxTokens: 16_000, effort: "medium", cacheSystem: true },
      imagePromptSchema,
    ),
  );

  let videoPrompt: string | null = ctx.shot.video_prompt;
  if (videoSystem) {
    const video = await job.track(text, "video_prompt", () =>
      text.complete({
        system: videoSystem,
        content: buildVideoPromptInput({ ...input, imagePrompt: image.data.final_prompt }),
        maxTokens: 16_000,
        effort: "low",
        cacheSystem: true,
      }),
    );
    videoPrompt = video.text;
  }

  const { error } = await db
    .from("shots")
    .update({
      image_prompt: image.data.final_prompt.trim(),
      image_negative: image.data.negative.trim() || clientNegative,
      video_prompt: videoPrompt,
      prompt_inputs_hash: shotPromptHash(ctx.shot),
      prompts_generated_at: new Date().toISOString(),
    })
    .eq("id", ctx.shot.id);
  if (error) throw new Error(`No se pudo guardar el prompt: ${error.message}`);
  ctx.shot.image_prompt = image.data.final_prompt.trim();
  ctx.shot.image_negative = image.data.negative.trim() || clientNegative;
}

/** Genera N variantes con el motor elegido, con las referencias de la biblioteca adjuntas. */
export async function generateFramesForShot(job: JobContext, ctx: ShotContext, engineName: string, n: number): Promise<number> {
  const { db } = job;
  assertConsent(ctx);
  if (ctx.shot.status === "draft") throw new Error(`El plano ${ctx.shot.order_index + 1} no está aprobado: aprobá el shot list primero.`);
  if (!ctx.shot.image_prompt?.trim()) await generatePromptsForShot(job, ctx, engineName);

  const settings = imageSettings(ctx.project, engineName);
  const engine = getImageEngine(engineName, settings.savedModel);
  const references = await loadReferenceBuffers(db, ctx.references);
  const result = await job.track(engine, "generate_frames", () =>
    engine.generate({
      prompt: ctx.shot.image_prompt!,
      negative: ctx.shot.image_negative ?? undefined,
      references,
      aspectRatio: ctx.project.aspect_ratio as AspectRatio,
      size: settings.size,
      n,
    }),
  );

  const { data: last } = await db
    .from("frames")
    .select("variant_index")
    .eq("shot_id", ctx.shot.id)
    .order("variant_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let variant = (last?.variant_index ?? 0) + 1;
  const costEach = result.costUsd / Math.max(1, result.images.length);

  for (const image of result.images) {
    const frameId = crypto.randomUUID();
    const path = `${ctx.project.id}/frames/${ctx.shot.id}/${frameId}.png`;
    const { error: uploadError } = await db.storage.from("projects").upload(path, image, { contentType: "image/png" });
    if (uploadError) throw new Error(`No se pudo guardar el frame: ${uploadError.message}`);
    await ensureThumbnail(db, "projects", path, image);
    const { error } = await db.from("frames").insert({
      id: frameId,
      shot_id: ctx.shot.id,
      variant_index: variant++,
      storage_path: path,
      engine: engine.name,
      model: result.model,
      prompt_used: ctx.shot.image_prompt!,
      negative_used: ctx.shot.image_negative,
      reference_asset_ids: ctx.references.map((r) => r.assetId),
      cost_usd: Math.round(costEach * 10_000) / 10_000,
      job_id: job.job.id,
    });
    if (error) throw new Error(`No se pudo registrar el frame: ${error.message}`);
  }
  return result.images.length;
}

/** Ejecuta fn sobre los items con un máximo de `limit` en paralelo; devuelve los errores por item. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  const errors: { item: T; error: unknown }[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        await fn(items[index], index);
      } catch (error) {
        errors.push({ item: items[index], error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return errors;
}
