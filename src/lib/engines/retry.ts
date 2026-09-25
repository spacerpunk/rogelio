import { EngineError } from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reintenta con backoff exponencial y jitter solo los errores reintentables
 * (rate limit y servicio no disponible). El contenido bloqueado o un pedido inválido fallan de una.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 4, baseMs = 2_000, maxMs = 60_000 }: { retries?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof EngineError && error.retryable;
      if (!retryable || attempt >= retries) throw error;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      await sleep(delay);
    }
  }
}
