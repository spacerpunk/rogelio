import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Fuentes",
  script: "Guion",
  shotlist: "Shot list",
  frames: "Frames",
  done: "Terminado",
};

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"] as const;

export type ProjectJob = Pick<
  JobRow,
  "id" | "type" | "status" | "progress" | "error" | "shot_id" | "payload" | "created_at" | "finished_at" | "cost_usd"
>;

export const JOB_COLUMNS = "id, type, status, progress, error, shot_id, payload, created_at, finished_at, cost_usd";

export type StepState = { done: boolean; label: string };

export type CostLine = {
  operation: string;
  engine: string;
  model: string;
  calls: number;
  errors: number;
  costUsd: number;
  durationMs: number;
  images: number;
};

export const OPERATION_LABEL: Record<string, string> = {
  extract_pdf: "Lectura de PDF",
  generate_script: "Guion",
  generate_shotlist: "Shot list",
  image_prompt: "Prompts de imagen",
  video_prompt: "Prompts de video",
  generate_frames: "Frames",
};

export type ProjectSummary = {
  project: Database["public"]["Tables"]["projects"]["Row"];
  client: { id: string; name: string };
  costUsd: number;
  costBreakdown: CostLine[];
  steps: { sources: StepState; script: StepState; shots: StepState; frames: StepState };
  jobs: ProjectJob[];
};

export async function loadProjectSummary(db: Db, projectId: string): Promise<ProjectSummary | null> {
  const { data: project } = await db
    .from("projects")
    .select("*, clients(id, name)")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!project?.clients) return null;

  const [cost, breakdown, sources, scripts, shots, jobs] = await Promise.all([
    db.from("project_costs").select("cost_usd").eq("project_id", projectId).maybeSingle(),
    db.from("project_cost_breakdown").select("*").eq("project_id", projectId).order("cost_usd", { ascending: false }),
    db.from("sources").select("id, extracted_text").eq("project_id", projectId).is("deleted_at", null),
    db.from("scripts").select("version, status").eq("project_id", projectId).is("deleted_at", null),
    db.from("shots").select("status").eq("project_id", projectId).is("deleted_at", null),
    db
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const readySources = (sources.data ?? []).filter((s) => s.extracted_text?.trim()).length;
  const approvedScript = (scripts.data ?? []).find((s) => s.status === "approved");
  const shotRows = shots.data ?? [];
  const approvedShots = shotRows.filter((s) => s.status !== "draft").length;
  const framedShots = shotRows.filter((s) => s.status === "frame_selected").length;
  const { clients, ...projectRow } = project;

  return {
    project: projectRow,
    client: clients,
    costUsd: Number(cost.data?.cost_usd ?? 0),
    costBreakdown: (breakdown.data ?? []).map((b) => ({
      operation: b.operation ?? "",
      engine: b.engine ?? "",
      model: b.model ?? "",
      calls: b.calls ?? 0,
      errors: b.errors ?? 0,
      costUsd: Number(b.cost_usd ?? 0),
      durationMs: Number(b.duration_ms ?? 0),
      images: b.images ?? 0,
    })),
    steps: {
      sources: {
        done: readySources > 0,
        label: sources.data?.length ? `${readySources}/${sources.data.length} listas` : "Sin fuentes",
      },
      script: {
        done: Boolean(approvedScript),
        label: approvedScript
          ? `v${approvedScript.version} aprobada`
          : scripts.data?.length
            ? `${scripts.data.length} versión${scripts.data.length > 1 ? "es" : ""}`
            : "Sin guion",
      },
      shots: {
        done: shotRows.length > 0 && approvedShots === shotRows.length,
        label: shotRows.length ? `${approvedShots}/${shotRows.length} aprobados` : "Sin planos",
      },
      frames: {
        done: shotRows.length > 0 && framedShots === shotRows.length,
        label: shotRows.length ? `${framedShots}/${shotRows.length} elegidos` : "—",
      },
    },
    jobs: (jobs.data ?? []) as ProjectJob[],
  };
}

export function formatUsd(value: number): string {
  return `US$ ${value.toFixed(value < 1 ? 3 : 2)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}:${String(s).padStart(2, "0")} min` : `${s} s`;
}
