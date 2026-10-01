export function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
  // Error típico: copiar de `npm run db:status` la URL de S3 (/storage/v1/s3) o de REST (/rest/v1).
  if (URL.canParse(value) && new URL(value).pathname.replace(/\/+$/, "") !== "") {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL tiene que ser la URL base de la API, sin ruta (por ejemplo http://127.0.0.1:44321). Ahora es ${value}`,
    );
  }
  return value;
}
