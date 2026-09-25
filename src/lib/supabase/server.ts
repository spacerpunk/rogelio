import "server-only";
import { connection } from "next/server";
import { createAdminClient } from "./admin";

/**
 * Acceso a la base desde Server Components y Server Actions.
 * La app no tiene login: todo pasa por el servidor con service role, y el navegador nunca habla con
 * Supabase directamente (RLS está activo sin políticas, así que la clave anónima no da acceso a nada).
 */
export async function createClient() {
  // Sin cookies ni headers Next prerenderizaría las páginas en el build; esto fuerza render por request.
  await connection();
  return createAdminClient();
}
