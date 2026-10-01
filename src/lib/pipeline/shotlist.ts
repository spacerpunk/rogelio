import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { VO_WORDS_PER_SECOND } from "./script";

export type Framing = Database["public"]["Enums"]["shot_framing"];
export const FRAMINGS: Framing[] = ["hero", "wide", "medium", "closeup", "insert", "group"];

export const FRAMING_LABEL: Record<Framing, string> = {
  hero: "Héroe (cuerpo entero)",
  wide: "General",
  medium: "Medio",
  closeup: "Primer plano",
  insert: "Detalle / inserto",
  group: "Grupal",
};

/** Duración estimada de un plano según su locución (~2,5 palabras/s); sin locución, 3 s. */
export function estimateDuration(voLine: string | null | undefined): number {
  const words = (voLine ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 3;
  return Math.max(2, Math.round((words / VO_WORDS_PER_SECOND) * 2) / 2);
}

// Schema de salida del motor de texto (salida estructurada). Los ids se validan contra la biblioteca después.
export const shotlistOutputSchema = z.object({
  shots: z.array(
    z.object({
      scene_number: z.number().int(),
      scene_title: z.string(),
      character_ids: z.array(z.string()),
      location_id: z.string().nullable(),
      framing: z.enum(["hero", "wide", "medium", "closeup", "insert", "group"]),
      lighting: z.string(),
      action: z.string(),
      vo_line: z.string(),
      on_screen_text: z.string(),
      notes: z.string(),
    }),
  ),
});
export type ShotlistOutput = z.infer<typeof shotlistOutputSchema>;

export const SHOTLIST_SYSTEM = `Sos asistente de dirección de una productora de videos de capacitación. A partir de un guion aprobado armás el shot list: la lista estructurada de planos que después se usa para generar imágenes y video con IA.

Reglas:
- Si el guion tiene TOMAS numeradas ("### TOMA 001 · …"), cada TOMA es un plano, en el mismo orden. No agregues ni saques tomas. Ignorá las secciones que no son tomas (Ficha, Personajes, Quiz, Cierre).
- Si el guion no tiene TOMAS (por ejemplo, un guion subido con otro formato), dividilo vos en planos siguiendo el orden del texto: un plano por cada línea de locución o cambio claro de acción visual, sin omitir ni reescribir ninguna locución.
- scene_number y scene_title salen del encabezado de escena que contiene la toma ("Escena N — título" o el equivalente del guion); si el guion no tiene escenas, usá 1 y el título del documento.
- vo_line: la locución de la toma, textual, sin reescribirla. Cadena vacía si la toma no tiene locución.
- action: qué se ve, en español, concreto y filmable: quién, qué hace, con qué manos, hacia dónde mira, qué equipo aparece. Una sola acción clara.
- character_ids: los ids de los personajes que aparecen en cuadro, tomados de la lista. Lista vacía si no aparece nadie. Nunca inventes ids.
- location_id: el id de la locación de la lista que mejor corresponde; null si ninguna aplica.
- framing según el tipo de plano: plano general, drone o establishing → wide; plano entero o héroe de cuerpo completo → hero; plano medio, travelling, steadicam o walk-and-talk → medium; primer plano → closeup; plano detalle, macro o inserto de manos, pantallas o instrumentos → insert; tres o más personajes juntos en cuadro → group. Un POV se resuelve como insert o medium según lo que se vea.
- lighting: breve y coherente con la style bible (por ejemplo "mediodía, sol duro, cielo azul profundo", "hora dorada, luz rasante cálida", "interior, luz cálida de ventana y fluorescente").
- on_screen_text: el texto en pantalla de la toma, o cadena vacía.
- notes: "Plano: {tipo original} · Objetivo: {objetivo pedagógico} · Emoción: {emoción}", compacto.`;

type Named = { id: string; name: string; description: string | null };

export function buildShotlistPrompt(input: {
  scriptVersion: number;
  script: string;
  styleBible: string | null;
  characters: (Named & { role: string | null })[];
  locations: Named[];
}): string {
  const characters = input.characters.length
    ? input.characters.map((c) => `- id=${c.id} · ${c.name}${c.role ? ` (${c.role})` : ""}`).join("\n")
    : "(ninguno)";
  const locations = input.locations.length
    ? input.locations.map((l) => `- id=${l.id} · ${l.name}${l.description ? `: ${l.description.slice(0, 160)}` : ""}`).join("\n")
    : "(ninguna)";
  return [
    input.styleBible?.trim() && `<style_bible>\n${input.styleBible.trim()}\n</style_bible>`,
    `<personajes>\n${characters}\n</personajes>`,
    `<locaciones>\n${locations}\n</locaciones>`,
    `<guion version="${input.scriptVersion}">\n${input.script}\n</guion>`,
    "Armá el shot list completo del guion.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
