"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { scriptFileKind, unsupportedScriptMessage } from "@/lib/ingest/kinds";
import { enqueueJob, hasActiveJob } from "@/lib/jobs/queue";
import { advanceProjectStatus, insertScriptVersion } from "@/lib/pipeline/context";
import { scriptParamsSchema, type ScriptParams } from "@/lib/pipeline/script";
import { uniquePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
type Db = Awaited<ReturnType<typeof createClient>>;

/** Un solo proceso de guion a la vez por proyecto: generar, importar o adaptar. */
async function assertNoScriptJob(db: Db, projectId: string) {
  for (const type of ["generate_script", "import_script", "adapt_script"] as const) {
    if (await hasActiveJob(db, projectId, type)) throw new Error("Ya hay un guion procesándose para este proyecto.");
  }
}

async function assertCanGenerate(projectId: string) {
  const db = await createClient();
  await assertNoScriptJob(db, projectId);
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
    const version = await insertScriptVersion(db, data.projectId, data.content, { manual: true, baseVersion: data.baseVersion });
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return version;
  });
}

// ---------------------------------------------------------------------------
// Guion que ya existe: subirlo (archivo o texto pegado) y, si hace falta, adaptarlo al formato de la app
// ---------------------------------------------------------------------------

export async function createScriptUploadTarget(input: {
  projectId: string;
  fileName: string;
}): Promise<ActionResult<{ path: string; token: string }>> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, fileName: z.string().min(1) }).parse(input);
    if (!scriptFileKind("", data.fileName)) throw new Error(unsupportedScriptMessage(data.fileName));
    const db = await createClient();
    const path = uniquePath(`${data.projectId}/scripts/uploads`, data.fileName);
    const { data: signed, error } = await db.storage.from("projects").createSignedUploadUrl(path);
    throwIfError({ error }, "No se pudo preparar la subida");
    return { path, token: signed!.token };
  });
}

/** Registra un guion ya subido a Storage y encola su lectura (se guarda tal cual como versión nueva). */
export async function importScriptFile(input: {
  projectId: string;
  fileName: string;
  path: string;
  mimeType: string;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({ projectId: uuid, fileName: z.string().min(1), path: z.string().min(1), mimeType: z.string() })
      .parse(input);
    if (!data.path.startsWith(`${data.projectId}/scripts/uploads/`)) throw new Error("Ruta de archivo inválida");
    if (!scriptFileKind(data.mimeType, data.fileName)) throw new Error(unsupportedScriptMessage(data.fileName));
    const db = await createClient();
    await assertNoScriptJob(db, data.projectId);
    await enqueueJob(db, {
      projectId: data.projectId,
      type: "import_script",
      payload: { path: data.path, fileName: data.fileName, mimeType: data.mimeType },
    });
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return null;
  });
}

/** Guion pegado: se guarda tal cual como versión nueva, sin pasar por la cola. */
export async function importScriptText(input: { projectId: string; content: string }): Promise<ActionResult<number>> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, content: z.string().trim().min(1, "Pegá el guion") }).parse(input);
    const db = await createClient();
    const version = await insertScriptVersion(db, data.projectId, data.content, { imported: true });
    await advanceProjectStatus(db, data.projectId, "script");
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return version;
  });
}

/** El motor de texto pasa una versión al formato de escenas y tomas de la app, en una versión nueva. */
export async function adaptScript(input: { projectId: string; baseVersion: number }): Promise<ActionResult> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, baseVersion: z.number().int().positive() }).parse(input);
    const db = await createClient();
    await assertNoScriptJob(db, data.projectId);
    await enqueueJob(db, { projectId: data.projectId, type: "adapt_script", payload: { baseVersion: data.baseVersion } });
    revalidatePath(`/projects/${data.projectId}`, "layout");
    return null;
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
