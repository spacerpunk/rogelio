import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseUrl } from "./env";

/**
 * Cliente con service role: saltea RLS. Lo usan el servidor de Next (vía ./server), el worker y el seed.
 * No importar desde componentes de cliente.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");

  return createClient<Database>(supabaseUrl(), serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
