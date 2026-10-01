import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type EngineUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  images?: number;
};

/** Bloques de entrada para el motor de texto: texto, PDF (documento) o imagen. */
export type TextInputBlock =
  | { type: "text"; text: string }
  | { type: "pdf"; data: Buffer }
  | { type: "image"; data: Buffer; mimeType: string };

export type TextRequest = {
  system?: string;
  content: string | TextInputBlock[];
  maxTokens?: number;
  effort?: Effort;
  /** Cachea el system prompt: conviene cuando se repite en muchas llamadas seguidas (prompts por plano). */
  cacheSystem?: boolean;
};

export type EngineResultMeta = {
  model: string;
  usage: EngineUsage;
  costUsd: number;
  durationMs: number;
};

export interface TextEngine {
  readonly name: string;
  /** Nombre corto para la UI ("Claude", "GPT", "Gemini"). */
  readonly label: string;
  readonly model: string;
  complete(opts: TextRequest): Promise<EngineResultMeta & { text: string }>;
  structured<T>(opts: TextRequest, schema: z.ZodType<T>): Promise<EngineResultMeta & { data: T }>;
}

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

/** Resolución de salida (Gemini). OpenAI usa tamaños fijos por formato. */
export const IMAGE_SIZES = ["1K", "2K", "4K"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export type ImageRequest = {
  prompt: string;
  negative?: string;
  references: Buffer[];
  aspectRatio: AspectRatio;
  size: ImageSize;
  n: number;
};

export interface ImageEngine {
  readonly name: string;
  readonly label: string;
  readonly model: string;
  generate(opts: ImageRequest): Promise<EngineResultMeta & { images: Buffer[] }>;
}

export type EngineErrorKind = "config" | "rate_limit" | "content_blocked" | "bad_request" | "unavailable" | "invalid_output" | "unknown";

/**
 * Motivo técnico original (estado, código y mensaje, siguiendo la cadena de causas) para sumar a los
 * errores genéricos: "no disponible" puede ser una caída del proveedor o un problema de red local.
 */
export function causeDetail(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { message?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    const piece = [e.status, e.code, typeof e.message === "string" ? e.message : null].filter(Boolean).join(" ");
    if (piece && !parts.includes(piece)) parts.push(piece);
    current = e.cause;
  }
  return parts.join(" ← ").slice(0, 300) || "sin detalle";
}

/** Error de un motor con un motivo legible para mostrar en la UI. */
export class EngineError extends Error {
  constructor(
    readonly kind: EngineErrorKind,
    message: string,
    readonly engine: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EngineError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "unavailable";
  }
}
