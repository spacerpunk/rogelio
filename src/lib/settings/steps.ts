import { PDF_INSTRUCTIONS, PDF_SYSTEM, SCRIPT_PDF_INSTRUCTIONS, SCRIPT_PDF_SYSTEM } from "@/lib/ingest/pdf-prompts";
import type { AssetKind } from "@/lib/library/kinds";
import { ADAPT_RULES, FORMAT_CONTRACT } from "@/lib/pipeline/script";
import { SHOTLIST_SYSTEM } from "@/lib/pipeline/shotlist";

// Qué textos recibe el motor en cada paso del pipeline, en el orden en que se arma el pedido.
// "library": texto de la biblioteca del cliente (versionado, editable). "internal": texto fijo de la app (código).
// "assembled": lo que la app arma con los datos del proyecto en cada llamada.

export type PromptPiece =
  | { type: "library"; kind: AssetKind; role: string; note: string }
  | { type: "internal"; title: string; role: string; note: string; content: string; source: string }
  | { type: "assembled"; title: string; role: string; note: string };

export type PipelineStep = {
  key: string;
  label: string;
  /** Pantalla del proyecto donde corre. */
  where: string;
  engine: string;
  description: string;
  pieces: PromptPiece[];
};

const SYSTEM = "System prompt";
const SYSTEM_AFTER = "System prompt · se agrega después";
const MESSAGE = "Mensaje";

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "sources",
    label: "Lectura de PDF",
    where: "Fuentes",
    engine: "Motor de texto del proyecto",
    description: "Transcribe los PDF de las fuentes a Markdown. Los PPTX, DOCX y textos pegados se leen sin IA.",
    pieces: [
      { type: "internal", title: "Transcripción de fuentes", role: SYSTEM, note: "", content: PDF_SYSTEM, source: "src/lib/ingest/pdf-prompts.ts" },
      {
        type: "internal",
        title: "Instrucciones de extracción",
        role: `${MESSAGE} · junto al PDF`,
        note: "",
        content: PDF_INSTRUCTIONS,
        source: "src/lib/ingest/pdf-prompts.ts",
      },
    ],
  },
  {
    key: "script",
    label: "Guion",
    where: "Guion",
    engine: "Motor de texto del proyecto",
    description: "Escribe el guion por escenas y tomas a partir de las fuentes, la style bible y los parámetros del proyecto.",
    pieces: [
      {
        type: "library",
        kind: "script_system_prompt",
        role: SYSTEM,
        note: "El master prompt del cliente: cómo escribir el guion (estructura pedagógica, tono, reglas).",
      },
      {
        type: "internal",
        title: "Contrato de formato",
        role: SYSTEM_AFTER,
        note: "Fija el formato de escenas y tomas que la app necesita para armar el shot list. Tiene prioridad sobre el formato del master prompt.",
        content: FORMAT_CONTRACT,
        source: "src/lib/pipeline/script.ts",
      },
      { type: "library", kind: "style_bible", role: MESSAGE, note: "Se incluye completa en el mensaje, dentro de <style_bible>." },
      {
        type: "assembled",
        title: "Variables, personajes, locaciones y fuentes",
        role: MESSAGE,
        note: "Duración, tono, público y demás parámetros; los personajes elegidos; las locaciones con su código (P1, P7…); el texto de las fuentes. Con «Regenerar con indicaciones» se suman la versión anterior y las indicaciones.",
      },
    ],
  },
  {
    key: "script_upload",
    label: "Guion subido",
    where: "Guion · Subir guion",
    engine: "Motor de texto del proyecto",
    description: "Un guion que ya existe: si es PDF se transcribe textual; «Adaptar al formato» lo pasa a escenas y tomas sin reescribirlo.",
    pieces: [
      { type: "internal", title: "Transcripción de guion (PDF)", role: SYSTEM, note: "", content: SCRIPT_PDF_SYSTEM, source: "src/lib/ingest/pdf-prompts.ts" },
      {
        type: "internal",
        title: "Instrucciones de transcripción (PDF)",
        role: `${MESSAGE} · junto al PDF`,
        note: "",
        content: SCRIPT_PDF_INSTRUCTIONS,
        source: "src/lib/ingest/pdf-prompts.ts",
      },
      {
        type: "internal",
        title: "Reglas de adaptación al formato",
        role: `${SYSTEM} · Adaptar al formato`,
        note: "",
        content: ADAPT_RULES,
        source: "src/lib/pipeline/script.ts",
      },
      {
        type: "internal",
        title: "Contrato de formato",
        role: SYSTEM_AFTER,
        note: "El mismo contrato que usa el guion generado.",
        content: FORMAT_CONTRACT,
        source: "src/lib/pipeline/script.ts",
      },
      { type: "assembled", title: "Guion original, personajes y locaciones", role: MESSAGE, note: "El guion subido tal cual, con las listas del cliente." },
    ],
  },
  {
    key: "shotlist",
    label: "Shot list",
    where: "Shot list",
    engine: "Motor de texto del proyecto",
    description: "Convierte el guion aprobado en planos estructurados (JSON validado), usando solo personajes y locaciones del cliente.",
    pieces: [
      {
        type: "internal",
        title: "Asistente de dirección",
        role: SYSTEM,
        note: "Define los campos de cada plano; la salida se valida contra un schema.",
        content: SHOTLIST_SYSTEM,
        source: "src/lib/pipeline/shotlist.ts",
      },
      { type: "library", kind: "style_bible", role: MESSAGE, note: "Se incluye completa en el mensaje." },
      {
        type: "assembled",
        title: "Personajes, locaciones y guion aprobado",
        role: MESSAGE,
        note: "Personajes y locaciones con sus ids (las locaciones con su código) y el guion aprobado.",
      },
    ],
  },
  {
    key: "image",
    label: "Prompts de imagen",
    where: "Frames",
    engine: "Motor de texto del proyecto → motor de imagen",
    description: "Escribe el prompt y el negativo de cada plano. El motor de imagen recibe además las sheets de los personajes, las plates de la locación y la hoja de EPP.",
    pieces: [
      { type: "library", kind: "image_system_prompt", role: SYSTEM, note: "Cómo escribir los prompts de imagen del cliente." },
      {
        type: "library",
        kind: "negative_prompt",
        role: MESSAGE,
        note: "Se pide incluirlo completo en el negativo de cada plano.",
      },
      {
        type: "assembled",
        title: "Datos del plano",
        role: MESSAGE,
        note: "Modelo y resolución de imagen, encuadre, acción, personajes (con sus notas visuales), locación con su descripción, luz, texto en pantalla, locución y la lista de referencias que se adjuntan.",
      },
    ],
  },
  {
    key: "video",
    label: "Prompts de video",
    where: "Video",
    engine: "Motor de texto del proyecto → motor de video",
    description: "Mira el frame aprobado de cada plano, lo revisa y escribe el prompt de video, la línea Avoid y los segundos a generar. El motor de video recibe el frame como primer cuadro y las sheets de los personajes.",
    pieces: [
      { type: "library", kind: "video_system_prompt", role: SYSTEM, note: "Cómo escribir los prompts de imagen a video del cliente (reparto, módulo de marca, reglas)." },
      {
        type: "assembled",
        title: "Frame aprobado y datos del plano",
        role: MESSAGE,
        note: "La imagen del frame aprobado, el modelo de video, formato y resolución, el modo logo del proyecto, la idea (acción), la locución, la duración útil, los personajes, la locación y la nota de revisión del frame. Se pide la salida en JSON (prompt, avoid, segundos, correcciones).",
      },
    ],
  },
];
