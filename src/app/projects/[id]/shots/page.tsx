import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ShotsStep, type ShotView } from "./shots-step";

export const metadata: Metadata = { title: "Shot list" };

export default async function ShotsPage({ params }: PageProps<"/projects/[id]/shots">) {
  const { id } = await params;
  const db = await createClient();
  const { data: project } = await db.from("projects").select("client_id, target_duration_sec").eq("id", id).single();
  const [shots, characters, locations, script] = await Promise.all([
    db.from("shots").select("*").eq("project_id", id).is("deleted_at", null).order("order_index"),
    db.from("characters").select("id, name").eq("client_id", project!.client_id).is("deleted_at", null).order("name"),
    db.from("locations").select("id, name").eq("client_id", project!.client_id).is("deleted_at", null).order("name"),
    db.from("scripts").select("version").eq("project_id", id).eq("status", "approved").maybeSingle(),
  ]);
  if (shots.error) throw new Error(`No se pudo cargar el shot list: ${shots.error.message}`);

  const views: ShotView[] = shots.data.map((s) => ({
    id: s.id,
    orderIndex: s.order_index,
    sceneNumber: s.scene_number,
    sceneTitle: s.scene_title,
    characterIds: s.character_ids,
    locationId: s.location_id,
    framing: s.framing,
    lighting: s.lighting,
    action: s.action,
    voLine: s.vo_line,
    onScreenText: s.on_screen_text,
    estDurationSec: Number(s.est_duration_sec ?? 0),
    status: s.status,
    notes: s.notes,
    scriptVersion: s.script_version,
    updatedAt: s.updated_at,
  }));

  return (
    <ShotsStep
      projectId={id}
      shots={views}
      characters={characters.data ?? []}
      locations={locations.data ?? []}
      approvedScriptVersion={script.data?.version ?? null}
      targetSec={project?.target_duration_sec ?? null}
    />
  );
}
