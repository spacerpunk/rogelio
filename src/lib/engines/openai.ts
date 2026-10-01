import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { roundUsd } from "./pricing";
import { sniffImageMime, withNegative } from "./image-utils";
import { parseStructured } from "./structured";
import {
  EngineError,
  causeDetail,
  type AspectRatio,
  type EngineResultMeta,
  type ImageEngine,
  type ImageRequest,
  type TextEngine,
  type TextInputBlock,
  type TextRequest,
} from "./types";

// OpenAI Images (verificado en la documentación oficial al 2026-09-24): con referencias se usa
// images.edit({ image: [...] }), sin referencias images.generate; `n` devuelve varias imágenes en una
// llamada; no hay campo de negativo (se agrega al prompt); los rechazos llegan con code "moderation_blocked".
//
// Texto con la Responses API (verificado en la documentación oficial al 2026-09-30): PDFs como input_file
// en base64 (hasta 50 MB), salida estructurada con text.format json_schema estricto y reasoning.effort
// (low … max en la serie GPT-6).

const ENGINE = "openai";
const QUALITY = "medium" as const;
export const OPENAI_MAX_REFERENCES = 16;

// USD por millón de tokens: entrada de texto, entrada de imagen, salida de imagen.
const PRICES: [prefix: string, text: number, imageIn: number, imageOut: number][] = [
  ["gpt-image-2", 5, 8, 30],
  ["gpt-image-1.5", 5, 8, 32],
  ["gpt-image-1-mini", 2, 2.5, 8],
  ["gpt-image-1", 5, 10, 40],
];

// Los modelos gpt-image-2* aceptan tamaños a medida (múltiplos de 16); los anteriores, solo tres.
const EXACT_SIZES: Record<AspectRatio, string> = {
  "16:9": "1536x864",
  "9:16": "864x1536",
  "1:1": "1024x1024",
  "4:3": "1536x1152",
  "3:4": "1152x1536",
};
const LEGACY_SIZES: Record<AspectRatio, "1536x1024" | "1024x1536" | "1024x1024"> = {
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
};

// Texto: USD por millón de tokens (entrada, entrada cacheada, salida). Los tokens de razonamiento
// se cobran como salida. Orden: el primer prefijo que coincide gana.
const TEXT_PRICES: [prefix: string, input: number, cachedInput: number, output: number][] = [
  ["gpt-6-astra", 10, 1, 50],
  ["gpt-6.1-sol", 2, 0.1, 10],
  ["gpt-6-luna", 0.1, 0.01, 0.5],
  ["gpt-5.4-mini", 0.75, 0.075, 4.5],
  ["gpt-5-mini", 0.25, 0.025, 2],
];
const DEFAULT_MAX_TOKENS = 64_000;

function toEngineError(error: unknown, modelVar: string): EngineError {
  if (error instanceof EngineError) return error;
  if (error instanceof OpenAI.APIError) {
    if (error.code === "moderation_blocked" || error.code === "content_policy_violation") {
      return new EngineError("content_blocked", `OpenAI bloqueó el pedido por su política de contenido: ${error.message}`, ENGINE, error);
    }
    if (error instanceof OpenAI.RateLimitError) {
      return new EngineError("rate_limit", "OpenAI: límite de uso alcanzado (rate limit o cuota). Se reintenta más tarde.", ENGINE, error);
    }
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
      return new EngineError("config", "OpenAI: la API key es inválida o no tiene permisos (revisá OPENAI_API_KEY).", ENGINE, error);
    }
    if (error instanceof OpenAI.NotFoundError) {
      return new EngineError("config", `OpenAI: el modelo configurado no existe (revisá ${modelVar}).`, ENGINE, error);
    }
    if (error instanceof OpenAI.BadRequestError) {
      return new EngineError("bad_request", `OpenAI rechazó el pedido: ${error.message}`, ENGINE, error);
    }
    if (error instanceof OpenAI.InternalServerError || error instanceof OpenAI.APIConnectionError) {
      return new EngineError("unavailable", `OpenAI no está disponible en este momento (${causeDetail(error)}). Se reintenta más tarde.`, ENGINE, error);
    }
  }
  return new EngineError("unknown", `OpenAI: ${error instanceof Error ? error.message : String(error)}`, ENGINE, error);
}

export class OpenAIImageEngine implements ImageEngine {
  readonly name = ENGINE;
  readonly label = "OpenAI Images";
  private client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    // El SDK reintenta 429/5xx/conexión con backoff.
    this.client = new OpenAI({ apiKey, maxRetries: 4 });
  }

  async generate(opts: ImageRequest) {
    const started = Date.now();
    const size = this.model.startsWith("gpt-image-2") ? EXACT_SIZES[opts.aspectRatio] : LEGACY_SIZES[opts.aspectRatio];
    const prompt = withNegative(opts.prompt, opts.negative);
    try {
      const common = { model: this.model, prompt, n: opts.n, size, quality: QUALITY, output_format: "png" as const };
      const response = opts.references.length
        ? await this.client.images.edit({
            ...common,
            image: await Promise.all(
              opts.references.slice(0, OPENAI_MAX_REFERENCES).map((ref, i) =>
                toFile(ref, `referencia-${i + 1}`, { type: sniffImageMime(ref) }),
              ),
            ),
          })
        : await this.client.images.generate(common);

      const images = (response.data ?? []).flatMap((d) => (d.b64_json ? [Buffer.from(d.b64_json, "base64")] : []));
      if (images.length === 0) throw new EngineError("invalid_output", "OpenAI no devolvió imágenes.", ENGINE);

      const usage = response.usage;
      const price = PRICES.find(([prefix]) => this.model.startsWith(prefix));
      const imageIn = usage?.input_tokens_details?.image_tokens ?? 0;
      const textIn = usage?.input_tokens_details?.text_tokens ?? Math.max(0, (usage?.input_tokens ?? 0) - imageIn);
      const cost = price && usage ? (textIn * price[1] + imageIn * price[2] + usage.output_tokens * price[3]) / 1_000_000 : 0;

      return {
        images,
        model: this.model,
        usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, images: images.length },
        costUsd: roundUsd(cost),
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toEngineError(error, "OPENAI_IMAGE_MODEL");
    }
  }
}

function toInputContent(content: TextRequest["content"]): OpenAI.Responses.ResponseInputContent[] {
  const blocks: TextInputBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
  return blocks.map((block): OpenAI.Responses.ResponseInputContent => {
    switch (block.type) {
      case "text":
        return { type: "input_text", text: block.text };
      case "pdf":
        return { type: "input_file", filename: "documento.pdf", file_data: `data:application/pdf;base64,${block.data.toString("base64")}` };
      case "image":
        return { type: "input_image", detail: "auto", image_url: `data:${block.mimeType};base64,${block.data.toString("base64")}` };
    }
  });
}

export class OpenAITextEngine implements TextEngine {
  readonly name = ENGINE;
  readonly label = "GPT";
  private client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    // El SDK reintenta 429/5xx/conexión con backoff.
    this.client = new OpenAI({ apiKey, maxRetries: 4 });
  }

  private async run(opts: TextRequest, format?: OpenAI.Responses.ResponseFormatTextConfig) {
    const started = Date.now();
    try {
      // Streaming: guiones y shot lists largos superan los tiempos de una request normal.
      const stream = this.client.responses.stream({
        model: this.model,
        ...(opts.system ? { instructions: opts.system } : {}),
        input: [{ role: "user", content: toInputContent(opts.content) }],
        max_output_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
        ...(format ? { text: { format } } : {}),
        // El material del cliente no queda guardado del lado de OpenAI.
        store: false,
      });
      const response = await stream.finalResponse();

      const refusal = response.output
        .flatMap((item) => (item.type === "message" ? item.content : []))
        .find((part) => part.type === "refusal");
      if (refusal || response.incomplete_details?.reason === "content_filter") {
        throw new EngineError(
          "content_blocked",
          `GPT rechazó generar este contenido${refusal ? `: ${refusal.refusal}` : " (filtro de contenido)"}. Revisá el material o reformulá las indicaciones.`,
          ENGINE,
        );
      }
      if (response.status === "incomplete") {
        throw new EngineError(
          "invalid_output",
          "GPT se quedó sin tokens de salida antes de terminar. Probá con menos material o una duración menor.",
          ENGINE,
        );
      }
      if (response.status === "failed") {
        throw new EngineError("unknown", `GPT: ${response.error?.message ?? "la respuesta falló"}`, ENGINE);
      }

      const usage = response.usage;
      const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
      const engineUsage = {
        inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cached),
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: cached,
      };
      const price = TEXT_PRICES.find(([prefix]) => response.model.startsWith(prefix));
      const cost = price
        ? (engineUsage.inputTokens * price[1] + cached * price[2] + engineUsage.outputTokens * price[3]) / 1_000_000
        : 0;
      const meta: EngineResultMeta = {
        model: response.model,
        usage: engineUsage,
        costUsd: roundUsd(cost),
        durationMs: Date.now() - started,
      };
      return { text: response.output_text.trim(), meta };
    } catch (error) {
      throw toEngineError(error, "OPENAI_TEXT_MODEL");
    }
  }

  async complete(opts: TextRequest) {
    const { text, meta } = await this.run(opts);
    if (!text) throw new EngineError("invalid_output", "GPT devolvió una respuesta vacía.", ENGINE);
    return { text, ...meta };
  }

  async structured<T>(opts: TextRequest, schema: z.ZodType<T>) {
    const { text, meta } = await this.run(opts, zodTextFormat(schema, "output"));
    return { data: parseStructured(text, schema, ENGINE, this.label), ...meta };
  }
}
