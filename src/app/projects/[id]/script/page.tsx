import type { Metadata } from "next";
import { defaultScriptParams, scriptParamsSchema, type ScriptParams } from "@/lib/pipeline/script";
import { createClient } from "@/lib/supabase/server";
import { ScriptStep, type ScriptVersion } from "./script-step";

export const metadata: Metadata = { title: "Guion" };

export default async function ScriptPage({ params }: PageProps<"/projects/[id]/script">) {
  const { id } = await params;
  const db = await createClient();
  const { data: project } = await db.from("projects").select("client_id, target_duration_sec").eq("id", id).single();
  const [scripts, characters, sources, shots] = await Promise.all([
    db
      .from("scripts")
      .select("id, version, content, status, generation_params, created_at, approved_at")
      .eq("project_id", id)
      .is("deleted_at", null)
      .order("version", { ascending: false }),
    db
      .from("characters")
      .select("id, name, role, based_on_real_person, consent_confirmed")
      .eq("client_id", project!.client_id)
      .is("deleted_at", null)
      .order("name"),
    db
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .is("deleted_at", null)
      .not("extracted_text", "is", null),
    db.from("shots").select("script_version").eq("project_id", id).is("deleted_at", null).limit(1).maybeSingle(),
  ]);

  const versions: ScriptVersion[] = (scripts.data ?? []).map((s) => ({
    id: s.id,
    version: s.version,
    content: s.content,
    approved: s.status === "approved",
    createdAt: s.created_at,
    params: s.generation_params as Record<string, unknown>,
  }));

  // Parámetros por defecto: los del último guion generado, o los del proyecto.
  const lastGenerated = versions.find((v) => !v.params.manual);
  const parsed = scriptParamsSchema.safeParse(lastGenerated?.params);
  const allCharacterIds = (characters.data ?? []).map((c) => c.id);
  const initialParams: ScriptParams = parsed.success
    ? parsed.data
    : defaultScriptParams(project?.target_duration_sec ?? null, allCharacterIds);

  return (
    <ScriptStep
      projectId={id}
      versions={versions}
      characters={(characters.data ?? []).map((c) => ({ id: c.id, name: c.name, role: c.role }))}
      initialParams={initialParams}
      hasSources={Boolean(sources.count)}
      shotListVersion={shots.data?.script_version ?? null}
    />
  );
}
