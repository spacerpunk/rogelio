/** Cómo se nombra una locación en guiones, shot list y UI: "P7 · Campamento" (o solo el nombre si no tiene código). */
export function locationLabel(location: { code?: string | null; name: string }): string {
  return location.code?.trim() ? `${location.code.trim()} · ${location.name}` : location.name;
}

/** Orden natural por código (P2 antes que P10) y después por nombre; las sin código van al final. */
export function compareLocations(a: { code?: string | null; name: string }, b: { code?: string | null; name: string }): number {
  if (a.code && !b.code) return -1;
  if (!a.code && b.code) return 1;
  if (a.code && b.code) {
    const byCode = a.code.localeCompare(b.code, "es", { numeric: true, sensitivity: "base" });
    if (byCode) return byCode;
  }
  return a.name.localeCompare(b.name, "es");
}
