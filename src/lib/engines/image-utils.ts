/** Detecta el tipo de imagen por sus primeros bytes. */
export function sniffImageMime(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (data.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "application/octet-stream";
}

/** Agrega las restricciones negativas al prompt para motores sin campo "negative". */
export function withNegative(prompt: string, negative?: string): string {
  return negative?.trim() ? `${prompt.trim()}\n\nAvoid: ${negative.trim()}` : prompt.trim();
}
