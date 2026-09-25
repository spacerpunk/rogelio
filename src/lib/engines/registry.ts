import { ClaudeTextEngine } from "./claude";
import { GeminiImageEngine } from "./gemini";
import { MockImageEngine, MockTextEngine } from "./mock";
import { OpenAIImageEngine } from "./openai";
import { EngineError, type ImageEngine, type TextEngine } from "./types";

// Registro central de motores. Los nombres de modelo salen siempre de variables de entorno.

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Modo de prueba: motores simulados, sin claves ni costo (ENGINE_MOCK=1). */
export function mockEnginesEnabled(): boolean {
  return env("ENGINE_MOCK") === "1";
}

export function getTextEngine(): TextEngine {
  if (mockEnginesEnabled()) return new MockTextEngine();
  const apiKey = env("ANTHROPIC_API_KEY");
  const model = env("ANTHROPIC_MODEL");
  if (!apiKey || !model) {
    throw new EngineError("config", "Falta configurar Claude: completá ANTHROPIC_API_KEY y ANTHROPIC_MODEL en .env.local.", "claude");
  }
  return new ClaudeTextEngine(model, apiKey);
}

type ImageEngineEntry = {
  label: string;
  keyVar: string;
  modelVar: string;
  create: (apiKey: string, model: string) => ImageEngine;
};

const IMAGE_ENGINES: Record<string, ImageEngineEntry> = {
  gemini: {
    label: "Gemini (Nano Banana)",
    keyVar: "GEMINI_API_KEY",
    modelVar: "GEMINI_IMAGE_MODEL",
    create: (apiKey, model) => new GeminiImageEngine(model, apiKey),
  },
  openai: {
    label: "OpenAI Images",
    keyVar: "OPENAI_API_KEY",
    modelVar: "OPENAI_IMAGE_MODEL",
    create: (apiKey, model) => new OpenAIImageEngine(model, apiKey),
  },
};

export type ImageEngineInfo = { name: string; label: string; configured: boolean; model: string | null };

export function listImageEngines(): ImageEngineInfo[] {
  const mock = mockEnginesEnabled();
  return Object.entries(IMAGE_ENGINES).map(([name, e]) => ({
    name,
    label: mock ? `${e.label} · simulado` : e.label,
    configured: mock || Boolean(env(e.keyVar) && env(e.modelVar)),
    model: mock ? "mock-image" : (env(e.modelVar) ?? null),
  }));
}

export function defaultImageEngineName(): string {
  return env("DEFAULT_IMAGE_ENGINE") ?? "gemini";
}

export function getImageEngine(name: string): ImageEngine {
  if (mockEnginesEnabled()) return new MockImageEngine(name);
  const entry = IMAGE_ENGINES[name];
  if (!entry) throw new EngineError("config", `No existe el motor de imagen "${name}".`, name);
  const apiKey = env(entry.keyVar);
  const model = env(entry.modelVar);
  if (!apiKey || !model) {
    throw new EngineError("config", `Falta configurar ${entry.label}: completá ${entry.keyVar} y ${entry.modelVar} en .env.local.`, name);
  }
  return entry.create(apiKey, model);
}
