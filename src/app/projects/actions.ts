"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { normalizedMime, sourceKind, unsupportedSourceMessage } from "@/lib/ingest/kinds";
import { enqueueJob } from "@/lib/jobs/queue";
import { ASPECT_RATIOS } from "@/lib/projects/data";
import { uniquePath } from "@/lib/storage";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

const projectSchema = z.object({
  clientId: uuid,
  title: z.string().trim().min(1, "Poné un título"),
  targetMinutes: z.coerce.number().positive("La duración tiene que ser mayor a 0").max(120).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  notes: z.string().trim(),
});

export async function createProject(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const input = projectSchema.parse({
      clientId: formData.get("clientId"),
      title: formData.get("title"),
      targetMinutes: formData.get("targetMinutes") || undefined,
      aspectRatio: formData.get("aspectRatio") ?? "16:9",
      notes: formData.get("notes") ?? "",
    });
    const db = await createClient();
    const { data, error } = await db
      .from("projects")
      .insert({
        client_id: input.clientId,
        title: input.title,
        target_duration_sec: input.targetMinutes ? Math.round(input.targetMinutes * 60) : null,
        aspect_ratio: input.aspectRatio,
        notes: input.notes || null,
      })
      .select("id")
      .single();
    throwIfError({ error }, "No se pudo crear el proyecto");
    return data!.id;
  });
  if (!result.ok) return result;
  redirect(`/projects/${result.data}/sources`);
}

export async function updateProject(input: {
  projectId: string;
  title: string;
  targetMinutes?: number | null;
  aspectRatio: string;
  notes: string;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({
        projectId: uuid,
        title: z.string().trim().min(1, "Poné un título"),
        targetMinutes: z.number().positive().max(120).nullish(),
        aspectRatio: z.enum(ASPECT_RATIOS),
        notes: z.string().trim(),
      })
      .parse(input);
    const db = await createClient();
    throwIfError(
      await db
        .from("projects")
        .update({
          title: data.title,
          target_duration_sec: data.targetMinutes ? Math.round(data.targetMinutes * 60) : null,
          aspect_ratio: data.aspectRatio,
          notes: data.notes || null,
        })
        .eq("id", data.projectId),
      "No se pudo guardar el proyecto",
    );
    revalidateProject(data.projectId);
    return null;
  });
}

/** Archiva el proyecto (borrado lógico): deja de aparecer en la lista, sus datos se conservan. */
export async function archiveProject(projectId: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const db = await createClient();
    throwIfError(
      await db.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", uuid.parse(projectId)),
      "No se pudo archivar el proyecto",
    );
    return null;
  });
  if (!result.ok) return result;
  revalidatePath("/projects");
  redirect("/projects");
}

// ---------------------------------------------------------------------------
// Fuentes
// ---------------------------------------------------------------------------

export async function createSourceUploadTarget(input: {
  projectId: string;
  fileName: string;
}): Promise<ActionResult<{ path: string; token: string }>> {
  return runAction(async () => {
    const data = z.object({ projectId: uuid, fileName: z.string().min(1) }).parse(input);
    if (!sourceKind("", data.fileName)) throw new Error(unsupportedSourceMessage(data.fileName));
    const db = await createClient();
    const path = uniquePath(`${data.projectId}/sources`, data.fileName);
    const { data: signed, error } = await db.storage.from("projects").createSignedUploadUrl(path);
    throwIfError({ error }, "No se pudo preparar la subida");
    return { path, token: signed!.token };
  });
}

/** Registra un archivo ya subido y encola su extracción. */
export async function registerSource(input: {
  projectId: string;
  fileName: string;
  path: string;
  mimeType: string;
}): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = z
      .object({ projectId: uuid, fileName: z.string().min(1), path: z.string().min(1), mimeType: z.string() })
      .parse(input);
    if (!data.path.startsWith(`${data.projectId}/sources/`)) throw new Error("Ruta de archivo inválida");
    const kind = sourceKind(data.mimeType, data.fileName);
    if (!kind) throw new Error(unsupportedSourceMessage(data.fileName));

    const db = await createClient();
    const orderIndex = await nextSourceIndex(data.projectId);
    const { data: source, error } = await db
      .from("sources")
      .insert({
        project_id: data.projectId,
        file_name: data.fileName,
        mime_type: normalizedMime(kind),
        storage_path: data.path,
        order_index: orderIndex,
      })
      .select("id")
      .single();
    throwIfError({ error }, "No se pudo registrar la fuente");
    await enqueueJob(db, { projectId: data.projectId, type: "extract_source", payload: { sourceId: source!.id } });
    revalidateProject(data.projectId);
    return source!.id;
  });
}

export async function createTextSource(input: {
  projectId: string;
  title: string;
  text: string;
}): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = z
      .object({ projectId: uuid, title: z.string().trim(), text: z.string().trim().min(1, "Pegá algún texto") })
      .parse(input);
    const db = await createClient();
    const { data: source, error } = await db
      .from("sources")
      .insert({
        project_id: data.projectId,
        file_name: data.title || "Texto pegado",
        mime_type: "text/plain",
        extracted_text: data.text,
        order_index: await nextSourceIndex(data.projectId),
      })
      .select("id")
      .single();
    throwIfError({ error }, "No se pudo guardar el texto");
    revalidateProject(data.projectId);
    return source!.id;
  });
}

async function nextSourceIndex(projectId: string): Promise<number> {
  const db = await createClient();
  const { data } = await db
    .from("sources")
    .select("order_index")
    .eq("project_id", projectId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.order_index ?? -1) + 1;
}

export async function updateSourceText(input: {
  sourceId: string;
  fileName: string;
  text: string;
  notes: string;
}): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({ sourceId: uuid, fileName: z.string().trim().min(1, "Poné un nombre"), text: z.string(), notes: z.string() })
      .parse(input);
    const db = await createClient();
    const { data: source, error } = await db
      .from("sources")
      .update({ file_name: data.fileName, extracted_text: data.text, extracted_notes: data.notes || null })
      .eq("id", data.sourceId)
      .select("project_id")
      .single();
    throwIfError({ error }, "No se pudo guardar");
    revalidateProject(source!.project_id);
    return null;
  });
}

export async function reextractSource(sourceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data: source, error } = await db
      .from("sources")
      .select("id, project_id, storage_path")
      .eq("id", uuid.parse(sourceId))
      .single();
    throwIfError({ error }, "No encontré la fuente");
    if (!source!.storage_path) throw new Error("El texto pegado no se extrae de un archivo.");
    await enqueueJob(db, { projectId: source!.project_id, type: "extract_source", payload: { sourceId: source!.id } });
    revalidateProject(source!.project_id);
    return null;
  });
}

export async function deleteSource(sourceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data, error } = await db
      .from("sources")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", uuid.parse(sourceId))
      .select("project_id")
      .single();
    throwIfError({ error }, "No se pudo borrar");
    revalidateProject(data!.project_id);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Trabajos
// ---------------------------------------------------------------------------

/** Reintenta un trabajo fallido creando uno nuevo con el mismo pedido (el fallido queda en el historial). */
export async function retryJob(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data: job, error } = await db.from("jobs").select("*").eq("id", uuid.parse(jobId)).single();
    throwIfError({ error }, "No encontré el trabajo");
    await enqueueJob(db, {
      projectId: job!.project_id,
      type: job!.type,
      payload: job!.payload as Record<string, Json>,
      shotId: job!.shot_id,
    });
    revalidateProject(job!.project_id);
    return null;
  });
}
