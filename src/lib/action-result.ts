import { z } from "zod";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Ejecuta la lógica de una server action y convierte errores en un resultado que la UI muestra. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(". ") };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function throwIfError(result: { error: { message: string } | null }, context: string): void {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
}
