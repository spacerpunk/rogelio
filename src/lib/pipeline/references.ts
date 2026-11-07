import sharp from "sharp";
import type { Db } from "@/lib/jobs/types";
import { locationLabel } from "@/lib/library/locations";
import { downloadBuffer, type Bucket } from "@/lib/storage";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_IMAGE_REFERENCES, MAX_VIDEO_REFERENCES } from "./reference-limits";

export { MAX_IMAGE_REFERENCES, MAX_VIDEO_REFERENCES };

export type ReferenceTarget = "image" | "video";
export type ReferenceKind = "character" | "location" | "ppe" | "extra";

export type ReferenceAsset = {
  /** Clave estable: el id del asset (automáticas) o "manual:<id de shot_references>". */
  key: string;
  /** Asset de la biblioteca, si sale de ahí (automáticas y manuales de la biblioteca). */
  assetId: string | null;
  /** Fila de shot_references, si se sumó a mano. */
  manualId: string | null;
  bucket: Bucket;
  storagePath: string;
  label: string;
  kind: ReferenceKind;
  auto: boolean;
};

type AssetKind = Database["public"]["Enums"]["asset_kind"];
type AssetLite = { id: string; title: string; storage_path: string | null };
type CharacterLite = { name: string; sheet_asset_ids: string[] };
type LocationLite = { code?: string | null; name: string; plate_asset_ids: string[] };
type ShotLite = { id: string; excluded_image_reference_ids: string[]; excluded_video_reference_ids: string[] };

const MAX_CHARACTER_SHEETS = 6;
const VIDEO_MAX_CHARACTER_SHEETS = 3;
const REFERENCE_MAX_SIDE = 1536;

/** Etiqueta en inglés (la lee el motor) para una imagen de la biblioteca que se suma a mano. */
export function libraryReferenceLabel(kind: AssetKind, title: string): string {
  const prefix: Partial<Record<AssetKind, string>> = {
    character_sheet: "character sheet",
    location_plate: "location plate",
    ppe_sheet: "PPE gear sheet",
    logo: "client logo",
  };
  return `${prefix[kind] ?? "visual reference"} (${title})`;
}

export function frameReferenceLabel(shotNumber: number, sameShot: boolean): string {
  return sameShot
    ? "previous variant of this same shot: keep its composition and fix only what the prompt changes"
    : `continuity reference: approved frame of shot ${shotNumber}`;
}

export function uploadReferenceLabel(name: string): string {
  return `extra visual reference (${name})`;
}

/**
 * Referencias que se adjuntan solas a un plano. Imagen, en orden: sheets de sus personajes, plates de la
 * locación y hojas de EPP activas del cliente (siempre: también los planos detalle muestran guantes y equipo).
 * Video: solo las sheets de los personajes (la locación y el EPP ya están en el primer frame).
 * Función pura: la usan el worker (para adjuntarlas) y la UI (para mostrarlas).
 */
export function autoReferences(
  target: ReferenceTarget,
  characters: CharacterLite[],
  location: LocationLite | null,
  assetsById: Map<string, AssetLite>,
  ppeSheets: AssetLite[],
): ReferenceAsset[] {
  const refs: ReferenceAsset[] = [];
  const push = (asset: AssetLite | undefined, label: string, kind: ReferenceKind) => {
    if (asset?.storage_path && !refs.some((r) => r.assetId === asset.id)) {
      refs.push({ key: asset.id, assetId: asset.id, manualId: null, bucket: "library", storagePath: asset.storage_path, label, kind, auto: true });
    }
  };
  const maxSheets = target === "image" ? MAX_CHARACTER_SHEETS : VIDEO_MAX_CHARACTER_SHEETS;
  for (const character of characters) {
    for (const id of character.sheet_asset_ids) {
      if (refs.length >= maxSheets) break;
      const asset = assetsById.get(id);
      push(asset, `character sheet of ${character.name}${asset ? ` (${asset.title})` : ""}`, "character");
    }
  }
  if (target === "video") return refs;
  for (const id of location?.plate_asset_ids ?? []) push(assetsById.get(id), `location plate of ${location ? locationLabel(location) : ""}`, "location");
  for (const sheet of ppeSheets) push(sheet, "PPE gear sheet", "ppe");
  return refs;
}

/** Las automáticas sin las que se quitaron del plano, más las manuales, dentro del máximo del motor. */
export function applyReferenceOverrides(
  target: ReferenceTarget,
  auto: ReferenceAsset[],
  excludedAssetIds: string[],
  manual: ReferenceAsset[],
): ReferenceAsset[] {
  const max = target === "image" ? MAX_IMAGE_REFERENCES : MAX_VIDEO_REFERENCES;
  const kept = auto.filter((r) => !excludedAssetIds.includes(r.assetId ?? ""));
  // Las manuales se eligieron a propósito: si no entran todas, se recortan las automáticas del final.
  const extras = manual.filter((m) => !kept.some((r) => r.assetId && r.assetId === m.assetId)).slice(0, max);
  return [...kept.slice(0, Math.max(0, max - extras.length)), ...extras];
}

/** Firma de las referencias: si cambia después de escribir el prompt, el prompt puede nombrarlas mal. */
export function referencesKey(refs: ReferenceAsset[]): string {
  return refs.map((r) => r.key).join(",");
}

export function excludedFor(shot: ShotLite, target: ReferenceTarget): string[] {
  return target === "image" ? shot.excluded_image_reference_ids : shot.excluded_video_reference_ids;
}

export type ManualReferences = Record<ReferenceTarget, Map<string, ReferenceAsset[]>>;

/** Referencias sumadas a mano a estos planos, por destino y por plano. Saltea las que apuntan a algo borrado. */
export async function loadManualReferences(db: Db, shotIds: string[]): Promise<ManualReferences> {
  const result: ManualReferences = { image: new Map(), video: new Map() };
  if (shotIds.length === 0) return result;
  const { data, error } = await db
    .from("shot_references")
    .select("id, shot_id, target, source, storage_path, label, library_assets(storage_path, deleted_at), frames(storage_path, deleted_at)")
    .in("shot_id", shotIds)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw new Error(`No se pudieron leer las referencias: ${error.message}`);

  for (const row of data ?? []) {
    let location: { bucket: Bucket; path: string } | null = null;
    if (row.source === "upload" && row.storage_path) location = { bucket: "projects", path: row.storage_path };
    if (row.source === "library" && row.library_assets?.storage_path && !row.library_assets.deleted_at) {
      location = { bucket: "library", path: row.library_assets.storage_path };
    }
    if (row.source === "frame" && row.frames?.storage_path && !row.frames.deleted_at) location = { bucket: "projects", path: row.frames.storage_path };
    if (!location) continue;

    const target = row.target as ReferenceTarget;
    const list = result[target].get(row.shot_id) ?? [];
    list.push({
      key: `manual:${row.id}`,
      assetId: null,
      manualId: row.id,
      bucket: location.bucket,
      storagePath: location.path,
      label: row.label,
      kind: "extra",
      auto: false,
    });
    result[target].set(row.shot_id, list);
  }
  return result;
}

/** Referencias efectivas de un plano para el worker: automáticas de la biblioteca + overrides del plano. */
export async function resolveShotReferences(
  db: Db,
  clientId: string,
  shot: ShotLite,
  characters: CharacterLite[],
  location: LocationLite | null,
  target: ReferenceTarget,
): Promise<ReferenceAsset[]> {
  const ids = [...characters.flatMap((c) => c.sheet_asset_ids), ...(location?.plate_asset_ids ?? [])];
  const [linked, ppe, manual] = await Promise.all([
    ids.length
      ? db.from("library_assets").select("id, title, storage_path").in("id", ids).is("deleted_at", null)
      : Promise.resolve({ data: [] as AssetLite[] }),
    db
      .from("library_assets")
      .select("id, title, storage_path")
      .eq("client_id", clientId)
      .eq("kind", "ppe_sheet")
      .eq("is_active", true)
      .is("deleted_at", null),
    loadManualReferences(db, [shot.id]),
  ]);
  const auto = autoReferences(target, characters, location, new Map((linked.data ?? []).map((a) => [a.id, a])), ppe.data ?? []);
  return applyReferenceOverrides(target, auto, excludedFor(shot, target), manual[target].get(shot.id) ?? []);
}

/** Lo que se guarda en frames/clips.references_used: qué se adjuntó de verdad. */
export function referencesUsed(refs: ReferenceAsset[]) {
  return refs.map((r) => ({ label: r.label, bucket: r.bucket, path: r.storagePath }));
}

/** Descarga las referencias achicadas (máx. 1536 px): menos peso y tokens, misma información. */
export async function loadReferenceBuffers(db: Db, refs: ReferenceAsset[]): Promise<Buffer[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const original = await downloadBuffer(db, ref.bucket, ref.storagePath);
      return sharp(original)
        .rotate()
        .resize({ width: REFERENCE_MAX_SIDE, height: REFERENCE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    }),
  );
}
