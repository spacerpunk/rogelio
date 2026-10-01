import { z } from "zod";
import { getTextEngine } from "@/lib/engines/registry";
import { extractDocx } from "@/lib/ingest/docx";
import { scriptFileKind } from "@/lib/ingest/kinds";
import { advanceProjectStatus, insertScriptVersion } from "@/lib/pipeline/context";
import { downloadBuffer } from "@/lib/storage";
import type { JobHandler } from "../types";

// El límite de la API es 32 MB por request; en base64 el PDF crece ~33 %.
const MAX_PDF_BYTES = 24 * 1024 * 1024;

const PDF_SYSTEM =
  "Transcribís guiones de videos de capacitación. La transcripción se usa tal cual como guion del video, así que tiene que ser textual y completa.";

const PDF_INSTRUCTIONS = `Transcribí este guion completo en Markdown, en el orden original.

- Copiá el texto palabra por palabra: locuciones, diálogos, indicaciones visuales, títulos de escena, tiempos y notas. No resumas, no corrijas ni reescribas.
- Conservá la estructura: escenas o secuencias como encabezados, y los guiones a dos columnas (video / audio) como tablas Markdown.
- Ignorá encabezados y pies de página repetidos, números de página y logos.
- Devolvé solo el guion, sin comentarios antes ni después.`;

const payloadSchema = z.object({ path: z.string().min(1), fileName: z.string().min(1), mimeType: z.string() });

/** Guion que ya existe: se guarda tal cual como versión nueva. Solo el PDF pasa por el motor de texto. */
export const importScript: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const { path, fileName, mimeType } = payloadSchema.parse(job.payload);
  const kind = scriptFileKind(mimeType, fileName);
  if (!kind) throw new Error(`Formato no soportado: ${fileName}`);

  await ctx.progress(0, 1, "Descargando archivo");
  const file = await downloadBuffer(db, "projects", path);

  let content: string;
  let model: string | null = null;
  if (kind === "pdf") {
    if (file.length > MAX_PDF_BYTES) {
      throw new Error("El PDF pesa más de 24 MB: dividilo o exportalo más liviano para que el motor de texto pueda leerlo.");
    }
    const { data: project } = await db.from("projects").select("text_engine").eq("id", job.project_id).single();
    const engine = getTextEngine(project?.text_engine ?? null);
    await ctx.progress(0, 1, `${engine.label} está leyendo el guion`);
    const result = await ctx.track(engine, "import_script_pdf", () =>
      engine.complete({
        system: PDF_SYSTEM,
        content: [
          { type: "pdf", data: file },
          { type: "text", text: PDF_INSTRUCTIONS },
        ],
        maxTokens: 64_000,
        effort: "medium",
      }),
    );
    content = result.text;
    model = result.model;
  } else if (kind === "docx") {
    await ctx.progress(0, 1, "Leyendo el documento");
    content = await extractDocx(file);
  } else {
    content = file.toString("utf8").replace(/\r\n/g, "\n").trim();
  }
  if (!content.trim()) throw new Error(`No se encontró texto en ${fileName}.`);

  const version = await insertScriptVersion(db, job.project_id, content, {
    imported: true,
    fileName,
    ...(model ? { model } : {}),
    jobId: job.id,
  });
  await advanceProjectStatus(db, job.project_id, "script");
  await ctx.progress(1, 1, "Listo");
  return { version, characters: content.length };
};
