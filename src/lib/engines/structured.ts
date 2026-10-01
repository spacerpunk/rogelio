import type { z } from "zod";
import { EngineError } from "./types";

/** Valida la salida JSON de un motor de texto contra el schema de Zod, con un motivo legible para la UI. */
export function parseStructured<T>(text: string, schema: z.ZodType<T>, engine: string, label: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new EngineError("invalid_output", `${label} devolvió un JSON inválido.`, engine);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new EngineError("invalid_output", `La respuesta de ${label} no cumple el formato esperado (${detail}).`, engine);
  }
  return parsed.data;
}
