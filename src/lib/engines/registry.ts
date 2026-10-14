import { ClaudeTextEngine } from "./claude";
import { GeminiImageEngine, GeminiTextEngine, GeminiVideoEngine } from "./gemini";
import { MockImageEngine, MockTextEngine, MockVideoEngine } from "./mock";
import { OpenAIImageEngine, OpenAITextEngine } from "./openai";
import { EngineError, type ImageEngine, type TextEngine, type VideoEngine } from "./types";

// Registro central de motores. Los nombres de modelo salen siempre de variables de entorno: cada una
// admite una lista separada por comas (los modelos que se pueden elegir en la UI); el primero es el default.

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envList(name: string): string[] {
  return (env(name) ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

/** Modo de prueba: motores simulados, sin claves ni costo (ENGINE_MOCK=1). */
export function mockEnginesEnabled(): boolean {
  return env("ENGINE_MOCK") === "1";
}

type EngineEntry<T> = {
  label: string;
  keyVar: string;
  modelVar: string;
  create: (apiKey: string, model: string) => T;
};

/** model: el modelo por defecto del motor; models: todos los habilitados en .env.local. */
export type EngineInfo = { name: string; label: string; configured: boolean; model: string | null; models: string[] };

function listEngines<T>(registry: Record<string, EngineEntry<T>>, mockModel: string): EngineInfo[] {
  const mock = mockEnginesEnabled();
  return Object.entries(registry).map(([name, e]) => {
    const models = mock ? [mockModel] : envList(e.modelVar);
    return {
      name,
      label: mock ? `${e.label} · simulado` : e.label,
      configured: mock || Boolean(env(e.keyVar) && models.length),
      model: models[0] ?? null,
      models,
    };
  });
}

/** El motor preferido si está configurado; si no, el primero configurado (o el preferido, para que el error lo nombre). */
function preferConfigured(engines: EngineInfo[], preferred: string): string {
  if (engines.find((e) => e.name === preferred)?.configured) return preferred;
  return engines.find((e) => e.configured)?.name ?? preferred;
}

/** Para las acciones de la UI: el motor existe y tiene clave y modelo (o está activo el modo simulado). */
const KIND_LABEL = { text: "texto", image: "imagen", video: "video" } as const;

export function assertEngineReady(kind: "text" | "image" | "video", name: string): void {
  const list = kind === "text" ? listTextEngines() : kind === "image" ? listImageEngines() : listVideoEngines();
  const engine = list.find((e) => e.name === name);
  if (!engine) throw new Error(`No existe el motor de ${KIND_LABEL[kind]} "${name}".`);
  if (!engine.configured) throw new Error(`${engine.label} no está configurado: completá su API key y modelo en .env.local.`);
}

/** model null = el primero de la lista. Un modelo que no está en la lista falla: nunca se cambia en silencio. */
function createEngine<T>(registry: Record<string, EngineEntry<T>>, kind: string, name: string, model: string | null = null): T {
  const entry = registry[name];
  if (!entry) throw new EngineError("config", `No existe el motor de ${kind} "${name}".`, name);
  const apiKey = env(entry.keyVar);
  const models = envList(entry.modelVar);
  if (!apiKey || !models.length) {
    throw new EngineError("config", `Falta configurar ${entry.label}: completá ${entry.keyVar} y ${entry.modelVar} en .env.local.`, name);
  }
  const chosen = model ?? models[0];
  if (!models.includes(chosen)) {
    throw new EngineError("config", `El modelo "${chosen}" no está habilitado: agregalo a ${entry.modelVar} en .env.local o elegí otro.`, name);
  }
  return entry.create(apiKey, chosen);
}

const TEXT_ENGINES: Record<string, EngineEntry<TextEngine>> = {
  claude: {
    label: "Claude (Anthropic)",
    keyVar: "ANTHROPIC_API_KEY",
    modelVar: "ANTHROPIC_MODEL",
    create: (apiKey, model) => new ClaudeTextEngine(model, apiKey),
  },
  openai: {
    label: "GPT (OpenAI)",
    keyVar: "OPENAI_API_KEY",
    modelVar: "OPENAI_TEXT_MODEL",
    create: (apiKey, model) => new OpenAITextEngine(model, apiKey),
  },
  gemini: {
    label: "Gemini (Google)",
    keyVar: "GEMINI_API_KEY",
    modelVar: "GEMINI_TEXT_MODEL",
    create: (apiKey, model) => new GeminiTextEngine(model, apiKey),
  },
};

export function listTextEngines(): EngineInfo[] {
  return listEngines(TEXT_ENGINES, "mock-text");
}

/** Motor de texto de los proyectos que no eligieron uno. */
export function defaultTextEngineName(): string {
  return preferConfigured(listTextEngines(), env("DEFAULT_TEXT_ENGINE") ?? "claude");
}

/** Motor de texto elegido en el proyecto (lectura de PDFs, guion, shot list y prompts); null = el default. */
export function getTextEngine(name: string | null = null): TextEngine {
  const engineName = name ?? defaultTextEngineName();
  if (mockEnginesEnabled()) {
    const label = TEXT_ENGINES[engineName]?.label.replace(/ \(.*\)$/, "");
    return new MockTextEngine(engineName, `${label ?? "Motor"} (simulado)`);
  }
  return createEngine(TEXT_ENGINES, "texto", engineName);
}

const IMAGE_ENGINES: Record<string, EngineEntry<ImageEngine>> = {
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

export function listImageEngines(): EngineInfo[] {
  return listEngines(IMAGE_ENGINES, "mock-image");
}

/** Motor de imagen de los proyectos que no eligieron uno. */
export function defaultImageEngineName(): string {
  return preferConfigured(listImageEngines(), env("DEFAULT_IMAGE_ENGINE") ?? "gemini");
}

/** model null = el modelo por defecto del motor (el primero de su lista en .env.local). */
export function getImageEngine(name: string, model: string | null = null): ImageEngine {
  if (mockEnginesEnabled()) return new MockImageEngine(name);
  return createEngine(IMAGE_ENGINES, "imagen", name, model);
}

/** Para las acciones de la UI: el modelo está habilitado para ese motor de imagen. */
export function assertImageModelReady(engineName: string, model: string): void {
  const engine = listImageEngines().find((e) => e.name === engineName);
  if (!engine?.models.includes(model)) {
    throw new Error(`El modelo "${model}" no está habilitado para ${engine?.label ?? engineName}: agregalo en .env.local.`);
  }
}

const VIDEO_ENGINES: Record<string, EngineEntry<VideoEngine>> = {
  gemini: {
    label: "Gemini Omni",
    keyVar: "GEMINI_API_KEY",
    modelVar: "GEMINI_VIDEO_MODEL",
    create: (apiKey, model) => new GeminiVideoEngine(model, apiKey),
  },
};

export function listVideoEngines(): EngineInfo[] {
  return listEngines(VIDEO_ENGINES, "mock-video");
}

/** Motor de video de los proyectos que no eligieron uno. */
export function defaultVideoEngineName(): string {
  return preferConfigured(listVideoEngines(), env("DEFAULT_VIDEO_ENGINE") ?? "gemini");
}

/** model null = el modelo por defecto del motor (el primero de su lista en .env.local). */
export function getVideoEngine(name: string, model: string | null = null): VideoEngine {
  if (mockEnginesEnabled()) return new MockVideoEngine(name);
  return createEngine(VIDEO_ENGINES, "video", name, model);
}

/** Para las acciones de la UI: el modelo está habilitado para ese motor de video. */
export function assertVideoModelReady(engineName: string, model: string): void {
  const engine = listVideoEngines().find((e) => e.name === engineName);
  if (!engine?.models.includes(model)) {
    throw new Error(`El modelo "${model}" no está habilitado para ${engine?.label ?? engineName}: agregalo en .env.local.`);
  }
}
