"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { advanceProjectStatus } from "@/lib/pipeline/context";
import { FRAMINGS, estimateDuration } from "@/lib/pipeline/shotlist";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type ShotRow = Database["public"]["Tables"]["shots"]["Row"];
type ShotInsert = Database["public"]["Tables"]["shots"]["Insert"];
type Db = Awaited<ReturnType<typeof createClient>>;

const uuid = z.uuid();

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

async function getShot(db: Db, shotId: string): Promise<ShotRow> {
  const { data, error } = await db.from("shots").select("*").eq("id", uuid.parse(shotId)).is("deleted_at", null).single();
  if (error || !data) throw new Error("No encontré el plano.");
  return data;
}

async function activeShots(db: Db, projectId: string): Promise<ShotRow[]> {
  const { data, error } = await db
    .from("shots")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("order_index");
  if (error) throw new Error(error.message);
  return data;
}

/** Deja order_index = 0..n-1 siguiendo el orden dado; solo escribe los que cambian. */
async function writeOrder(db: Db, orderedIds: string[], current: Map<string, number>) {
  await Promise.all(
    orderedIds.map((id, index) =>
      current.get(id) === index ? null : db.from("shots").update({ order_index: index }).eq("id", id),
    ),
  );
}

export async function generateShotlist(projectId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = uuid.parse(projectId);
    const db = await createClient();
    if (await hasActiveJob(db, id, "generate_shotlist")) throw new Error("Ya se está generando el shot list.");
    const { count } = await db
      .from("scripts")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("status", "approved");
    if (!count) throw new Error("Primero aprobá una versión del guion.");
    await enqueueJob(db, { projectId: id, type: "generate_shotlist" });
    revalidate(id);
    return null;
  });
}

// Campos que definen el plano: si cambian, el plano vuelve a borrador y hay que reaprobar.
const CONTENT_FIELDS = ["scene_number", "scene_title", "character_ids", "location_id", "framing", "lighting", "action", "vo_line", "on_screen_text"];

const patchSchema = z
  .object({
    scene_number: z.number().int().min(1),
    scene_title: z.string().nullable(),
    character_ids: z.array(uuid),
    location_id: uuid.nullable(),
    framing: z.enum(FRAMINGS as [string, ...string[]]),
    lighting: z.string().nullable(),
    action: z.string().nullable(),
    vo_line: z.string().nullable(),
    on_screen_text: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .partial();

export async function updateShot(shotId: string, patch: z.input<typeof patchSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const data = patchSchema.parse(patch);
    const db = await createClient();
    const shot = await getShot(db, shotId);
    const update: Partial<ShotRow> = { ...(data as Partial<ShotRow>) };
    if ("vo_line" in data) update.est_duration_sec = estimateDuration(data.vo_line);
    const touchesContent = Object.keys(data).some((k) => CONTENT_FIELDS.includes(k));
    if (touchesContent && shot.status !== "draft") update.status = "draft";
    throwIfError(await db.from("shots").update(update).eq("id", shot.id), "No se pudo guardar el plano");
    revalidate(shot.project_id);
    return null;
  });
}

export async function reorderShots(projectId: string, orderedIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const id = uuid.parse(projectId);
    const ids = z.array(uuid).parse(orderedIds);
    const db = await createClient();
    const shots = await activeShots(db, id);
    if (shots.length !== ids.length || !shots.every((s) => ids.includes(s.id))) {
      throw new Error("El shot list cambió mientras reordenabas; recargá la página.");
    }
    await writeOrder(db, ids, new Map(shots.map((s) => [s.id, s.order_index])));
    revalidate(id);
    return null;
  });
}

function copyOf(shot: ShotRow, overrides: Partial<ShotInsert>): ShotInsert {
  return {
    project_id: shot.project_id,
    script_version: shot.script_version,
    order_index: shot.order_index + 1,
    scene_number: shot.scene_number,
    scene_title: shot.scene_title,
    character_ids: shot.character_ids,
    location_id: shot.location_id,
    framing: shot.framing,
    lighting: shot.lighting,
    action: shot.action,
    vo_line: shot.vo_line,
    on_screen_text: shot.on_screen_text,
    est_duration_sec: shot.est_duration_sec,
    notes: shot.notes,
    status: "draft",
    ...overrides,
  };
}

/** Inserta un plano después de `afterIndex` y corre los siguientes. */
async function insertAt(db: Db, projectId: string, row: ShotInsert): Promise<string> {
  const shots = await activeShots(db, projectId);
  const { data, error } = await db.from("shots").insert(row).select("id").single();
  if (error || !data) throw new Error(`No se pudo crear el plano: ${error?.message}`);
  const ordered = shots.map((s) => s.id);
  ordered.splice(row.order_index ?? ordered.length, 0, data.id);
  await writeOrder(db, ordered, new Map(shots.map((s) => [s.id, s.order_index])));
  return data.id;
}

/** Divide un plano en dos: la locución se reparte por la mitad (en palabras). */
export async function splitShot(shotId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const shot = await getShot(db, shotId);
    const words = (shot.vo_line ?? "").trim().split(/\s+/).filter(Boolean);
    const half = Math.ceil(words.length / 2);
    const first = words.slice(0, half).join(" ");
    const second = words.slice(half).join(" ");

    throwIfError(
      await db
        .from("shots")
        .update({ vo_line: first || null, est_duration_sec: estimateDuration(first), status: "draft" })
        .eq("id", shot.id),
      "No se pudo dividir el plano",
    );
    await insertAt(db, shot.project_id, copyOf(shot, { vo_line: second || null, est_duration_sec: estimateDuration(second) }));
    revalidate(shot.project_id);
    return null;
  });
}

/** Fusiona el plano con el siguiente: une locución, acción y personajes; el siguiente queda borrado. */
export async function mergeWithNext(shotId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const shot = await getShot(db, shotId);
    const shots = await activeShots(db, shot.project_id);
    const next = shots[shots.findIndex((s) => s.id === shot.id) + 1];
    if (!next) throw new Error("Es el último plano: no hay otro para fusionar.");

    const join = (a: string | null, b: string | null, sep: string) => [a, b].filter((x) => x?.trim()).join(sep) || null;
    const voLine = join(shot.vo_line, next.vo_line, " ");
    throwIfError(
      await db
        .from("shots")
        .update({
          vo_line: voLine,
          action: join(shot.action, next.action, " / "),
          on_screen_text: join(shot.on_screen_text, next.on_screen_text, " / "),
          notes: join(shot.notes, next.notes, " / "),
          character_ids: [...new Set([...shot.character_ids, ...next.character_ids])],
          est_duration_sec: estimateDuration(voLine),
          status: "draft",
        })
        .eq("id", shot.id),
      "No se pudo fusionar",
    );
    throwIfError(await db.from("shots").update({ deleted_at: new Date().toISOString() }).eq("id", next.id), "No se pudo fusionar");
    const remaining = shots.filter((s) => s.id !== next.id);
    await writeOrder(db, remaining.map((s) => s.id), new Map(remaining.map((s) => [s.id, s.order_index])));
    revalidate(shot.project_id);
    return null;
  });
}

export async function insertShotAfter(projectId: string, afterShotId: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const id = uuid.parse(projectId);
    const db = await createClient();
    const shots = await activeShots(db, id);
    const after = afterShotId ? shots.find((s) => s.id === afterShotId) : shots.at(-1);
    const { data: script } = await db
      .from("scripts")
      .select("version")
      .eq("project_id", id)
      .eq("status", "approved")
      .maybeSingle();
    await insertAt(db, id, {
      project_id: id,
      script_version: after?.script_version ?? script?.version ?? 1,
      order_index: after ? after.order_index + 1 : 0,
      scene_number: after?.scene_number ?? 1,
      scene_title: after?.scene_title ?? null,
      location_id: after?.location_id ?? null,
      framing: "medium",
      est_duration_sec: estimateDuration(""),
    });
    revalidate(id);
    return null;
  });
}

export async function deleteShot(shotId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const shot = await getShot(db, shotId);
    throwIfError(await db.from("shots").update({ deleted_at: new Date().toISOString() }).eq("id", shot.id), "No se pudo borrar");
    const remaining = (await activeShots(db, shot.project_id)).filter((s) => s.id !== shot.id);
    await writeOrder(db, remaining.map((s) => s.id), new Map(remaining.map((s) => [s.id, s.order_index])));
    revalidate(shot.project_id);
    return null;
  });
}

export async function approveShotlist(projectId: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const id = uuid.parse(projectId);
    const db = await createClient();
    const shots = await activeShots(db, id);
    if (shots.length === 0) throw new Error("No hay planos para aprobar.");
    const empty = shots.filter((s) => !s.action?.trim());
    if (empty.length) throw new Error(`Hay ${empty.length} plano(s) sin acción: completalos antes de aprobar.`);
    const { data, error } = await db
      .from("shots")
      .update({ status: "approved" })
      .eq("project_id", id)
      .eq("status", "draft")
      .is("deleted_at", null)
      .select("id");
    throwIfError({ error }, "No se pudo aprobar el shot list");
    await advanceProjectStatus(db, id, "frames");
    revalidate(id);
    return data?.length ?? 0;
  });
}
