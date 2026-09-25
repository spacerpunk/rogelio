export type SourceKind = "pdf" | "pptx" | "docx" | "text";

const BY_EXTENSION: Record<string, SourceKind> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
  txt: "text",
  md: "text",
};

const BY_MIME: Record<string, SourceKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
};

export const SOURCE_ACCEPT = ".pdf,.pptx,.docx,.txt,.md";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  pdf: "PDF",
  pptx: "PPTX",
  docx: "DOCX",
  text: "Texto",
};

export function sourceKind(mimeType: string, fileName: string): SourceKind | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return BY_MIME[mimeType] ?? BY_EXTENSION[ext] ?? null;
}

export function unsupportedSourceMessage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "ppt") return `${fileName}: guardalo como PPTX para poder leerlo.`;
  if (ext === "doc") return `${fileName}: guardalo como DOCX para poder leerlo.`;
  return `${fileName}: formato no soportado (se aceptan PDF, PPTX, DOCX, TXT y MD).`;
}

/** Mime normalizado para guardar en la base (el navegador a veces manda vacío o genérico). */
export function normalizedMime(kind: SourceKind): string {
  return {
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text: "text/plain",
  }[kind];
}
