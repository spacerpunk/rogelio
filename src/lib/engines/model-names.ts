// Nombres comerciales de los modelos, solo para mostrar en la UI (los modelos habilitados salen de .env.local).
const MODEL_NAMES: Record<string, string> = {
  "gemini-3.1-flash-image": "Nano Banana 2",
  "gemini-3-pro-image": "Nano Banana Pro",
  "gemini-2.5-flash-image": "Nano Banana",
};

export function modelName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}
