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
async function busyShots(db: Db, projectId: string, type: "generate_prompts" | "generate_frames"): Promise<Set<string>> {
  const { data } = await db
    .from("jobs")
    .select("payload")
    .eq("project_id", projectId)
    .eq("type", type)
    .in("status", ["queued", "running"]);
  return new Set((data ?? []).flatMap((j) => (j.payload as { shotIds?: string[] }).shotIds ?? []));
}

export async function generatePrompts(input: { projectId: string; shotIds: string[]; engine: string }): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, shotIds: z.array(uuid), engine: z.string() }).parse(input);
    const db = await createClient();
    const busy = await busyShots(db, data.projectId, "generate_prompts");
    const shotIds = data.shotIds.filter((id) => !busy.has(id));
    if (shotIds.length === 0) throw new Error("Esos planos ya tienen prompts generándose.");
    await enqueueJob(db, {
      projectId: data.projectId,
      type: "generate_prompts",
      shotId: shotIds.length === 1 ? shotIds[0] : null,
      payload: { shotIds, engine: data.engine },
    });
    revalidate(data.projectId);
    return shotIds.length;
  });
}

export async function generateFrames(input: {
  projectId: string;
  shotIds: string[];
  engine: string;
  n: number;
}): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = z
      .object({ projectId: uuid, shotIds: z.array(uuid).min(1, "No hay planos para generar"), engine: z.string(), n: z.number().int().min(1).max(8) })
      .parse(input);
    assertEngineReady("image", data.engine);
    const db = await createClient();
    const { data: shots } = await db.from("shots").select("id, status").in("id", data.shotIds).is("deleted_at", null);
    const drafts = (shots ?? []).filter((s) => s.status === "draft");
    if (drafts.length) throw new Error(`Hay ${drafts.length} plano(s) sin aprobar: aprobá el shot list primero.`);

    const busy = await busyShots(db, data.projectId, "generate_frames");
    const shotIds = data.shotIds.filter((id) => !busy.has(id));
    if (shotIds.length === 0) throw new Error("Esos planos ya se están generando.");
    await enqueueJob(db, {
      projectId: data.projectId,
      type: "generate_frames",
      shotId: shotIds.length === 1 ? shotIds[0] : null,
      payload: { shotIds, engine: data.engine, n: data.n },
    });
    revalidate(data.projectId);
    return shotIds.length;
  });
}

export async function updateShotPrompt(
  shotId: string,
  patch: { image_prompt?: string | null; image_negative?: string | null; video_prompt?: string | null },
): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({ image_prompt: z.string().nullable(), image_negative: z.string().nullable(), video_prompt: z.string().nullable() })
      .partial()
      .parse(patch);
    const db = await createClient();
    const { data: shot, error } = await db
      .from("shots")
      .update(data)
      .eq("id", uuid.parse(shotId))
      .select("project_id")
      .single();
    throwIfError({ error }, "No se pudo guardar el prompt");
    revalidate(shot!.project_id);
    return null;
  });
}

async function frameWithShot(db: Db, frameId: string) {
  const { data, error } = await db
    .from("frames")
    .select("id, shot_id, shots(project_id, status)")
    .eq("id", uuid.parse(frameId))
    .single();
  if (error || !data?.shots) throw new Error("No encontré el frame.");
  return { frame: data, projectId: data.shots.project_id };
}

export async function selectFrame(frameId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { frame, projectId } = await frameWithShot(db, frameId);
    throwIfError(await db.from("frames").update({ selected: false }).eq("shot_id", frame.shot_id).eq("selected", true), "No se pudo elegir");
    throwIfError(await db.from("frames").update({ selected: true, rejected: false }).eq("id", frame.id), "No se pudo elegir");
    throwIfError(await db.from("shots").update({ status: "frame_selected" }).eq("id", frame.shot_id), "No se pudo actualizar el plano");

    const { count } = await db
      .from("shots")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .neq("status", "frame_selected");
    if (count === 0) await advanceProjectStatus(db, projectId, "done");
    revalidate(projectId);
    return null;
  });
}

export async function unselectFrame(frameId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { frame, projectId } = await frameWithShot(db, frameId);
    throwIfError(await db.from("frames").update({ selected: false }).eq("id", frame.id), "No se pudo quitar");
    throwIfError(await db.from("shots").update({ status: "approved" }).eq("id", frame.shot_id), "No se pudo actualizar el plano");
    await db.from("projects").update({ status: "frames" }).eq("id", projectId).eq("status", "done");
    revalidate(projectId);
    return null;
  });
}

export async function rejectFrame(frameId: string, rejected: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { frame, projectId } = await frameWithShot(db, frameId);
    const { data: current } = await db.from("frames").select("selected").eq("id", frame.id).single();
    if (rejected && current?.selected) throw new Error("Es el frame elegido: quitalo de elegido antes de rechazarlo.");
    throwIfError(await db.from("frames").update({ rejected }).eq("id", frame.id), "No se pudo actualizar");
    revalidate(projectId);
    return null;
  });
}

export async function setReviewNotes(frameId: string, notes: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { frame, projectId } = await frameWithShot(db, frameId);
    throwIfError(await db.from("frames").update({ review_notes: notes.trim() || null }).eq("id", frame.id), "No se pudo guardar la nota");
    revalidate(projectId);
    return null;
  });
}
