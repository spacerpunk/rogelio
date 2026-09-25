import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { signImages, type SignedImage } from "@/lib/storage";
import type { AssetKind } from "./kinds";

type Db = SupabaseClient<Database>;
type AssetRow = Database["public"]["Tables"]["library_assets"]["Row"];

export type AssetView = {
  id: string;
  kind: AssetKind;
  title: string;
  textContent: string | null;
  storagePath: string | null;
  mimeType: string | null;
  lineageId: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  image: SignedImage | null;
};

export type CharacterView = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  visualNotes: string | null;
  sheetAssetIds: string[];
  basedOnRealPerson: boolean;
  consentConfirmed: boolean;
};

export type LocationView = {
  id: string;
  name: string;
  description: string | null;
  plateAssetIds: string[];
};

export type ClientLibrary = {
  client: { id: string; name: string; slug: string; notes: string | null };
  assets: AssetView[];
  characters: CharacterView[];
  locations: LocationView[];
};

function toAssetView(row: AssetRow, image: SignedImage | null): AssetView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    textContent: row.text_content,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    lineageId: row.lineage_id,
    version: row.version,
    isActive: row.is_active,
    createdAt: row.created_at,
    image,
  };
}

export async function loadClientLibrary(db: Db, clientId: string): Promise<ClientLibrary | null> {
  const [client, assets, characters, locations] = await Promise.all([
    db.from("clients").select("id, name, slug, notes").eq("id", clientId).is("deleted_at", null).maybeSingle(),
    db
      .from("library_assets")
      .select("*")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("kind")
      .order("created_at"),
    db.from("characters").select("*").eq("client_id", clientId).is("deleted_at", null).order("name"),
    db.from("locations").select("*").eq("client_id", clientId).is("deleted_at", null).order("name"),
  ]);
  for (const r of [client, assets, characters, locations]) if (r.error) throw new Error(r.error.message);
  if (!client.data) return null;

  const imagePaths = (assets.data ?? []).flatMap((a) => (a.storage_path ? [a.storage_path] : []));
  const signed = await signImages(db, "library", imagePaths);

  return {
    client: client.data,
    assets: (assets.data ?? []).map((a) => toAssetView(a, a.storage_path ? (signed.get(a.storage_path) ?? null) : null)),
    characters: (characters.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      description: c.description,
      visualNotes: c.visual_notes,
      sheetAssetIds: c.sheet_asset_ids,
      basedOnRealPerson: c.based_on_real_person,
      consentConfirmed: c.consent_confirmed,
    })),
    locations: (locations.data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      plateAssetIds: l.plate_asset_ids,
    })),
  };
}

/** Versión activa de un tipo singular (style bible, system prompts, negativo). */
export async function getActiveText(db: Db, clientId: string, kind: AssetKind): Promise<AssetRow | null> {
  const { data, error } = await db
    .from("library_assets")
    .select("*")
    .eq("client_id", clientId)
    .eq("kind", kind)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Todas las imágenes activas de un tipo (por ejemplo, las hojas de EPP). */
export async function getActiveImages(db: Db, clientId: string, kind: AssetKind): Promise<AssetRow[]> {
  const { data, error } = await db
    .from("library_assets")
    .select("*")
    .eq("client_id", clientId)
    .eq("kind", kind)
    .eq("is_active", true)
    .not("storage_path", "is", null)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return data;
}
