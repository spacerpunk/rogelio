import sharp from "sharp";
import type { Db } from "@/lib/jobs/types";
import { downloadBuffer } from "@/lib/storage";

export type ReferenceAsset = { assetId: string; storagePath: string; label: string };

type AssetLite = { id: string; title: string; storage_path: string | null };
type CharacterLite = { name: string; sheet_asset_ids: string[] };
type LocationLite = { name: string; plate_asset_ids: string[] };

const MAX_REFERENCES = 14;
const MAX_CHARACTER_SHEETS = 6;
const REFERENCE_MAX_SIDE = 1536;

/**
 * Referencias que se adjuntan solas a un plano, en orden: sheets de sus personajes, plates de la
 * locación y hojas de EPP activas del cliente (siempre: también los planos detalle muestran guantes y equipo).
 * Función pura: la usan el worker (para adjuntarlas) y la UI (para mostrarlas).
 */
export function pickReferences(
  characters: CharacterLite[],
  location: LocationLite | null,
  assetsById: Map<string, AssetLite>,
  ppeSheets: AssetLite[],
): ReferenceAsset[] {
  const refs: ReferenceAsset[] = [];
  const push = (asset: AssetLite | undefined, label: string) => {
    if (asset?.storage_path && !refs.some((r) => r.assetId === asset.id)) {
      refs.push({ assetId: asset.id, storagePath: asset.storage_path, label });
    }
  };
  for (const character of characters) {
    for (const id of character.sheet_asset_ids) {
      if (refs.length >= MAX_CHARACTER_SHEETS) break;
      const asset = assetsById.get(id);
      push(asset, `character sheet of ${character.name}${asset ? ` (${asset.title})` : ""}`);
    }
  }
  for (const id of location?.plate_asset_ids ?? []) push(assetsById.get(id), `location plate of ${location?.name}`);
  for (const sheet of ppeSheets) push(sheet, "PPE gear sheet");
  return refs.slice(0, MAX_REFERENCES);
}

export async function resolveShotReferences(
  db: Db,
  clientId: string,
  characters: CharacterLite[],
  location: LocationLite | null,
): Promise<ReferenceAsset[]> {
  const ids = [...characters.flatMap((c) => c.sheet_asset_ids), ...(location?.plate_asset_ids ?? [])];
  const [linked, ppe] = await Promise.all([
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
  ]);
  return pickReferences(characters, location, new Map((linked.data ?? []).map((a) => [a.id, a])), ppe.data ?? []);
}

/** Descarga las referencias achicadas (máx. 1536 px): menos peso y tokens, misma información. */
export async function loadReferenceBuffers(db: Db, refs: ReferenceAsset[]): Promise<Buffer[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const original = await downloadBuffer(db, "library", ref.storagePath);
      return sharp(original)
        .rotate()
        .resize({ width: REFERENCE_MAX_SIDE, height: REFERENCE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    }),
  );
}
