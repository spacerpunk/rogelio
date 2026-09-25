import JSZip from "jszip";
import path from "node:path";
import { attributes, decodeEntities } from "./xml";

export type PptxImage = { zipPath: string; fileName: string; data: Buffer; mimeType: string; firstSlide: number };
export type PptxSlide = { index: number; paragraphs: string[]; notes: string[]; imagePaths: string[] };
export type PptxContent = { slides: PptxSlide[]; images: PptxImage[] };

const WEB_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

type Relationship = { id: string; type: string; target: string; external: boolean };

async function readText(zip: JSZip, file: string): Promise<string | null> {
  return (await zip.file(file)?.async("string")) ?? null;
}

async function readRels(zip: JSZip, relsPath: string): Promise<Relationship[]> {
  const xml = await readText(zip, relsPath);
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => {
    const a = attributes(m[0]);
    return { id: a.Id, type: a.Type ?? "", target: a.Target ?? "", external: a.TargetMode === "External" };
  });
}

/** Resuelve el Target de una relación relativo a la carpeta de la parte que la declara. */
function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(partPath), target));
}

function relsPathFor(partPath: string): string {
  return path.posix.join(path.posix.dirname(partPath), "_rels", `${path.posix.basename(partPath)}.rels`);
}

function paragraphText(inner: string): string {
  return (
    inner
      .replace(/<a:br\b[^>]*\/>/g, "<a:t>\n</a:t>")
      .match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g)
      ?.map((t) => decodeEntities(t.replace(/<\/?a:t[^>]*>/g, "")))
      .join("")
      .trim() ?? ""
  );
}

function tableMarkdown(tableXml: string): string {
  const rows = [...tableXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((tr) =>
    [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) =>
      [...tc[0].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
        .map((p) => paragraphText(p[1]))
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

/** Bloques de texto de un fragmento DrawingML en orden: párrafos (<a:p>) y tablas (<a:tbl>) como Markdown. */
function paragraphs(xml: string): string[] {
  const result: string[] = [];
  for (const m of xml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const text = m[0].startsWith("<a:tbl") ? tableMarkdown(m[0]) : paragraphText(m[1]);
    if (text) result.push(text);
  }
  return result;
}

/** En las notas solo interesa el placeholder de cuerpo (el resto es número de diapositiva, etc.). */
function notesParagraphs(xml: string): string[] {
  const shapes = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? [];
  const body = shapes.filter((s) => /<p:ph\b[^>]*type="body"/.test(s));
  return (body.length ? body : shapes.filter((s) => !/<p:ph\b[^>]*type="(sldNum|sldImg|hdr|ftr|dt)"/.test(s))).flatMap(paragraphs);
}

export async function extractPptx(buffer: Buffer): Promise<PptxContent> {
  const zip = await JSZip.loadAsync(buffer);
  const presentation = await readText(zip, "ppt/presentation.xml");
  if (!presentation) throw new Error("El archivo no parece un PPTX válido (falta ppt/presentation.xml).");

  const presentationRels = await readRels(zip, "ppt/_rels/presentation.xml.rels");
  const slideIds = [...presentation.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => attributes(m[0])["r:id"]);
  const slidePaths = slideIds
    .map((rid) => presentationRels.find((r) => r.id === rid))
    .filter((r): r is Relationship => Boolean(r))
    .map((r) => resolveTarget("ppt/presentation.xml", r.target));

  const slides: PptxSlide[] = [];
  const images = new Map<string, PptxImage>();

  for (const [i, slidePath] of slidePaths.entries()) {
    const index = i + 1;
    const xml = (await readText(zip, slidePath)) ?? "";
    const rels = await readRels(zip, relsPathFor(slidePath));

    const notesRel = rels.find((r) => r.type.endsWith("/notesSlide"));
    const notesXml = notesRel ? await readText(zip, resolveTarget(slidePath, notesRel.target)) : null;

    const imagePaths: string[] = [];
    for (const rel of rels.filter((r) => r.type.endsWith("/image") && !r.external)) {
      const zipPath = resolveTarget(slidePath, rel.target);
      const mimeType = WEB_IMAGE_TYPES[path.posix.extname(zipPath).toLowerCase()];
      if (!mimeType) continue; // EMF/WMF/TIFF no se pueden mostrar en el navegador
      imagePaths.push(zipPath);
      if (!images.has(zipPath)) {
        const data = await zip.file(zipPath)?.async("nodebuffer");
        if (data) images.set(zipPath, { zipPath, fileName: path.posix.basename(zipPath), data, mimeType, firstSlide: index });
      }
    }

    slides.push({ index, paragraphs: paragraphs(xml), notes: notesXml ? notesParagraphs(notesXml) : [], imagePaths });
  }

  return { slides, images: [...images.values()] };
}

export function pptxToMarkdown(content: PptxContent): { text: string; notes: string } {
  const text = content.slides
    .map((s) => `## Diapositiva ${s.index}\n\n${s.paragraphs.length ? s.paragraphs.join("\n") : "(sin texto)"}`)
    .join("\n\n");
  const notes = content.slides
    .filter((s) => s.notes.length)
    .map((s) => `## Diapositiva ${s.index}\n\n${s.notes.join("\n")}`)
    .join("\n\n");
  return { text, notes };
}
