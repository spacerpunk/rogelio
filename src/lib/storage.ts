import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { Database } from "@/lib/supabase/database.types";

export type Bucket = "library" | "projects";
type Db = SupabaseClient<Database>;

const THUMB_WIDTH = 640;
const SIGNED_URL_TTL_SEC = 60 * 60;

/** Nombre de archivo seguro para Storage (sin acentos, espacios ni caracteres raros). */
export function safeFileName(name: string): string {
  const normalized = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned.toLowerCase() || "archivo";
}

export function uniquePath(folder: string, fileName: string): string {
  return `${folder}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(fileName)}`;
}

/** Las miniaturas viven en el mismo bucket, bajo thumbs/, en webp. */
export function thumbPathFor(path: string): string {
  return `thumbs/${path}.webp`;
}

export function isImageMime(mime: string | null | undefined): boolean {
  return Boolean(mime?.startsWith("image/"));
}

export async function uploadBuffer(
  db: Db,
  bucket: Bucket,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, data, { contentType, upsert: false });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
}

export async function downloadBuffer(db: Db, bucket: Bucket, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`No se pudo descargar ${path}: ${error?.message ?? "sin datos"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function makeThumbnail(image: Buffer): Promise<Buffer> {
  return sharp(image).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

/** Genera y sube la miniatura de una imagen ya subida. No falla si la imagen no se puede procesar. */
export async function ensureThumbnail(db: Db, bucket: Bucket, path: string, image?: Buffer): Promise<boolean> {
  try {
    const source = image ?? (await downloadBuffer(db, bucket, path));
    const thumb = await makeThumbnail(source);
    const { error } = await db.storage
      .from(bucket)
      .upload(thumbPathFor(path), thumb, { contentType: "image/webp", upsert: true });
    return !error;
  } catch {
    return false;
  }
}

export type SignedImage = { url: string; thumbUrl: string };

/**
 * URLs firmadas (1 h) para mostrar imágenes: original y miniatura. Si falta la miniatura se usa el original.
 */
export async function signImages(db: Db, bucket: Bucket, paths: string[]): Promise<Map<string, SignedImage>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, SignedImage>();
  if (unique.length === 0) return result;

  const storage = db.storage.from(bucket);
  // En tandas: un proyecto grande puede tener cientos de frames.
  for (let start = 0; start < unique.length; start += 300) {
    const chunk = unique.slice(start, start + 300);
    const [originals, thumbs] = await Promise.all([
      storage.createSignedUrls(chunk, SIGNED_URL_TTL_SEC),
      storage.createSignedUrls(chunk.map(thumbPathFor), SIGNED_URL_TTL_SEC),
    ]);
    chunk.forEach((path, i) => {
      const url = originals.data?.[i]?.signedUrl;
      if (!url) return;
      const thumb = thumbs.data?.[i];
      result.set(path, { url, thumbUrl: thumb && !thumb.error && thumb.signedUrl ? thumb.signedUrl : url });
    });
  }
  return result;
}

export async function signUrl(db: Db, bucket: Bucket, path: string): Promise<string | null> {
  const { data } = await db.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SEC);
  return data?.signedUrl ?? null;
}
