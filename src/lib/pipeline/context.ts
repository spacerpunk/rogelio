import { getActiveText } from "@/lib/library/data";
import type { Db } from "@/lib/jobs/types";
import type { Database, Json } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];

export type ProjectContext = {
  project: Tables["projects"]["Row"];
  clientName: string;
  characters: Tables["characters"]["Row"][];
  locations: Tables["locations"]["Row"][];
};

/** Proyecto + cliente + personajes y locaciones vigentes de su biblioteca. */
export async function loadProjectContext(db: Db, projectId: string): Promise<ProjectContext> {
  const { data: project, error } = await db
    .from("projects")
    .select("*, clients(name)")
    .eq("id", projectId)
    .single();
  if (error || !project) throw new Error("No encontré el proyecto.");
  const { clients, ...row } = project;

  const [characters, locations] = await Promise.all([
    db.from("characters").select("*").eq("client_id", row.client_id).is("deleted_at", null).order("name"),
    db.from("locations").select("*").eq("client_id", row.client_id).is("deleted_at", null).order("name"),
  ]);
  return {
    project: row,
    clientName: clients?.name ?? "",
    characters: characters.data ?? [],
    locations: locations.data ?? [],
  };
}

export async function activeTextContent(db: Db, clientId: string, kind: Parameters<typeof getActiveText>[2]) {
  return (await getActiveText(db, clientId, kind))?.text_content ?? null;
}

/** Guarda un guion como versión nueva (nunca pisa una existente) y devuelve su número. */
export async function insertScriptVersion(db: Db, projectId: string, content: string, params: Json): Promise<number> {
  const { data: last } = await db
    .from("scripts")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { error } = await db.from("scripts").insert({ project_id: projectId, version, content, generation_params: params });
  if (error) throw new Error(`No se pudo guardar el guion: ${error.message}`);
  return version;
}

/** Avanza el estado del proyecto sin retroceder nunca. */
export async function advanceProjectStatus(db: Db, projectId: string, to: Tables["projects"]["Row"]["status"]) {
  const order = ["draft", "script", "shotlist", "frames", "done"] as const;
  const { data } = await db.from("projects").select("status").eq("id", projectId).single();
  if (data && order.indexOf(data.status) < order.indexOf(to)) {
    await db.from("projects").update({ status: to }).eq("id", projectId);
  }
}
