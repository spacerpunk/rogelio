export function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en .env.local");
  return value;
}
