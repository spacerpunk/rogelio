import { GoogleGenAI } from "@google/genai";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { roundUsd } from "./pricing";
import { sniffImageMime, withNegative } from "./image-utils";
import { withRetry } from "./retry";
import { mp4DurationSec } from "./video-utils";
import { parseStructured } from "./structured";
import {
  EngineError,
  causeDetail,
  type Effort,
  type ImageEngine,
  type ImageRequest,
  type ImageSize,
  type TextEngine,
  type TextInputBlock,
  type TextRequest,
  type VideoEngine,
  type VideoRequest,
} from "./types";

// Gemini "Nano Banana" vía la Interactions API (verificada en la documentación oficial al 2026-09-24):
// ai.interactions.create({ model, input: [texto, imágenes], response_format: { type: "image", aspect_ratio, image_size } })
// devuelve una imagen por llamada en output_image; hasta 14 imágenes de referencia.
//
// Texto con la misma API (verificado en la documentación oficial al 2026-09-30): PDFs como
// { type: "document", mime_type: "application/pdf", data } (hasta 50 MB), JSON con
// response_format { type: "text", mime_type: "application/json", schema } y generation_config
// { thinking_level: low | medium | high, max_output_tokens } (65.536 como máximo en los modelos 3.x).

const ENGINE = "gemini";
export const GEMINI_MAX_REFERENCES = 14;

// USD por millón de tokens (entrada, salida de imagen). Orden: el primer prefijo que coincide gana.
const PRICES: [prefix: string, input: number, output: number][] = [
  ["gemini-3.1-flash-lite-image", 0.25, 30],
  ["gemini-3.1-flash-image", 0.5, 60],
  ["gemini-3-pro-image", 2, 120],
  ["gemini-2.5-flash-image", 0.3, 30],
];
// Si la API no informa uso: tokens por imagen de Nano Banana 2 según la documentación (2026-09-30).
const FALLBACK_OUTPUT_TOKENS: Record<ImageSize, number> = { "1K": 1120, "2K": 1680, "4K": 2520 };

function geminiCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES.find(([prefix]) => model.startsWith(prefix));
  if (!price) return 0;
  return (inputTokens * price[1] + outputTokens * price[2]) / 1_000_000;
}

// Texto: USD por millón de tokens (entrada, salida) con prompts de hasta 200k tokens. Los tokens de
// pensamiento se cobran como salida. Orden: el primer prefijo que coincide gana (flash-lite antes que flash).
const TEXT_PRICES: [prefix: string, input: number, output: number, promo?: boolean][] = [
  ["gemini-3.8-flash", 0.75, 3.75, true],
  ["gemini-3.7-flash", 0.75, 3.75, true],
  ["gemini-3.6-flash", 0.75, 3.75, true],
  ["gemini-3.5-flash-lite", 0.3, 2.5],
  ["gemini-3.5-flash", 1.5, 9],
  ["gemini-3.1-flash-lite", 0.25, 1.5],
  ["gemini-3.1-pro", 2, 12],
  ["gemini-2.5-pro", 1.25, 10],
  ["gemini-2.5-flash-lite", 0.1, 0.4],
  ["gemini-2.5-flash", 0.3, 2.5],
];
// Gemini 3.6–3.8 Flash tienen precio promocional hasta el 2026-12-31; desde 2027 se duplica.
const PROMO_ENDS = Date.UTC(2027, 0, 1);
const MAX_OUTPUT_TOKENS = 65_536;
const THINKING_LEVEL: Record<Effort, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

function geminiTextCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = TEXT_PRICES.find(([prefix]) => model.startsWith(prefix));
  if (!price) return 0;
  const factor = price[3] && Date.now() >= PROMO_ENDS ? 2 : 1;
  return ((inputTokens * price[1] + outputTokens * price[2]) * factor) / 1_000_000;
}

/** JSON Schema para response_format: sin "$schema", que no figura entre las palabras clave soportadas. */
function responseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function toEngineError(error: unknown, modelVar: string): EngineError {
  if (error instanceof EngineError) return error;
  const status = (error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(message)) {
    return new EngineError("rate_limit", "Gemini: límite de uso alcanzado (rate limit o cuota). Se reintenta más tarde.", ENGINE, error);
  }
  if (status === 401 || status === 403 || /API key/i.test(message)) {
    return new EngineError("config", "Gemini: la API key es inválida o no tiene permisos (revisá GEMINI_API_KEY).", ENGINE, error);
  }
  if (status === 404) {
    return new EngineError("config", `Gemini: el modelo configurado no existe (revisá ${modelVar}).`, ENGINE, error);
  }
  if (/safety|blocked|prohibited|policy/i.test(message)) {
    return new EngineError("content_blocked", `Gemini bloqueó el pedido por sus filtros de contenido: ${message}`, ENGINE, error);
  }
  if (status === 400) return new EngineError("bad_request", `Gemini rechazó el pedido: ${message}`, ENGINE, error);
  if ((status && status >= 500) || /ECONNRESET|ETIMEDOUT|fetch failed|network|timeout/i.test(message)) {
    return new EngineError("unavailable", `Gemini no está disponible en este momento (${causeDetail(error)}). Se reintenta más tarde.`, ENGINE, error);
  }
  return new EngineError("unknown", `Gemini: ${message}`, ENGINE, error);
}

export class GeminiImageEngine implements ImageEngine {
  readonly name = ENGINE;
  readonly label = "Gemini (Nano Banana)";
  private client: GoogleGenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private async once(opts: ImageRequest) {
    try {
      const interaction = await this.client.interactions.create({
        model: this.model,
        input: [
          { type: "text", text: withNegative(opts.prompt, opts.negative) },
          ...opts.references.slice(0, GEMINI_MAX_REFERENCES).map((ref) => ({
            type: "image" as const,
            mime_type: sniffImageMime(ref),
            data: ref.toString("base64"),
          })),
        ],
        response_format: { type: "image", aspect_ratio: opts.aspectRatio, image_size: opts.size },
        // El material del cliente no se guarda del lado de Google.
        store: false,
      });

      const data = interaction.output_image?.data;
      if (interaction.status !== "completed" || !data) {
        const reason = [...(interaction.errors ?? []).map((e) => e.message), interaction.output_text]
          .filter(Boolean)
          .join(" · ");
        throw new EngineError(
          "content_blocked",
          `Gemini no devolvió imagen (${interaction.status})${reason ? `: ${reason}` : ". Probablemente la bloquearon sus filtros de contenido."}`,
          ENGINE,
        );
      }
      return {
        image: Buffer.from(data, "base64"),
        inputTokens: interaction.usage?.total_input_tokens ?? 0,
        outputTokens: interaction.usage?.total_output_tokens ?? FALLBACK_OUTPUT_TOKENS[opts.size],
      };
    } catch (error) {
      throw toEngineError(error, "GEMINI_IMAGE_MODEL");
    }
  }

  async generate(opts: ImageRequest) {
    const started = Date.now();
    // Gemini devuelve una imagen por llamada: las variantes se piden en paralelo.
    const results = await Promise.all(Array.from({ length: opts.n }, () => withRetry(() => this.once(opts))));
    const inputTokens = results.reduce((s, r) => s + r.inputTokens, 0);
    const outputTokens = results.reduce((s, r) => s + r.outputTokens, 0);
    return {
      images: results.map((r) => r.image),
      model: this.model,
      usage: { inputTokens, outputTokens, images: results.length },
      costUsd: roundUsd(geminiCost(this.model, inputTokens, outputTokens)),
      durationMs: Date.now() - started,
    };
  }
}

function toTextInput(content: TextRequest["content"]) {
  const blocks: TextInputBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text" as const, text: block.text };
      case "pdf":
        return { type: "document" as const, mime_type: "application/pdf", data: block.data.toString("base64") };
      case "image":
        return { type: "image" as const, mime_type: block.mimeType, data: block.data.toString("base64") };
    }
  });
}

export class GeminiTextEngine implements TextEngine {
  readonly name = ENGINE;
  readonly label = "Gemini";
  private client: GoogleGenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private async once(opts: TextRequest, schema?: Record<string, unknown>) {
    try {
      const interaction = await this.client.interactions.create({
        model: this.model,
        input: toTextInput(opts.content),
        ...(opts.system ? { system_instruction: opts.system } : {}),
        generation_config: {
          max_output_tokens: Math.min(opts.maxTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
          ...(opts.effort ? { thinking_level: THINKING_LEVEL[opts.effort] } : {}),
        },
        ...(schema ? { response_format: { type: "text" as const, mime_type: "application/json", schema } } : {}),
        // El material del cliente no se guarda del lado de Google.
        store: false,
      });

      if (interaction.status === "incomplete") {
        throw new EngineError(
          "invalid_output",
          "Gemini se quedó sin tokens de salida antes de terminar. Probá con menos material o una duración menor.",
          ENGINE,
        );
      }
      if (interaction.status !== "completed") {
        const reason = (interaction.errors ?? []).map((e) => e.message).filter(Boolean).join(" · ");
        // toEngineError distingue bloqueos de contenido del resto por el texto del motivo.
        throw toEngineError(new Error(reason || `la respuesta terminó con estado ${interaction.status}`), "GEMINI_TEXT_MODEL");
      }
      return {
        text: (interaction.output_text ?? "").trim(),
        inputTokens: interaction.usage?.total_input_tokens ?? 0,
        outputTokens: (interaction.usage?.total_output_tokens ?? 0) + (interaction.usage?.total_thought_tokens ?? 0),
      };
    } catch (error) {
      throw toEngineError(error, "GEMINI_TEXT_MODEL");
    }
  }

  private async run(opts: TextRequest, schema?: Record<string, unknown>) {
    const started = Date.now();
    const result = await withRetry(() => this.once(opts, schema));
    return {
      text: result.text,
      meta: {
        model: this.model,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        costUsd: roundUsd(geminiTextCost(this.model, result.inputTokens, result.outputTokens)),
        durationMs: Date.now() - started,
      },
    };
  }

  async complete(opts: TextRequest) {
    const { text, meta } = await this.run(opts);
    if (!text) throw new EngineError("invalid_output", "Gemini devolvió una respuesta vacía.", ENGINE);
    return { text, ...meta };
  }

  async structured<T>(opts: TextRequest, schema: z.ZodType<T>) {
    const { text, meta } = await this.run(opts, responseSchema(schema));
    return { data: parseStructured(text, schema, ENGINE, this.label), ...meta };
  }
}

// Video con Gemini Omni Flash vía la Interactions API (verificada en la documentación oficial al 2026-10-13):
// ai.interactions.create({ model, input: [imágenes, texto], response_format: { type: "video", aspect_ratio,
// resolution, delivery } }) es sincrónico y devuelve el clip en output_video (data en base64, o uri en la Files
// API si se pide delivery "uri", que exige store=true: acá se pide inline). Formatos 16:9 y 9:16; resolución 360p,
// 720p (default), 1080p o 4k (reescalados); clips de 3 a 10 s. No tiene campo negativo ni system instruction:
// el Avoid va al final del prompt. La duración se guía con la línea de tiempo del prompt (no hay parámetro
// documentado). No admite imágenes con ciertas personas reconocibles.

// USD por millón de tokens: entrada (texto e imagen) y salida de video. ~5.792 tokens por segundo de 720p.
const VIDEO_PRICES: [prefix: string, input: number, output: number][] = [["gemini-omni", 1.5, 17.5]];
const VIDEO_TOKENS_PER_SEC_720P = 5_792;
const FILE_POLL_MS = 3_000;
const FILE_POLL_TIMEOUT_MS = 5 * 60_000;

function geminiVideoCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = VIDEO_PRICES.find(([prefix]) => model.startsWith(prefix));
  if (!price) return 0;
  return (inputTokens * price[1] + outputTokens * price[2]) / 1_000_000;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiVideoEngine implements VideoEngine {
  readonly name = ENGINE;
  readonly label = "Gemini Omni";
  readonly aspectRatios = ["16:9", "9:16"] as const;
  readonly maxDurationSec = 10;
  private client: GoogleGenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  /** Descarga un video entregado por URI: espera a que el archivo esté ACTIVE y lo baja a un temporal. */
  private async downloadFromUri(uri: string): Promise<Buffer> {
    const name = uri.match(/files\/[^/?:]+/)?.[0];
    if (!name) throw new EngineError("invalid_output", `Gemini devolvió una URI de video inesperada: ${uri}`, ENGINE);
    const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
    for (;;) {
      const file = await this.client.files.get({ name });
      if (file.state === "ACTIVE") break;
      if (file.state === "FAILED") throw new EngineError("unavailable", "Gemini no pudo preparar el archivo del video.", ENGINE);
      if (Date.now() > deadline) throw new EngineError("unavailable", "Gemini tardó demasiado en preparar el archivo del video.", ENGINE);
      await sleep(FILE_POLL_MS);
    }
    const dir = await mkdtemp(path.join(tmpdir(), "rt-clip-"));
    const target = path.join(dir, "clip.mp4");
    try {
      await this.client.files.download({ file: name, downloadPath: target });
      return await readFile(target);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async once(opts: VideoRequest) {
    if (!this.aspectRatios.includes(opts.aspectRatio as "16:9" | "9:16")) {
      throw new EngineError("config", `Gemini Omni solo genera video 16:9 o 9:16 (el proyecto está en ${opts.aspectRatio}).`, ENGINE);
    }
    try {
      const image = (data: Buffer) => ({ type: "image" as const, mime_type: sniffImageMime(data), data: data.toString("base64") });
      const interaction = await this.client.interactions.create({
        model: this.model,
        // El primer frame va primero: el prompt lo nombra como "Image 1"; después, las referencias de identidad.
        input: [image(opts.firstFrame), ...opts.references.map(image), { type: "text", text: withNegative(opts.prompt, opts.negative) }],
        // Entrega inline: la entrega por URI exige store=true y el material del cliente no se guarda en Google.
        response_format: { type: "video", aspect_ratio: opts.aspectRatio, resolution: opts.resolution },
        store: false,
      });

      const output = interaction.output_video;
      if (interaction.status !== "completed" || !(output?.data || output?.uri)) {
        const reason = [...(interaction.errors ?? []).map((e) => e.message), interaction.output_text].filter(Boolean).join(" · ");
        throw new EngineError(
          "content_blocked",
          `Gemini Omni no devolvió video (${interaction.status})${reason ? `: ${reason}` : ". Probablemente lo bloquearon sus filtros de contenido (por ejemplo, un personaje basado en una persona real)."}`,
          ENGINE,
        );
      }
      const video = output.data ? Buffer.from(output.data, "base64") : await this.downloadFromUri(output.uri!);
      const durationSec = mp4DurationSec(video);
      return {
        video,
        mimeType: output.mime_type ?? "video/mp4",
        durationSec,
        inputTokens: interaction.usage?.total_input_tokens ?? 0,
        outputTokens:
          // Sin uso informado: estimado con la tarifa publicada de 720p para cualquier resolución.
          interaction.usage?.total_output_tokens ?? Math.round((durationSec ?? opts.durationSec) * VIDEO_TOKENS_PER_SEC_720P),
      };
    } catch (error) {
      throw toEngineError(error, "GEMINI_VIDEO_MODEL");
    }
  }

  async generate(opts: VideoRequest) {
    const started = Date.now();
    const result = await withRetry(() => this.once(opts), { retries: 3, baseMs: 10_000 });
    return {
      video: result.video,
      mimeType: result.mimeType,
      durationSec: result.durationSec,
      model: this.model,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      costUsd: roundUsd(geminiVideoCost(this.model, result.inputTokens, result.outputTokens)),
      durationMs: Date.now() - started,
    };
  }
}
