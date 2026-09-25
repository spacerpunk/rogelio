"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { advanceProjectStatus } from "@/lib/pipeline/context";
import { scriptParamsSchema, type ScriptParams } from "@/lib/pipeline/script";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

async function assertCanGenerate(projectId: string) {
  const db = await createClient();
  if (await hasActiveJob(db, projectId, "generate_script")) {
    throw new Error("Ya hay un guion generándose para este proyecto.");
  }
  const { count } = await db
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .not("extracted_text", "is", null);
  if (!count) throw new Error("Primero cargá al menos una fuente con texto.");
  return db;
}

export async function generateScript(input: { projectId: string; params: ScriptParams }): Promise<ActionResult> {
  return runAction(async () => {
    const projectId = uuid.parse(input.projectId);
    const params = scriptParamsSchema.parse(input.params);
    const db = await assertCanGenerate(projectId);
    // La duración objetivo del proyecto sigue a la del último pedido.
    await db.from("projects").update({ target_duration_sec: Math.round(params.targetMinutes * 60) }).eq("id", projectId);
    await enqueueJob(db, { projectId, type: "generate_script", payload: { params } });
    revalidatePath(`/projects/${projectId}`, "layout");
    return null;
  });
}

export async function regenerateScript(input: {
  projectId: string;
  baseVersion: number;
  instructions: string;
  params: ScriptParams;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({
        projectId: uuid,
        baseVersion: z.number().int().positive(),
        instructions: z.string().trim().min(1, "Escribí las indicaciones para regenerar"),
        params: scriptParamsSchema,
      })
      .parse(input);
    const db = await assertCanGenerate(data.projectId);
    await enqueueJob(db, {
      projectId: data.projectId,
      type: "generate_script",
      payload: { params: data.params, baseVersion: data.baseVersion, instructions: data.instructions },
    });
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return null;
  });
}

/** Una edición manual nunca pisa: se guarda como versión nueva. */
export async function saveScriptVersion(input: {
  projectId: string;
  baseVersion: number;
  content: string;
}): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = z
      .object({ projectId: uuid, baseVersion: z.number().int().positive(), content: z.string().trim().min(1, "El guion está vacío") })
      .parse(input);
    const db = await createClient();
    const { data: last } = await db
      .from("scripts")
      .select("version")
      .eq("project_id", data.projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;
    throwIfError(
      await db.from("scripts").insert({
        project_id: data.projectId,
        version,
        content: data.content,
        generation_params: { manual: true, baseVersion: data.baseVersion },
      }),
      "No se pudo guardar la versión",
    );
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return version;
  });
}

export async function approveScript(input: { projectId: string; version: number }): Promise<ActionResult> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, version: z.number().int().positive() }).parse(input);
    const db = await createClient();
    throwIfError(
      await db
        .from("scripts")
        .update({ status: "draft", approved_at: null })
        .eq("project_id", data.projectId)
        .neq("version", data.version),
      "No se pudo actualizar las versiones",
    );
    throwIfError(
      await db
        .from("scripts")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("project_id", data.projectId)
        .eq("version", data.version),
      "No se pudo aprobar",
    );
    await advanceProjectStatus(db, data.projectId, "shotlist");
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return null;
  });
}
