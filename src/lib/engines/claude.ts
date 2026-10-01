import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { claudeCost, roundUsd } from "./pricing";
import { parseStructured } from "./structured";
import { EngineError, causeDetail, type EngineResultMeta, type TextEngine, type TextInputBlock, type TextRequest } from "./types";

const ENGINE = "claude";
// Streaming siempre: guiones y shot lists largos superan los tiempos de una request normal.
const DEFAULT_MAX_TOKENS = 64_000;
// Fallback del lado del servidor ante rechazos de los clasificadores de seguridad (modo "default":
// Anthropic elige el modelo según la categoría). Solo en los modelos que lo soportan.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = ["claude-opus-5", "claude-fable-5", "claude-mythos-5"];

type BetaContent = Anthropic.Beta.Messages.BetaContentBlockParam;

function toContent(content: TextRequest["content"]): BetaContent[] {
  const blocks: TextInputBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
  return blocks.map((block): BetaContent => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "pdf":
        return {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: block.data.toString("base64") },
        };
      case "image":
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: block.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data: block.data.toString("base64"),
          },
        };
    }
  });
}

function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new EngineError("rate_limit", "Claude: límite de uso alcanzado (rate limit). Se reintenta más tarde.", ENGINE, error);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new EngineError("config", "Claude: la API key es inválida o no tiene permisos (revisá ANTHROPIC_API_KEY).", ENGINE, error);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new EngineError("config", "Claude: el modelo configurado no existe (revisá ANTHROPIC_MODEL).", ENGINE, error);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new EngineError("bad_request", `Claude rechazó el pedido: ${error.message}`, ENGINE, error);
  }
  if (error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
    return new EngineError("unavailable", `Claude no está disponible en este momento (${causeDetail(error)}). Se reintenta más tarde.`, ENGINE, error);
  }
  if (error instanceof Anthropic.APIError) {
    return new EngineError("unknown", `Claude: error ${error.status ?? ""} ${error.message}`, ENGINE, error);
  }
  return new EngineError("unknown", `Claude: ${error instanceof Error ? error.message : String(error)}`, ENGINE, error);
}

export class ClaudeTextEngine implements TextEngine {
  readonly name = ENGINE;
  readonly label = "Claude";
  private client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    // El SDK ya reintenta 429/5xx/conexión con backoff y respetando retry-after.
    this.client = new Anthropic({ apiKey, maxRetries: 4 });
  }

  private async run(opts: TextRequest, format?: Anthropic.Beta.Messages.BetaJSONOutputFormat) {
    const started = Date.now();
    const useFallbacks = FALLBACK_MODELS.some((m) => this.model.startsWith(m));
    try {
      const maxOutput = this.model.includes("haiku") ? 64_000 : 128_000;
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: Math.min(opts.maxTokens ?? DEFAULT_MAX_TOKENS, maxOutput),
        ...(opts.system
          ? {
              system: opts.cacheSystem
                ? [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }]
                : opts.system,
            }
          : {}),
        messages: [{ role: "user", content: toContent(opts.content) }],
        // Haiku 4.5 no tiene pensamiento adaptativo; el resto de los modelos actuales sí.
        ...(this.model.includes("haiku") ? {} : { thinking: { type: "adaptive" as const } }),
        ...(opts.effort || format
          ? { output_config: { ...(opts.effort ? { effort: opts.effort } : {}), ...(format ? { format } : {}) } }
          : {}),
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      });
      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new EngineError(
          "content_blocked",
          "Claude rechazó generar este contenido (filtro de seguridad). Revisá el material o reformulá las indicaciones.",
          ENGINE,
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new EngineError(
          "invalid_output",
          "Claude se quedó sin tokens de salida antes de terminar. Probá con menos material o una duración menor.",
          ENGINE,
        );
      }

      const text = message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
      const usage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      };
      const meta: EngineResultMeta = {
        // Si respondió un modelo de fallback, el costo se calcula con ese modelo.
        model: message.model,
        usage,
        costUsd: roundUsd(claudeCost(message.model, usage)),
        durationMs: Date.now() - started,
      };
      return { text, meta };
    } catch (error) {
      throw toEngineError(error);
    }
  }

  async complete(opts: TextRequest) {
    const { text, meta } = await this.run(opts);
    if (!text) throw new EngineError("invalid_output", "Claude devolvió una respuesta vacía.", ENGINE);
    return { text, ...meta };
  }

  async structured<T>(opts: TextRequest, schema: z.ZodType<T>) {
    const format = betaZodOutputFormat(schema);
    const { text, meta } = await this.run(opts, { type: format.type, schema: format.schema });
    return { data: parseStructured(text, schema, ENGINE, this.label), ...meta };
  }
}
