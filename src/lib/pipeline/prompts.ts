import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { FRAMING_LABEL, type Framing } from "./shotlist";

type Shot = Database["public"]["Tables"]["shots"]["Row"];
type Character = Database["public"]["Tables"]["characters"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];

/** Huella de los campos del plano que alimentan el prompt: si cambia, el prompt quedó desactualizado. */
export function shotPromptHash(shot: Pick<Shot, "framing" | "action" | "lighting" | "on_screen_text" | "character_ids" | "location_id" | "vo_line" | "scene_title">): string {
  const payload = JSON.stringify([
    shot.framing,
    shot.action ?? "",
    shot.lighting ?? "",
    shot.on_screen_text ?? "",
    [...shot.character_ids].sort(),
    shot.location_id ?? "",
    shot.vo_line ?? "",
    shot.scene_title ?? "",
  ]);
  return createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

// Encuadre del shot list → entrada de la SHOT LIBRARY de los system prompts de imagen.
const SHOT_LIBRARY: Record<Framing, string> = {
  hero: "HERO (full-body, centered, slightly low eye level, 35mm)",
  wide: "ESTABLISHING (wide, character small in the scene, 24mm)",
  medium: "MEDIUM (waist-up, 3/4 angle, 50mm)",
  closeup: "CLOSE-UP (head and shoulders, 85mm)",
  insert: "INSERT (macro of hands, gloves, gauges, tags or screens, 100mm macro)",
  group: "GROUP (2 to 4 people lined up, 35mm)",
};

const TARGET_MODEL: Record<string, string> = {
  gemini: "Nano Banana (Gemini native image generation)",
  openai: "GPT Image (OpenAI)",
};

export const imagePromptSchema = z.object({
  final_prompt: z.string(),
  negative: z.string(),
  ppe_check: z.string(),
  assumptions: z.string(),
});
export type ImagePromptOutput = z.infer<typeof imagePromptSchema>;

export type PromptShotInput = {
  shot: Shot;
  characters: Character[];
  location: Location | null;
  aspectRatio: string;
  engine: string;
  clientNegative: string | null;
  referenceLabels: string[];
};

function shotBrief({ shot, characters, location }: PromptShotInput): string[] {
  return [
    `Scene: ${shot.scene_number}${shot.scene_title ? ` — ${shot.scene_title}` : ""}`,
    `Shot type: ${SHOT_LIBRARY[shot.framing]} (${FRAMING_LABEL[shot.framing]})`,
    `Action (Spanish, describe it in English in the prompt): ${shot.action ?? "(none)"}`,
    characters.length
      ? `Characters in frame (copy these descriptors verbatim; they override the CAST section):\n${characters
          .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.visual_notes ?? c.description ?? "no descriptor"}`)
          .join("\n")}`
      : "Characters in frame: none (no people unless the action requires hands; then follow the PPE rules)",
    location ? `Location: ${location.name}: ${location.description ?? ""}` : "Location: choose from the ENVIRONMENT CANON",
    shot.lighting ? `Lighting: ${shot.lighting}` : "Lighting: use the default tag",
    shot.on_screen_text ? `On-screen text: "${shot.on_screen_text}" (apply the TEXT rules)` : "On-screen text: none",
    shot.vo_line ? `Voice-over for context only (not spoken on screen): "${shot.vo_line}"` : "",
  ].filter(Boolean);
}

/** Input para Claude con el image system prompt del cliente como system. */
export function buildImagePromptInput(input: PromptShotInput): string {
  return [
    `Target model: ${TARGET_MODEL[input.engine] ?? input.engine}`,
    `Aspect ratio: ${input.aspectRatio}`,
    ...shotBrief(input),
    input.referenceLabels.length
      ? `Reference images that will be attached automatically, in this order: ${input.referenceLabels.join("; ")}`
      : "No reference images will be attached.",
    input.clientNegative ? `Client standard negative line (include it in full in the negative): ${input.clientNegative}` : "",
    "",
    "Return the result as JSON: final_prompt = the FINAL PROMPT ready to paste; negative = the full NEGATIVE / AVOID line; ppe_check = the PPE CHECK line (or \"n/a\" if nobody is in frame); assumptions = the ASSUMPTIONS line.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Input para Claude con el video system prompt del cliente: borrador para la fase 2 (image-to-video). */
export function buildVideoPromptInput(input: PromptShotInput & { imagePrompt: string }): string {
  return [
    "Target model: Veo 3.1 (default), 16:9 unless stated",
    `Aspect ratio: ${input.aspectRatio}`,
    `Start frame: the approved still for this shot, generated from this image prompt:\n${input.imagePrompt}`,
    ...shotBrief(input),
    `Idea: ${input.shot.action ?? ""}. The voice-over line is narration added in post, not dialogue, unless the action says a character speaks.`,
    `Clip length: about ${Math.round(Number(input.shot.est_duration_sec ?? 4))} seconds.`,
  ].join("\n");
}
