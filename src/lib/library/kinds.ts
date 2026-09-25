import type { Database } from "@/lib/supabase/database.types";

export type AssetKind = Database["public"]["Enums"]["asset_kind"];

type KindInfo = {
  label: string;
  /** Solo una versión activa por cliente: es la que usa el pipeline. */
  singular: boolean;
  media: "text" | "image" | "both";
};

export const ASSET_KINDS: Record<AssetKind, KindInfo> = {
  style_bible: { label: "Style bible", singular: true, media: "text" },
  script_system_prompt: { label: "System prompt de guion", singular: true, media: "text" },
  image_system_prompt: { label: "System prompt de imagen", singular: true, media: "text" },
  video_system_prompt: { label: "System prompt de video", singular: true, media: "text" },
  negative_prompt: { label: "Negativo de imagen", singular: true, media: "text" },
  ppe_sheet: { label: "Hoja de EPP", singular: false, media: "image" },
  logo: { label: "Logo", singular: false, media: "image" },
  character_sheet: { label: "Character sheet", singular: false, media: "image" },
  location_plate: { label: "Location plate", singular: false, media: "image" },
  reference_other: { label: "Otra referencia", singular: false, media: "both" },
};

export const TEXT_KINDS = (Object.keys(ASSET_KINDS) as AssetKind[]).filter((k) => ASSET_KINDS[k].media !== "image");
export const IMAGE_KINDS = (Object.keys(ASSET_KINDS) as AssetKind[]).filter((k) => ASSET_KINDS[k].media !== "text");

export function kindLabel(kind: AssetKind): string {
  return ASSET_KINDS[kind].label;
}
