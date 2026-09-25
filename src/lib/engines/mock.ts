import sharp from "sharp";
import { z } from "zod";
import type { ImageEngine, ImageRequest, TextEngine, TextRequest } from "./types";

// Motores simulados para probar el flujo sin claves ni costo. Se activan con ENGINE_MOCK=1.
// Devuelven datos plausibles: el guion sigue el contrato de formato y los JSON cumplen el schema.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function promptText(opts: TextRequest): string {
  const content = typeof opts.content === "string" ? opts.content : opts.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return `${opts.system ?? ""}\n${content}`;
}

function listNames(text: string, tag: string): string[] {
  const block = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
  return [...block.matchAll(/^- ([^(:\n]+)/gm)].map((m) => m[1].trim());
}

function mockScript(text: string): string {
  const characters = listNames(text, "personajes_disponibles");
  const locations = listNames(text, "locaciones_disponibles");
  const pick = <T,>(arr: T[], i: number, fallback: T) => (arr.length ? arr[i % arr.length] : fallback);
  const planes = ["Plano general", "Plano medio", "Primer plano", "Plano detalle", "POV"];
  let toma = 0;
  const scene = (n: number, title: string) => {
    const shots = Array.from({ length: 4 }, (_, i) => {
      toma++;
      return `### TOMA ${String(toma).padStart(3, "0")} · 4 s · ${planes[(toma - 1) % planes.length]}
- **Locución:** Frase de prueba número ${toma} para la escena ${n}, clara y corta.
- **Acción visual:** ${pick(characters, toma, "Un operario")} realiza el paso ${i + 1} con todo el EPP puesto.
- **Personajes:** ${pick(characters, toma, "ninguno")}
- **Locación:** ${pick(locations, n, "Locación genérica")}
- **Texto en pantalla:** ninguno
- **Objetivo pedagógico:** Reconocer el paso ${i + 1}.
- **Emoción:** Seguridad`;
    }).join("\n\n");
    return `## Escena ${n} — ${title}\nObjetivo de prueba de la escena.\n\n${shots}\n\n### Quiz\n¿Cuál es el paso correcto? (a) correcto ✓ (b) (c) (d)`;
  };
  return `# Guion de prueba (motor simulado)\n\n## Ficha\n- Generado con ENGINE_MOCK=1: no es contenido real.\n\n## Personajes\n${characters
    .slice(0, 3)
    .map((c) => `- ${c} — protagonista de prueba`)
    .join("\n")}\n\n${scene(1, "Por qué importa")}\n\n${scene(2, "El procedimiento")}\n\n${scene(3, "Errores frecuentes")}\n\n## Cierre\nResumen de prueba.`;
}

/** Genera un valor de ejemplo que cumple un JSON Schema (con los uuids del prompt para los campos uuid). */
function sample(schema: Record<string, unknown>, ctx: { uuids: string[]; i: number; key: string }): unknown {
  const type = schema.type;
  if (Array.isArray(schema.enum)) return schema.enum[ctx.i % schema.enum.length];
  if (schema.anyOf) return sample((schema.anyOf as Record<string, unknown>[])[0], ctx);
  if (type === "object") {
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sample(v, { ...ctx, key: k })]));
  }
  if (type === "array") {
    const items = schema.items as Record<string, unknown>;
    const isIdList = /id/i.test(ctx.key);
    const count = isIdList ? Math.min(ctx.uuids.length, 1 + (ctx.i % 2)) : 8;
    return Array.from({ length: count }, (_, i) => sample(items, { ...ctx, i: ctx.i + i }));
  }
  if (type === "integer" || type === "number") return /scene/i.test(ctx.key) ? 1 + Math.floor(ctx.i / 3) : 4;
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (schema.format === "uuid" || /(^|_)id$/i.test(ctx.key)) return ctx.uuids.length ? ctx.uuids[ctx.i % ctx.uuids.length] : null;
  return `Texto de prueba (${ctx.key} ${ctx.i + 1})`;
}

export class MockTextEngine implements TextEngine {
  readonly name = "mock";
  readonly model = "mock-text";

  async complete(opts: TextRequest) {
    await delay(1500);
    const text = promptText(opts);
    const output = text.includes("FORMATO DE SALIDA DE ESTA APP") ? mockScript(text) : "## Página 1\n\nContenido de prueba del documento.";
    return { text: output, model: this.model, usage: { inputTokens: text.length / 4, outputTokens: output.length / 4 }, costUsd: 0, durationMs: 1500 };
  }

  async structured<T>(opts: TextRequest, schema: z.ZodType<T>) {
    await delay(1500);
    const text = promptText(opts);
    const uuids = [...new Set(text.match(UUID) ?? [])];
    const json = sample(z.toJSONSchema(schema) as Record<string, unknown>, { uuids, i: 0, key: "root" });
    return { data: schema.parse(json), model: this.model, usage: {}, costUsd: 0, durationMs: 1500 };
  }
}

const COLORS = ["#1e3a8a", "#7c2d12", "#14532d", "#4c1d95", "#713f12", "#0f766e"];

export class MockImageEngine implements ImageEngine {
  readonly label = "Simulado";
  readonly model = "mock-image";
  constructor(readonly name = "mock") {}

  async generate(opts: ImageRequest) {
    await delay(1200);
    const [w, h] = opts.aspectRatio === "9:16" ? [576, 1024] : opts.aspectRatio === "1:1" ? [768, 768] : [1024, 576];
    const escape = (s: string) => s.replace(/[<>&"]/g, "");
    const images = await Promise.all(
      Array.from({ length: opts.n }, (_, i) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
          <rect width="100%" height="100%" fill="${COLORS[(i + opts.prompt.length) % COLORS.length]}"/>
          <text x="32" y="64" font-family="sans-serif" font-size="36" fill="white">Frame simulado ${i + 1}/${opts.n}</text>
          <text x="32" y="110" font-family="sans-serif" font-size="18" fill="white" opacity="0.8">${escape(opts.prompt.slice(0, 90))}</text>
          <text x="32" y="${h - 32}" font-family="sans-serif" font-size="16" fill="white" opacity="0.7">${opts.references.length} referencias · ${opts.aspectRatio}</text>
        </svg>`;
        return sharp(Buffer.from(svg)).png().toBuffer();
      }),
    );
    return { images, model: this.model, usage: { images: opts.n }, costUsd: 0, durationMs: 1200 };
  }
}
