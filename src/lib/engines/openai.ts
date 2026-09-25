import OpenAI, { toFile } from "openai";
import { roundUsd } from "./pricing";
import { sniffImageMime, withNegative } from "./image-utils";
import { EngineError, type AspectRatio, type ImageEngine, type ImageRequest } from "./types";

// OpenAI Images (verificado en la documentación oficial al 2026-09-24): con referencias se usa
// images.edit({ image: [...] }), sin referencias images.generate; `n` devuelve varias imágenes en una
// llamada; no hay campo de negativo (se agrega al prompt); los rechazos llegan con code "moderation_blocked".

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

function toEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  if (error instanceof OpenAI.APIError) {
    if (error.code === "moderation_blocked" || error.code === "content_policy_violation") {
      return new EngineError("content_blocked", `OpenAI bloqueó la imagen por su política de contenido: ${error.message}`, ENGINE, error);
    }
    if (error instanceof OpenAI.RateLimitError) {
      return new EngineError("rate_limit", "OpenAI: límite de uso alcanzado (rate limit o cuota). Se reintenta más tarde.", ENGINE, error);
    }
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
      return new EngineError("config", "OpenAI: la API key es inválida o no tiene permisos (revisá OPENAI_API_KEY).", ENGINE, error);
    }
    if (error instanceof OpenAI.NotFoundError) {
      return new EngineError("config", "OpenAI: el modelo configurado no existe (revisá OPENAI_IMAGE_MODEL).", ENGINE, error);
    }
    if (error instanceof OpenAI.BadRequestError) {
      return new EngineError("bad_request", `OpenAI rechazó el pedido: ${error.message}`, ENGINE, error);
    }
    if (error instanceof OpenAI.InternalServerError || error instanceof OpenAI.APIConnectionError) {
      return new EngineError("unavailable", "OpenAI no está disponible en este momento. Se reintenta más tarde.", ENGINE, error);
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
      throw toEngineError(error);
    }
  }
}
