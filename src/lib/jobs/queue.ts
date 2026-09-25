import type { Json } from "@/lib/supabase/database.types";
import type { Db, JobType } from "./types";

export async function enqueueJob(
  db: Db,
  job: { projectId: string; type: JobType; payload?: Record<string, Json>; shotId?: string | null },
): Promise<string> {
  const { data, error } = await db
    .from("jobs")
    .insert({ project_id: job.projectId, type: job.type, payload: job.payload ?? {}, shot_id: job.shotId ?? null })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo encolar el trabajo: ${error.message}`);
  return data.id;
}

/** ¿Hay un trabajo de este tipo en cola o corriendo para el proyecto (opcionalmente, para un plano)? */
export async function hasActiveJob(db: Db, projectId: string, type: JobType, shotId?: string): Promise<boolean> {
  let query = db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("type", type)
    .in("status", ["queued", "running"])
    .is("deleted_at", null);
  if (shotId) query = query.eq("shot_id", shotId);
  const { count } = await query;
  return Boolean(count);
}
