"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, throwIfError, type ActionResult } from "@/lib/action-result";
import { ASSET_KINDS, type AssetKind } from "@/lib/library/kinds";
import { ensureThumbnail, isImageMime, uniquePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
const assetKind = z.enum(Object.keys(ASSET_KINDS) as [AssetKind, ...AssetKind[]]);

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export async function createClientAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const input = z
      .object({ name: z.string().trim().min(1, "Poné un nombre"), notes: z.string().trim() })
      .parse({ name: formData.get("name"), notes: formData.get("notes") ?? "" });
    const db = await createClient();
    const { data, error } = await db
      .from("clients")
      .insert({ name: input.name, slug: slugify(input.name), notes: input.notes || null })
      .select("id")
      .single();
    if (error?.code === "23505") throw new Error("Ya existe un cliente con ese nombre");
    throwIfError({ error }, "No se pudo crear el cliente");
    return data!.id;
  });
  if (!result.ok) return result;
  redirect(`/clients/${result.data}`);
}

export async function updateClient(input: { clientId: string; name: string; notes: string }): Promise<ActionResult> {
  return runAction(async () => {
    const data = z
      .object({ clientId: uuid, name: z.string().trim().min(1, "Poné un nombre"), notes: z.string().trim() })
      .parse(input);
    const db = await createClient();
    throwIfError(
      await db.from("clients").update({ name: data.name, notes: data.notes || null }).eq("id", data.clientId),
      "No se pudo guardar",
    );
    revalidatePath(`/clients/${data.clientId}`);
    revalidatePath("/clients");
    return null;
  });
}

/** Archiva el cliente (borrado lógico). No se puede si tiene proyectos activos. */
export async function archiveClient(clientId: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    const id = uuid.parse(clientId);
    const db = await createClient();
    const { count } = await db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .is("deleted_at", null);
    if (count) throw new Error(`El cliente tiene ${count} proyecto(s) activo(s): archivalos primero.`);
    throwIfError(await db.from("clients").update({ deleted_at: new Date().toISOString() }).eq("id", id), "No se pudo archivar");
    return null;
  });
  if (!result.ok) return result;
  revalidatePath("/clients");
  redirect("/clients");
}

// ---------------------------------------------------------------------------
// Textos versionados
// ---------------------------------------------------------------------------

export async function createTextAsset(input: {
  clientId: string;
  kind: AssetKind;
  title: string;
  content: string;
}): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = z
      .object({
        clientId: uuid,
        kind: assetKind.refine((k) => ASSET_KINDS[k].media !== "image", "Ese tipo es de imagen"),
        title: z.string().trim().min(1, "Poné un título"),
        content: z.string().min(1, "El texto está vacío"),
      })
      .parse(input);
    const db = await createClient();

    // En los tipos singulares, el nuevo queda activo solo si no había otro activo.
    let isActive = true;
    if (ASSET_KINDS[data.kind].singular) {
      const { count } = await db
        .from("library_assets")
        .select("id", { count: "exact", head: true })
        .eq("client_id", data.clientId)
        .eq("kind", data.kind)
        .eq("is_active", true)
        .is("deleted_at", null);
      isActive = !count;
    }
    const { data: row, error } = await db
      .from("library_assets")
      .insert({ client_id: data.clientId, kind: data.kind, title: data.title, text_content: data.content, is_active: isActive })
      .select("lineage_id")
      .single();
    throwIfError({ error }, "No se pudo crear el texto");
    revalidatePath(`/clients/${data.clientId}`);
    return row!.lineage_id;
  });
}

/** Guardar un texto nunca pisa: crea la versión siguiente del mismo linaje. */
export async function saveTextVersion(input: { assetId: string; title: string; content: string }): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = z
      .object({ assetId: uuid, title: z.string().trim().min(1, "Poné un título"), content: z.string().min(1, "El texto está vacío") })
      .parse(input);
    const db = await createClient();
    const { data: base, error } = await db.from("library_assets").select("*").eq("id", data.assetId).single();
    throwIfError({ error }, "No encontré el texto");

    const { data: lineage } = await db
      .from("library_assets")
      .select("id, version, is_active")
      .eq("lineage_id", base!.lineage_id)
      .is("deleted_at", null);
    const versions = lineage ?? [];
    const nextVersion = Math.max(0, ...versions.map((v) => v.version)) + 1;
    const lineageWasActive = versions.some((v) => v.is_active);

    if (lineageWasActive) {
      throwIfError(
        await db.from("library_assets").update({ is_active: false }).eq("lineage_id", base!.lineage_id),
        "No se pudo desactivar la versión anterior",
      );
    }
    const { data: row, error: insertError } = await db
      .from("library_assets")
      .insert({
        client_id: base!.client_id,
        kind: base!.kind,
        title: data.title,
        text_content: data.content,
        lineage_id: base!.lineage_id,
        version: nextVersion,
        is_active: lineageWasActive,
      })
      .select("id")
      .single();
    throwIfError({ error: insertError }, "No se pudo guardar la versión");
    revalidatePath(`/clients/${base!.client_id}`);
    return row!.id;
  });
}

/**
 * Activa una versión. En tipos singulares desactiva todo lo demás de ese tipo;
 * en los otros, solo las demás versiones del mismo linaje.
 */
export async function activateAsset(assetId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data: asset, error } = await db.from("library_assets").select("*").eq("id", uuid.parse(assetId)).single();
    throwIfError({ error }, "No encontré el asset");

    const deactivate = db.from("library_assets").update({ is_active: false }).eq("client_id", asset!.client_id);
    throwIfError(
      ASSET_KINDS[asset!.kind].singular
        ? await deactivate.eq("kind", asset!.kind)
        : await deactivate.eq("lineage_id", asset!.lineage_id),
      "No se pudo desactivar",
    );
    throwIfError(await db.from("library_assets").update({ is_active: true }).eq("id", asset!.id), "No se pudo activar");
    revalidatePath(`/clients/${asset!.client_id}`);
    return null;
  });
}

export async function deactivateAsset(assetId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data: asset, error } = await db
      .from("library_assets")
      .update({ is_active: false })
      .eq("id", uuid.parse(assetId))
      .select("client_id")
      .single();
    throwIfError({ error }, "No se pudo desactivar");
    revalidatePath(`/clients/${asset!.client_id}`);
    return null;
  });
}

/** Borrado lógico de todo el linaje; también se quita de personajes y locaciones. */
export async function deleteAsset(assetId: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data: asset, error } = await db.from("library_assets").select("*").eq("id", uuid.parse(assetId)).single();
    throwIfError({ error }, "No encontré el asset");

    const { data: lineage } = await db.from("library_assets").select("id").eq("lineage_id", asset!.lineage_id);
    const ids = (lineage ?? []).map((a) => a.id);
    throwIfError(
      await db
        .from("library_assets")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("lineage_id", asset!.lineage_id),
      "No se pudo borrar",
    );

    const [characters, locations] = await Promise.all([
      db.from("characters").select("id, sheet_asset_ids").eq("client_id", asset!.client_id).overlaps("sheet_asset_ids", ids),
      db.from("locations").select("id, plate_asset_ids").eq("client_id", asset!.client_id).overlaps("plate_asset_ids", ids),
    ]);
    for (const c of characters.data ?? []) {
      await db.from("characters").update({ sheet_asset_ids: c.sheet_asset_ids.filter((id) => !ids.includes(id)) }).eq("id", c.id);
    }
    for (const l of locations.data ?? []) {
      await db.from("locations").update({ plate_asset_ids: l.plate_asset_ids.filter((id) => !ids.includes(id)) }).eq("id", l.id);
    }
    revalidatePath(`/clients/${asset!.client_id}`);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Imágenes (subida directa del navegador a Storage con URL firmada)
// ---------------------------------------------------------------------------

export async function createLibraryUploadTarget(input: {
  clientId: string;
  kind: AssetKind;
  fileName: string;
}): Promise<ActionResult<{ path: string; token: string }>> {
  return runAction(async () => {
    const data = z.object({ clientId: uuid, kind: assetKind, fileName: z.string().min(1) }).parse(input);
    const db = await createClient();
    const path = uniquePath(`${data.clientId}/${data.kind}`, data.fileName);
    const { data: signed, error } = await db.storage.from("library").createSignedUploadUrl(path);
    throwIfError({ error }, "No se pudo preparar la subida");
    return { path, token: signed!.token };
  });
}

export async function registerImageAsset(input: {
  clientId: string;
  kind: AssetKind;
  title: string;
  path: string;
  mimeType: string;
}): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = z
      .object({
        clientId: uuid,
        kind: assetKind.refine((k) => ASSET_KINDS[k].media !== "text", "Ese tipo es de texto"),
        title: z.string().trim().min(1),
        path: z.string().min(1),
        mimeType: z.string().refine(isImageMime, "Solo se aceptan imágenes"),
      })
      .parse(input);
    if (!data.path.startsWith(`${data.clientId}/`)) throw new Error("Ruta de archivo inválida");

    const db = await createClient();
    await ensureThumbnail(db, "library", data.path);
    const { data: row, error } = await db
      .from("library_assets")
      .insert({ client_id: data.clientId, kind: data.kind, title: data.title, storage_path: data.path, mime_type: data.mimeType })
      .select("id")
      .single();
    throwIfError({ error }, "No se pudo registrar la imagen");
    revalidatePath(`/clients/${data.clientId}`);
    return row!.id;
  });
}

export async function renameAsset(assetId: string, title: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data, error } = await db
      .from("library_assets")
      .update({ title: z.string().trim().min(1, "Poné un título").parse(title) })
      .eq("id", uuid.parse(assetId))
      .select("client_id")
      .single();
    throwIfError({ error }, "No se pudo renombrar");
    revalidatePath(`/clients/${data!.client_id}`);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Personajes y locaciones
// ---------------------------------------------------------------------------

const characterSchema = z.object({
  id: uuid.optional(),
  clientId: uuid,
  name: z.string().trim().min(1, "Poné un nombre"),
  role: z.string().trim(),
  description: z.string().trim(),
  visualNotes: z.string().trim(),
  sheetAssetIds: z.array(uuid),
  basedOnRealPerson: z.boolean(),
  consentConfirmed: z.boolean(),
});

export async function saveCharacter(input: z.input<typeof characterSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = characterSchema.parse(input);
    const db = await createClient();
    const row = {
      client_id: data.clientId,
      name: data.name,
      role: data.role || null,
      description: data.description || null,
      visual_notes: data.visualNotes || null,
      sheet_asset_ids: data.sheetAssetIds,
      based_on_real_person: data.basedOnRealPerson,
      consent_confirmed: data.basedOnRealPerson && data.consentConfirmed,
    };
    const { data: saved, error } = data.id
      ? await db.from("characters").update(row).eq("id", data.id).select("id").single()
      : await db.from("characters").insert(row).select("id").single();
    throwIfError({ error }, "No se pudo guardar el personaje");
    revalidatePath(`/clients/${data.clientId}`);
    return saved!.id;
  });
}

const locationSchema = z.object({
  id: uuid.optional(),
  clientId: uuid,
  name: z.string().trim().min(1, "Poné un nombre"),
  description: z.string().trim(),
  plateAssetIds: z.array(uuid),
});

export async function saveLocation(input: z.input<typeof locationSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const data = locationSchema.parse(input);
    const db = await createClient();
    const row = {
      client_id: data.clientId,
      name: data.name,
      description: data.description || null,
      plate_asset_ids: data.plateAssetIds,
    };
    const { data: saved, error } = data.id
      ? await db.from("locations").update(row).eq("id", data.id).select("id").single()
      : await db.from("locations").insert(row).select("id").single();
    throwIfError({ error }, "No se pudo guardar la locación");
    revalidatePath(`/clients/${data.clientId}`);
    return saved!.id;
  });
}

export async function deleteCharacter(id: string): Promise<ActionResult> {
  return softDelete("characters", id);
}

export async function deleteLocation(id: string): Promise<ActionResult> {
  return softDelete("locations", id);
}

async function softDelete(table: "characters" | "locations", id: string): Promise<ActionResult> {
  return runAction(async () => {
    const db = await createClient();
    const { data, error } = await db
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", uuid.parse(id))
      .select("client_id")
      .single();
    throwIfError({ error }, "No se pudo borrar");
    revalidatePath(`/clients/${data!.client_id}`);
    return null;
  });
}
