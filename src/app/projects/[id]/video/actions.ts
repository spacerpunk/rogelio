"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { assertEngineReady } from "@/lib/engines/registry";
import { enqueueJob } from "@/lib/jobs/queue";
import { advanceProjectStatus } from "@/lib/pipeline/context";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
type Db = Awaited<ReturnType<typeof createClient>>;

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Trabajos activos que ya incluyen alguno de estos planos (para no duplicar gasto). */
async function busyShots(db: Db, projectId: string, type: "generate_video_prompts" | "generate_clips"): Promise<Set<string>> {
  const { data } = await db
    .from("jobs")
    .select("payload")
    .eq("project_id", projectId)
    .eq("type", type)
    .in("status", ["queued", "running"]);
  return new Set((data ?? []).flatMap((j) => (j.payload as { shotIds?: string[] }).shotIds ?? []));
}

/** Solo planos con frame aprobado: el video sale de ese frame. */
async function assertApprovedFrames(db: Db, shotIds: string[]) {
  const { data } = await db.from("frames").select("shot_id").in("shot_id", shotIds).eq("selected", true).is("deleted_at", null);
  const withFrame = new Set((data ?? []).map((f) => f.shot_id));
  const missing = shotIds.filter((id) => !withFrame.has(id)).length;
  if (missing) throw new Error(`Hay ${missing} plano(s) sin frame aprobado: aprobá una imagen en Frames primero.`);
}

export async function generateVideoPrompts(input: { projectId: string; shotIds: string[]; engine: string }): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, shotIds: z.array(uuid).min(1, "No hay planos"), engine: z.string() }).parse(input);
    const db = await createClient();
    await assertApprovedFrames(db, data.shotIds);
    const busy = await busyShots(db, data.projectId, "generate_video_prompts");
    const shotIds = data.shotIds.filter((id) => !busy.has(id));
    if (shotIds.length === 0) throw new Error("Esos planos ya tienen prompts de video generándose.");
    await enqueueJob(db, {
      projectId: data.projectId,
      type: "generate_video_prompts",
      shotId: shotIds.length === 1 ? shotIds[0] : null,
      payload: { shotIds, engine: data.engine },
    });
    revalidate(data.projectId);
    return shotIds.length;
  });
}

export async function generateClips(input: {
  projectId: string;
  shotIds: string[];
  engine: string;
  n: number;
}): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = z
      .object({
        projectId: uuid,
        shotIds: z.array(uuid).min(1, "No hay planos para generar"),
        engine: z.string(),
        n: z.number().int().min(1).max(4),
      })
      .parse(input);
    assertEngineReady("video", data.engine);
    const db = await createClient();
    await assertApprovedFrames(db, data.shotIds);
    const busy = await busyShots(db, data.projectId, "generate_clips");
    const shotIds = data.shotIds.filter((id) => !busy.has(id));
    if (shotIds.length === 0) throw new Error("Esos planos ya se están generando.");
    await enqueueJob(db, {
      projectId: data.projectId,
      type: "generate_clips",
      shotId: shotIds.length === 1 ? shotIds[0] : null,
      payload: { shotIds, engine: data.engine, n: data.n },
    });
    revalidate(data.projectId);
    return shotIds.length;
  });
}

export async function updateShotVideo(
  shotId: string,
  patch: { video_prompt?: string | null; video_negative?: string | null; video_duration_sec?: number | null },
): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({
        video_prompt: z.string().nullable(),
        video_negative: z.string().nullable(),
        video_duration_sec: z.number().min(1).max(30).nullable(),
      })
      .partial()
      .parse(patch);
    const db = await createClient();
    const { data: shot, error } = await db.from("shots").update(data).eq("id", uuid.parse(shotId)).select("project_id").single();
    throwIfError({ error }, "No se pudo guardar el prompt de video");
    revalidate(shot!.project_id);
    return null;
  });
}

async function clipWithShot(db: Db, clipId: string) {
  const { data, error } = await db.from("clips").select("id, shot_id, selected, shots(project_id)").eq("id", uuid.parse(clipId)).single();
  if (error || !data?.shots) throw new Error("No encontré el clip.");
  return { clip: data, projectId: data.shots.project_id };
}

export async function selectClip(clipId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { clip, projectId } = await clipWithShot(db, clipId);
    throwIfError(await db.from("clips").update({ selected: false }).eq("shot_id", clip.shot_id).eq("selected", true), "No se pudo aprobar");
    throwIfError(await db.from("clips").update({ selected: true, rejected: false }).eq("id", clip.id), "No se pudo aprobar");

    // Con un clip aprobado en cada plano, el proyecto queda terminado.
    const { data: shots } = await db.from("shots").select("id").eq("project_id", projectId).is("deleted_at", null);
    const shotIds = (shots ?? []).map((s) => s.id);
    const { data: approved } = await db.from("clips").select("shot_id").in("shot_id", shotIds).eq("selected", true).is("deleted_at", null);
    if (shotIds.length && new Set((approved ?? []).map((c) => c.shot_id)).size === shotIds.length) {
      await advanceProjectStatus(db, projectId, "done");
    }
    revalidate(projectId);
    return null;
  });
}

export async function unselectClip(clipId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { clip, projectId } = await clipWithShot(db, clipId);
    throwIfError(await db.from("clips").update({ selected: false }).eq("id", clip.id), "No se pudo quitar");
    await db.from("projects").update({ status: "clips" }).eq("id", projectId).eq("status", "done");
    revalidate(projectId);
    return null;
  });
}

export async function rejectClip(clipId: string, rejected: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { clip, projectId } = await clipWithShot(db, clipId);
    if (rejected && clip.selected) throw new Error("Es el clip aprobado: quitale la aprobación antes de rechazarlo.");
    throwIfError(await db.from("clips").update({ rejected }).eq("id", clip.id), "No se pudo actualizar");
    revalidate(projectId);
    return null;
  });
}

/** Rechaza todos los clips sin aprobar del plano: queda marcado para regenerar. */
export async function rejectUnapprovedClips(shotId: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const db = await createClient();
    const { data, error } = await db
      .from("clips")
      .update({ rejected: true })
      .eq("shot_id", uuid.parse(shotId))
      .eq("selected", false)
      .eq("rejected", false)
      .is("deleted_at", null)
      .select("shots(project_id)");
    throwIfError({ error }, "No se pudieron rechazar");
    if (data?.[0]?.shots) revalidate(data[0].shots.project_id);
    return data?.length ?? 0;
  });
}

export async function setClipNotes(clipId: string, notes: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { clip, projectId } = await clipWithShot(db, clipId);
    throwIfError(await db.from("clips").update({ review_notes: notes.trim() || null }).eq("id", clip.id), "No se pudo guardar la nota");
    revalidate(projectId);
    return null;
  });
}
