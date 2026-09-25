import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineResultMeta } from "@/lib/engines/types";
import type { Database, Json } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;
export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
export type JobType = Database["public"]["Enums"]["job_type"];
export type JobStatus = Database["public"]["Enums"]["job_status"];

export type JobProgress = { done: number; total: number; message?: string };

export type JobContext = {
  db: Db;
  job: JobRow;
  /** Actualiza el progreso visible en la UI. */
  progress(done: number, total: number, message?: string): Promise<void>;
  /**
   * Ejecuta una llamada a un motor y la registra en engine_calls (modelo, duración, uso y costo),
   * también si falla.
   */
  track<T extends EngineResultMeta>(
    engine: { name: string; model: string },
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T>;
};

export type JobHandler = (ctx: JobContext) => Promise<Json | null>;
