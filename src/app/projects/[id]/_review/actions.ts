"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { enqueueJob } from "@/lib/jobs/queue";
import type { PromptEditResult } from "@/lib/pipeline/prompt-edit";
import {
  frameReferenceLabel,
  libraryReferenceLabel,
  MAX_IMAGE_REFERENCES,
  MAX_VIDEO_REFERENCES,
  uploadReferenceLabel,
} from "@/lib/pipeline/references";
import { ensureThumbnail, uniquePath } from "@/lib/storage";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
const target = z.enum(["image", "video"]);
type Db = Awaited<ReturnType<typeof createClient>>;

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

async function loadShot(db: Db, shotId: string) {
  const { data, error } = await db
    .from("shots")
    .select("id, project_id, order_index, excluded_image_reference_ids, excluded_video_reference_ids")
    .eq("id", uuid.parse(shotId))
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error("No encontré el plano.");
  return data;
}

// ---------------------------------------------------------------------------
// Edición del prompt con el motor de texto
// ---------------------------------------------------------------------------

export async function requestPromptEdit(input: {
  shotId: string;
  target: "image" | "video";
  instruction: string;
  engine: string;
  prompt: string;
  negative: string | null;
  seconds?: number | null;
  frameId?: string | null;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({
        shotId: uuid,
        target,
        instruction: z.string().trim().min(3, "Escribí qué querés cambiar").max(4000),
        engine: z.string().min(1),
        prompt: z.string().trim().min(1, "El plano no tiene prompt todavía: generalo primero."),
        negative: z.string().nullable(),
        seconds: z.number().nullable().optional(),
        frameId: uuid.nullable().optional(),
      })
      .parse(input);
    const db = await createClient();
    const shot = await loadShot(db, data.shotId);

    const { data: active } = await db
      .from("jobs")
      .select("payload")
      .eq("shot_id", shot.id)
      .eq("type", "edit_prompt")
      .in("status", ["queued", "running"]);
    if ((active ?? []).some((j) => (j.payload as { target?: string }).target === data.target)) {
      throw new Error("Ya hay una edición de este prompt en curso.");
    }
    await enqueueJob(db, { projectId: shot.project_id, type: "edit_prompt", shotId: shot.id, payload: data as Record<string, Json> });
    revalidate(shot.project_id);
    return null;
  });
}

/** Aplica (o descarta) la propuesta de un trabajo edit_prompt. */
export async function resolvePromptEdit(jobId: string, apply: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data: job, error } = await db.from("jobs").select("id, type, status, shot_id, project_id, result").eq("id", uuid.parse(jobId)).single();
    if (error || !job || job.type !== "edit_prompt" || !job.shot_id) throw new Error("No encontré la propuesta.");
    const result = job.result as PromptEditResult | null;
    if (job.status !== "done" || result?.state !== "proposed") throw new Error("Esa propuesta ya se aplicó o se descartó.");

    if (apply) {
      const patch =
        result.target === "image"
          ? { image_prompt: result.prompt, image_negative: result.negative, image_prompt_references_key: result.referencesKey }
          : {
              video_prompt: result.prompt,
              video_negative: result.negative,
              video_duration_sec: result.seconds,
              video_prompt_frame_id: result.frameId,
              video_prompt_references_key: result.referencesKey,
            };
      throwIfError(await db.from("shots").update(patch).eq("id", job.shot_id), "No se pudo guardar el prompt");
    }
    const next: PromptEditResult = { ...result, state: apply ? "applied" : "dismissed" };
    throwIfError(await db.from("jobs").update({ result: next as unknown as Json }).eq("id", job.id), "No se pudo actualizar la propuesta");
    revalidate(job.project_id);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Referencias del plano
// ---------------------------------------------------------------------------

function referenceFolder(projectId: string, shotId: string) {
  return `${projectId}/references/${shotId}`;
}

/** URL firmada para que el navegador suba una imagen de referencia del plano directo a Storage. */
export async function createReferenceUploadTarget(input: { shotId: string; fileName: string }): Promise<ActionResult<{ path: string; token: string }>> {
  return runAction(async () => {
    const data = z.object({ shotId: uuid, fileName: z.string().min(1) }).parse(input);
    const db = await createClient();
    const shot = await loadShot(db, data.shotId);
    const path = uniquePath(referenceFolder(shot.project_id, shot.id), data.fileName);
    const { data: signed, error } = await db.storage.from("projects").createSignedUploadUrl(path);
    throwIfError({ error }, "No se pudo preparar la subida");
    return { path, token: signed!.token };
  });
}

export async function addShotReference(input: {
  shotId: string;
  target: "image" | "video";
  source: "upload" | "library" | "frame";
  assetId?: string;
  frameId?: string;
  path?: string;
  name?: string;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({
        shotId: uuid,
        target,
        source: z.enum(["upload", "library", "frame"]),
        assetId: uuid.optional(),
        frameId: uuid.optional(),
        path: z.string().min(1).optional(),
        name: z.string().trim().optional(),
      })
      .parse(input);
    const db = await createClient();
    const shot = await loadShot(db, data.shotId);

    const { count } = await db
      .from("shot_references")
      .select("id", { count: "exact", head: true })
      .eq("shot_id", shot.id)
      .eq("target", data.target)
      .is("deleted_at", null);
    const max = data.target === "image" ? MAX_IMAGE_REFERENCES : MAX_VIDEO_REFERENCES;
    if ((count ?? 0) >= max) throw new Error(`Ya hay ${max} referencias extra en este plano: quitá alguna primero.`);

    let row: { source: string; label: string; asset_id?: string; frame_id?: string; storage_path?: string };
    if (data.source === "upload") {
      if (!data.path?.startsWith(`${referenceFolder(shot.project_id, shot.id)}/`)) throw new Error("Ruta de archivo inválida");
      await ensureThumbnail(db, "projects", data.path);
      row = { source: "upload", storage_path: data.path, label: uploadReferenceLabel(data.name || "subida") };
    } else if (data.source === "library") {
      const { data: asset } = await db.from("library_assets").select("id, kind, title, storage_path").eq("id", data.assetId ?? "").is("deleted_at", null).single();
      if (!asset?.storage_path) throw new Error("No encontré esa imagen de la biblioteca.");
      row = { source: "library", asset_id: asset.id, label: libraryReferenceLabel(asset.kind, asset.title) };
    } else {
      const { data: frame } = await db
        .from("frames")
        .select("id, shot_id, shots!frames_shot_id_fkey(project_id, order_index)")
        .eq("id", data.frameId ?? "")
        .is("deleted_at", null)
        .single();
      if (!frame?.shots || frame.shots.project_id !== shot.project_id) throw new Error("No encontré ese frame en el proyecto.");
      row = { source: "frame", frame_id: frame.id, label: frameReferenceLabel(frame.shots.order_index + 1, frame.shot_id === shot.id) };
    }

    throwIfError(await db.from("shot_references").insert({ shot_id: shot.id, target: data.target, ...row }), "No se pudo sumar la referencia");
    revalidate(shot.project_id);
    return null;
  });
}

export async function removeShotReference(referenceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data, error } = await db
      .from("shot_references")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", uuid.parse(referenceId))
      .select("shots(project_id)")
      .single();
    throwIfError({ error }, "No se pudo quitar la referencia");
    revalidate(data!.shots!.project_id);
    return null;
  });
}

/** Quita (o devuelve) una referencia automática de la biblioteca en un plano. */
export async function setAutoReferenceExcluded(input: {
  shotId: string;
  target: "image" | "video";
  assetId: string;
  excluded: boolean;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z.object({ shotId: uuid, target, assetId: uuid, excluded: z.boolean() }).parse(input);
    const db = await createClient();
    const shot = await loadShot(db, data.shotId);
    const current = (data.target === "image" ? shot.excluded_image_reference_ids : shot.excluded_video_reference_ids).filter((id) => id !== data.assetId);
    const next = data.excluded ? [...current, data.assetId] : current;
    const patch = data.target === "image" ? { excluded_image_reference_ids: next } : { excluded_video_reference_ids: next };
    throwIfError(await db.from("shots").update(patch).eq("id", shot.id), "No se pudo actualizar las referencias");
    revalidate(shot.project_id);
    return null;
  });
}
