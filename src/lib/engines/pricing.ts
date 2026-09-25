import type { EngineUsage } from "./types";

// Precios estimados en USD. Verificados en la documentación oficial al 2026-09-24; revisar al cambiar
// de modelo. Un modelo sin precio conocido registra costo 0 (se ve en el registro de llamadas).

type TokenPrice = { inputPerMTok: number; outputPerMTok: number };

// Orden importa: el primer prefijo que coincide gana (claude-opus-5-5 antes que claude-opus-5).
const CLAUDE_PRICES: [prefix: string, price: TokenPrice][] = [
  ["claude-fable-5", { inputPerMTok: 10, outputPerMTok: 50 }],
  ["claude-mythos-5", { inputPerMTok: 10, outputPerMTok: 50 }],
  ["claude-opus-5-5", { inputPerMTok: 4, outputPerMTok: 20 }],
  ["claude-opus-5", { inputPerMTok: 5, outputPerMTok: 25 }],
  ["claude-opus-4", { inputPerMTok: 5, outputPerMTok: 25 }],
  ["claude-sonnet-5", { inputPerMTok: 2, outputPerMTok: 10 }],
  ["claude-sonnet-4", { inputPerMTok: 3, outputPerMTok: 15 }],
  ["claude-haiku-4", { inputPerMTok: 1, outputPerMTok: 5 }],
];

export function claudeCost(model: string, usage: EngineUsage): number {
  const price = CLAUDE_PRICES.find(([prefix]) => model.startsWith(prefix))?.[1];
  if (!price) return 0;
  const inputRate = price.inputPerMTok / 1_000_000;
  const outputRate = price.outputPerMTok / 1_000_000;
  return (
    (usage.inputTokens ?? 0) * inputRate +
    (usage.cacheWriteTokens ?? 0) * inputRate * 1.25 +
    (usage.cacheReadTokens ?? 0) * inputRate * 0.1 +
    (usage.outputTokens ?? 0) * outputRate
  );
}

export function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
