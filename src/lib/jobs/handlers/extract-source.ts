import { z } from "zod";
import { getTextEngine } from "@/lib/engines/registry";
import { extractDocx } from "@/lib/ingest/docx";
import { sourceKind } from "@/lib/ingest/kinds";
import { extractPptx, pptxToMarkdown } from "@/lib/ingest/pptx";
import { downloadBuffer, ensureThumbnail, safeFileName } from "@/lib/storage";
import type { JobHandler } from "../types";

// El límite de la API es 32 MB por request; en base64 el PDF crece ~33 %.
const MAX_PDF_BYTES = 24 * 1024 * 1024;

const PDF_SYSTEM =
  "Transcribís documentos de capacitación para una productora de video. Tu salida es la materia prima con la que después se escribe un guion, así que tiene que ser fiel y completa.";

const PDF_INSTRUCTIONS = `Extraé el contenido completo de este documento en Markdown, en el orden original.

- Usá "## Página N" como encabezado de cada página (o "## Diapositiva N" si es una presentación exportada).
- Transcribí todo el texto relevante: títulos, viñetas, pasos, advertencias, tablas (como tablas Markdown) y notas importantes. No resumas ni omitas pasos de procedimientos.
- Describí brevemente entre corchetes las fotos, diagramas e ilustraciones que aportan información. Ejemplo: [Foto: operario con guantes de cuero ajustando una válvula roja].
- Ignorá encabezados y pies de página repetidos, números de página y logos.
- Devolvé solo el contenido, sin comentarios antes ni después.`;

export const extractSource: JobHandler = async (ctx) => {
  const { sourceId } = z.object({ sourceId: z.uuid() }).parse(ctx.job.payload);
  const { db } = ctx;
  const { data: source, error } = await db.from("sources").select("*").eq("id", sourceId).single();
  if (error || !source) throw new Error("No encontré la fuente a extraer.");
  if (!source.storage_path) return { skipped: "texto pegado" };

  const kind = sourceKind(source.mime_type, source.file_name);
  if (!kind) throw new Error(`Formato no soportado: ${source.file_name}`);

  await ctx.progress(0, 1, "Descargando archivo");
  const file = await downloadBuffer(db, "projects", source.storage_path);

  let extractedText = "";
  let extractedNotes: string | null = null;
  const extractedImages: string[] = [];

  if (kind === "pdf") {
    if (file.length > MAX_PDF_BYTES) {
      throw new Error("El PDF pesa más de 24 MB: dividilo o exportalo más liviano para que Claude pueda leerlo.");
    }
    const engine = getTextEngine();
    await ctx.progress(0, 1, "Claude está leyendo el PDF");
    const result = await ctx.track(engine, "extract_pdf", () =>
      engine.complete({
        system: PDF_SYSTEM,
        content: [
          { type: "pdf", data: file },
          { type: "text", text: PDF_INSTRUCTIONS },
        ],
        effort: "medium",
      }),
    );
    extractedText = result.text;
  } else if (kind === "pptx") {
    await ctx.progress(0, 1, "Leyendo diapositivas");
    const content = await extractPptx(file);
    const markdown = pptxToMarkdown(content);
    extractedText = markdown.text;
    extractedNotes = markdown.notes || null;

    const folder = `${source.project_id}/sources/${source.id}/images`;
    for (const [i, image] of content.images.entries()) {
      await ctx.progress(i, content.images.length, `Guardando imágenes (${i + 1}/${content.images.length})`);
      const storagePath = `${folder}/diapo-${String(image.firstSlide).padStart(3, "0")}-${safeFileName(image.fileName)}`;
      await db.storage.from("projects").upload(storagePath, image.data, { contentType: image.mimeType, upsert: true });
      await ensureThumbnail(db, "projects", storagePath, image.data);
      extractedImages.push(storagePath);
    }
  } else if (kind === "docx") {
    await ctx.progress(0, 1, "Leyendo documento");
    extractedText = await extractDocx(file);
  } else {
    extractedText = file.toString("utf8").trim();
  }

  if (!extractedText.trim()) throw new Error("No se encontró texto en el archivo.");

  const { error: updateError } = await db
    .from("sources")
    .update({ extracted_text: extractedText, extracted_notes: extractedNotes, extracted_images: extractedImages })
    .eq("id", source.id);
  if (updateError) throw new Error(`No se pudo guardar el texto extraído: ${updateError.message}`);

  await ctx.progress(1, 1, "Listo");
  return { characters: extractedText.length, images: extractedImages.length };
};
