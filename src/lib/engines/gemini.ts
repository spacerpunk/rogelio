import { GoogleGenAI } from "@google/genai";
import { roundUsd } from "./pricing";
import { sniffImageMime, withNegative } from "./image-utils";
import { withRetry } from "./retry";
import { EngineError, type ImageEngine, type ImageRequest } from "./types";

// Gemini "Nano Banana" vía la Interactions API (verificada en la documentación oficial al 2026-09-24):
// ai.interactions.create({ model, input: [texto, imágenes], response_format: { type: "image", aspect_ratio, image_size } })
// devuelve una imagen por llamada en output_image; hasta 14 imágenes de referencia.

const ENGINE = "gemini";
const IMAGE_SIZE = "1K";
export const GEMINI_MAX_REFERENCES = 14;

// USD por millón de tokens (entrada, salida de imagen). Orden: el primer prefijo que coincide gana.
const PRICES: [prefix: string, input: number, output: number][] = [
  ["gemini-3.1-flash-lite-image", 0.25, 30],
  ["gemini-3.1-flash-image", 0.5, 60],
  ["gemini-3-pro-image", 2, 120],
  ["gemini-2.5-flash-image", 0.3, 30],
];
// Si la API no informa uso: tokens de una imagen 1K según la documentación.
const FALLBACK_OUTPUT_TOKENS = 1120;

function geminiCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES.find(([prefix]) => model.startsWith(prefix));
  if (!price) return 0;
  return (inputTokens * price[1] + outputTokens * price[2]) / 1_000_000;
}

function toEngineError(error: unknown): EngineError {
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
    return new EngineError("config", "Gemini: el modelo configurado no existe (revisá GEMINI_IMAGE_MODEL).", ENGINE, error);
  }
  if (/safety|blocked|prohibited|policy/i.test(message)) {
    return new EngineError("content_blocked", `Gemini bloqueó el pedido por sus filtros de contenido: ${message}`, ENGINE, error);
  }
  if (status === 400) return new EngineError("bad_request", `Gemini rechazó el pedido: ${message}`, ENGINE, error);
  if ((status && status >= 500) || /ECONNRESET|ETIMEDOUT|fetch failed|network|timeout/i.test(message)) {
    return new EngineError("unavailable", "Gemini no está disponible en este momento. Se reintenta más tarde.", ENGINE, error);
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
        response_format: { type: "image", aspect_ratio: opts.aspectRatio, image_size: IMAGE_SIZE },
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
        outputTokens: interaction.usage?.total_output_tokens ?? FALLBACK_OUTPUT_TOKENS,
      };
    } catch (error) {
      throw toEngineError(error);
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
