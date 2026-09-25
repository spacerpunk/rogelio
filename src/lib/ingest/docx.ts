import mammoth from "mammoth";
import { decodeEntities } from "./xml";

function inline(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, "**$2**")
      .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, "_$2_")
      .replace(/<img[^>]*>/g, "")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

/** HTML simple de mammoth → Markdown (títulos, párrafos, listas y tablas). */
function htmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const pattern = /<(h[1-6]|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const m of html.matchAll(pattern)) {
    const [, tag, inner] = m;
    if (tag.startsWith("h")) {
      const text = inline(inner);
      if (text) blocks.push(`${"#".repeat(Number(tag[1]))} ${text}`);
    } else if (tag === "p") {
      const text = inline(inner);
      if (text) blocks.push(text);
    } else if (tag === "ul" || tag === "ol") {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((li, i) =>
        `${tag === "ol" ? `${i + 1}.` : "-"} ${inline(li[1])}`,
      );
      if (items.length) blocks.push(items.join("\n"));
    } else if (tag === "table") {
      const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) =>
        [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((td) => inline(td[1]).replace(/\n/g, " ")),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
        blocks.push([line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n"));
      }
    }
  }
  return blocks.join("\n\n");
}

export async function extractDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml(
    { buffer },
    // Las imágenes no se embeben en el texto (serían data URIs gigantes).
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  const markdown = htmlToMarkdown(value);
  if (markdown) return markdown;
  // Documento sin estructura reconocible: texto plano.
  return (await mammoth.extractRawText({ buffer })).value.trim();
}
