import { z } from "zod";

/** Palabras por segundo de locución en español (ritmo de capacitación). */
export const VO_WORDS_PER_SECOND = 2.5;

export const TONES = ["Cercano", "Inspiracional", "Urgente", "Emocional", "Técnico", "Humor", "Épico", "Documental"] as const;
export const EXPERIENCE_LEVELS = ["Sin experiencia", "Básica", "Intermedia", "Avanzada"] as const;
export const INCLUDE_OPTIONS = ["Quiz por módulo", "Errores frecuentes", "Simulación", "Evaluación final", "Checklist operativo", "Certificación"] as const;

export const scriptParamsSchema = z.object({
  targetMinutes: z.number().positive("La duración tiene que ser mayor a 0").max(60),
  tone: z.string().trim().min(1),
  audience: z.string().trim(),
  experience: z.string().trim(),
  objective: z.string().trim(),
  language: z.string().trim().min(1),
  include: z.array(z.string()),
  characterIds: z.array(z.uuid()),
  extra: z.string().trim(),
});
export type ScriptParams = z.infer<typeof scriptParamsSchema>;

export function defaultScriptParams(targetSec: number | null, characterIds: string[]): ScriptParams {
  return {
    targetMinutes: targetSec ? Math.round((targetSec / 60) * 10) / 10 : 3,
    tone: "Cercano",
    audience: "",
    experience: "Básica",
    objective: "",
    language: "Español rioplatense (Argentina), con voseo",
    include: ["Quiz por módulo", "Errores frecuentes"],
    characterIds,
    extra: "",
  };
}

/** Tomas de referencia según la duración (el master prompt usa ~9 tomas por minuto). */
export function targetShotCount(minutes: number): number {
  return Math.max(6, Math.round(minutes * 9));
}

type Named = { name: string; description?: string | null; role?: string | null };

export type ScriptPromptInput = {
  masterPrompt: string | null;
  styleBible: string | null;
  client: string;
  projectTitle: string;
  aspectRatio: string;
  params: ScriptParams;
  sources: { name: string; text: string; notes: string | null }[];
  characters: Named[];
  locations: Named[];
  previous?: { version: number; content: string; instructions: string };
};

// Contrato de formato de la app: el shot list se deriva de estas tomas, así que el formato es fijo.
const FORMAT_CONTRACT = `FORMATO DE SALIDA DE ESTA APP (obligatorio, tiene prioridad sobre cualquier otro formato de entrega)
Devolvé solo el guion en Markdown, sin comentarios antes ni después, con esta estructura:

# {Título del curso}

## Ficha
Objetivo, audiencia, duración estimada, variables detectadas y supuestos (listas cortas).

## Personajes
Una línea por personaje usado: nombre — rol en esta historia.

## Escena 1 — {Título de la escena o módulo}
Objetivo de la escena en una línea.

### TOMA 001 · {segundos} s · {Tipo de plano}
- **Locución:** {texto de la voz en off, máximo 18 palabras; vacío si la toma es solo visual}
- **Acción visual:** {qué se ve, como storyboard}
- **Personajes:** {nombres exactos de la lista, separados por coma, o "ninguno"}
- **Locación:** {nombre exacto de la lista}
- **Texto en pantalla:** {texto corto o "ninguno"}
- **Objetivo pedagógico:** {qué aprende el alumno}
- **Emoción:** {emoción buscada}

(… más tomas numeradas de forma continua en todo el guion: TOMA 001, TOMA 002, …)

### Quiz
Pregunta, 4 opciones (marcá la correcta) y explicación, si corresponde incluir quiz.

(… más escenas: Escena 2, Escena 3, …)

## Cierre
Resumen, simulación, evaluación, checklist y certificación si corresponden, en texto breve (no son tomas).

Reglas de esta app:
- No hagas preguntas: si falta un dato, asumilo y anotalo en "Ficha".
- Usá solo los personajes y las locaciones de las listas, con sus nombres exactos. No inventes personajes nuevos.
- Toda escena visual va dividida en tomas con el formato de arriba; la suma de las tomas es la duración del video.`;

function list(items: Named[]): string {
  if (items.length === 0) return "(ninguno cargado)";
  return items
    .map((i) => `- ${i.name}${i.role ? ` (${i.role})` : ""}${i.description ? `: ${i.description}` : ""}`)
    .join("\n");
}

export function buildScriptPrompt(input: ScriptPromptInput): { system: string; user: string } {
  const { params } = input;
  const system = [input.masterPrompt?.trim() || "Sos guionista de videos de capacitación para trabajadores de primera línea.", FORMAT_CONTRACT].join(
    "\n\n---\n\n",
  );

  const sources = input.sources
    .map(
      (s, i) =>
        `<fuente numero="${i + 1}" nombre="${s.name}">\n${s.text.trim()}${s.notes?.trim() ? `\n\n[Notas del orador]\n${s.notes.trim()}` : ""}\n</fuente>`,
    )
    .join("\n\n");

  const variables = [
    `Empresa: ${input.client}`,
    `Proyecto: ${input.projectTitle}`,
    `Idioma de la locución: ${params.language}`,
    `Duración objetivo: ${params.targetMinutes} minutos (referencia: unas ${targetShotCount(params.targetMinutes)} tomas de 3 a 6 segundos)`,
    `Formato de imagen: ${input.aspectRatio}`,
    `Estilo narrativo: ${params.tone}`,
    params.audience && `Perfil del alumno: ${params.audience}`,
    params.experience && `Experiencia previa: ${params.experience}`,
    params.objective && `Objetivo del curso: ${params.objective}`,
    `Debe incluir: ${params.include.length ? params.include.join(", ") : "nada adicional"}`,
    params.extra && `Indicaciones adicionales: ${params.extra}`,
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [
    `<variables>\n${variables}\n</variables>`,
    input.styleBible?.trim() && `<style_bible>\n${input.styleBible.trim()}\n</style_bible>`,
    `<personajes_disponibles>\n${list(input.characters)}\n</personajes_disponibles>`,
    `<locaciones_disponibles>\n${list(input.locations)}\n</locaciones_disponibles>`,
    `<material>\n${sources}\n</material>`,
  ];

  if (input.previous) {
    parts.push(
      `<guion_anterior version="${input.previous.version}">\n${input.previous.content}\n</guion_anterior>`,
      `Reescribí el guion anterior aplicando estas indicaciones y manteniendo lo que no contradigan:\n${input.previous.instructions}`,
    );
  } else {
    parts.push("Escribí el guion completo del video a partir del material.");
  }

  return { system, user: parts.filter(Boolean).join("\n\n") };
}

/** Estadísticas del guion: cantidad de tomas y duración (declarada o estimada por la locución). */
export function scriptStats(markdown: string): { shots: number; seconds: number } {
  const headers = [...markdown.matchAll(/^###\s+TOMA\s+\d+[^\n]*$/gim)];
  let seconds = 0;
  for (const h of headers) {
    const declared = h[0].match(/·\s*(\d+(?:[.,]\d+)?)\s*s\b/i);
    if (declared) {
      seconds += Number(declared[1].replace(",", "."));
      continue;
    }
    const block = markdown.slice(h.index ?? 0).split(/\n###\s/)[0];
    const vo = block.match(/\*\*Locución:\*\*\s*(.+)/i)?.[1] ?? "";
    seconds += Math.max(3, vo.split(/\s+/).filter(Boolean).length / VO_WORDS_PER_SECOND);
  }
  return { shots: headers.length, seconds: Math.round(seconds) };
}
