import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Cliente del navegador, solo para subir archivos con URLs firmadas que genera el servidor.
 * La clave anónima no tiene permisos sobre tablas ni buckets: sin token firmado no puede hacer nada.
 */
function browserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  client ??= createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export async function uploadToSignedTarget(
  bucket: "library" | "projects",
  target: { path: string; token: string },
  file: File,
): Promise<void> {
  const { error } = await browserClient()
    .storage.from(bucket)
    .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(`No se pudo subir ${file.name}: ${error.message}`);
}
