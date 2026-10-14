/**
 * Duración de un MP4/MOV leyendo el box "mvhd" (timescale y duration). Devuelve null si no lo encuentra:
 * la duración es informativa (fija el largo del clip en el timeline) y no debe frenar el guardado.
 */
export function mp4DurationSec(data: Buffer): number | null {
  const index = data.indexOf("mvhd", 0, "ascii");
  if (index < 4) return null;
  const version = data[index + 4];
  try {
    if (version === 1) {
      const timescale = data.readUInt32BE(index + 4 + 4 + 16);
      const duration = Number(data.readBigUInt64BE(index + 4 + 4 + 16 + 4));
      return timescale ? Math.round((duration / timescale) * 100) / 100 : null;
    }
    const timescale = data.readUInt32BE(index + 4 + 4 + 8);
    const duration = data.readUInt32BE(index + 4 + 4 + 8 + 4);
    return timescale ? Math.round((duration / timescale) * 100) / 100 : null;
  } catch {
    return null;
  }
}
