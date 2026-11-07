import type { Metadata } from "next";
import { modelName } from "@/lib/engines/model-names";
import { defaultImageEngineName, listImageEngines } from "@/lib/engines/registry";
import { shotPromptHash } from "@/lib/pipeline/prompts";
import { autoReferences } from "@/lib/pipeline/references";
import { locationLabel } from "@/lib/library/locations";
import { referencePickerOptions, shotReferenceViews } from "@/lib/projects/review";
import { signImages } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { FramesStep, type FrameView, type ShotFramesView } from "./frames-step";

export const metadata: Metadata = { title: "Frames" };

export default async function FramesPage({ params }: PageProps<"/projects/[id]/frames">) {
  const { id } = await params;
  const db = await createClient();
  const { data: project } = await db
    .from("projects")
    .select("client_id, aspect_ratio, image_engine, image_model, image_size")
    .eq("id", id)
    .single();
  const clientId = project!.client_id;

  const [shots, characters, locations, assets] = await Promise.all([
    db.from("shots").select("*").eq("project_id", id).is("deleted_at", null).order("order_index"),
    db.from("characters").select("id, name, sheet_asset_ids, based_on_real_person, consent_confirmed").eq("client_id", clientId).is("deleted_at", null),
    // También las archivadas: un plano viejo puede seguir apuntando a una.
    db.from("locations").select("id, code, name, plate_asset_ids, deleted_at").eq("client_id", clientId),
    db
      .from("library_assets")
      .select("id, title, kind, storage_path, is_active")
      .eq("client_id", clientId)
      .in("kind", ["character_sheet", "location_plate", "ppe_sheet"])
      .is("deleted_at", null),
  ]);
  if (shots.error) throw new Error(shots.error.message);

  const shotIds = shots.data.map((s) => s.id);
  const { data: frames } = shotIds.length
    ? await db
        .from("frames")
        .select("*")
        .in("shot_id", shotIds)
        .is("deleted_at", null)
        .order("variant_index", { ascending: false })
    : { data: [] };

  const assetsById = new Map((assets.data ?? []).map((a) => [a.id, a]));
  const ppeSheets = (assets.data ?? []).filter((a) => a.kind === "ppe_sheet" && a.is_active);
  const charactersById = new Map((characters.data ?? []).map((c) => [c.id, c]));
  const locationsById = new Map((locations.data ?? []).map((l) => [l.id, l]));
  const charactersOf = (ids: string[]) => ids.flatMap((cid) => (charactersById.has(cid) ? [charactersById.get(cid)!] : []));

  const autoByShot = new Map(
    shots.data.map((s) => {
      const location = s.location_id ? (locationsById.get(s.location_id) ?? null) : null;
      return [s.id, autoReferences("image", charactersOf(s.character_ids), location, assetsById, ppeSheets)];
    }),
  );

  const [signedFrames, references, picker] = await Promise.all([
    signImages(db, "projects", (frames ?? []).map((f) => f.storage_path)),
    shotReferenceViews(db, "image", shots.data, autoByShot),
    referencePickerOptions(db, clientId, shots.data.map((s, i) => ({ id: s.id, number: i + 1 }))),
  ]);

  const views: ShotFramesView[] = shots.data.map((s, i) => {
    const shotCharacters = charactersOf(s.character_ids);
    const refs = references.get(s.id) ?? { active: [], removed: [], key: "" };
    return {
      id: s.id,
      number: i + 1,
      sceneNumber: s.scene_number,
      sceneTitle: s.scene_title,
      framing: s.framing,
      status: s.status,
      action: s.action,
      voLine: s.vo_line,
      characters: shotCharacters.map((c) => c.name),
      missingConsent: shotCharacters.filter((c) => c.based_on_real_person && !c.consent_confirmed).map((c) => c.name),
      location: s.location_id && locationsById.has(s.location_id) ? locationLabel(locationsById.get(s.location_id)!) : null,
      imagePrompt: s.image_prompt,
      imageNegative: s.image_negative,
      promptStale: Boolean(s.image_prompt && s.prompt_inputs_hash && s.prompt_inputs_hash !== shotPromptHash(s)),
      referencesChanged: Boolean(s.image_prompt && s.image_prompt_references_key !== null && s.image_prompt_references_key !== refs.key),
      references: refs,
      frames: (frames ?? [])
        .filter((f) => f.shot_id === s.id)
        .flatMap((f): FrameView[] => {
          const img = signedFrames.get(f.storage_path);
          if (!img) return [];
          return [
            {
              id: f.id,
              variantIndex: f.variant_index,
              url: img.url,
              thumbUrl: img.thumbUrl,
              engine: f.engine,
              model: f.model,
              selected: f.selected,
              rejected: f.rejected,
              reviewNotes: f.review_notes,
              promptChanged: Boolean(s.image_prompt && f.prompt_used !== s.image_prompt),
              createdAt: f.created_at,
              costUsd: Number(f.cost_usd),
            },
          ];
        }),
    };
  });

  const engines = listImageEngines();
  const imageEngine = project!.image_engine ?? defaultImageEngineName();
  const imageModel = project!.image_model ?? engines.find((e) => e.name === imageEngine)?.model ?? null;

  return (
    <FramesStep
      projectId={id}
      aspectRatio={project!.aspect_ratio}
      shots={views}
      engines={engines}
      engine={imageEngine}
      libraryImages={picker.libraryImages}
      frameOptions={picker.frameOptions}
      imageSummary={[
        imageModel ? modelName(imageModel) : "sin modelo",
        ...(imageEngine === "gemini" ? [project!.image_size] : []),
        project!.aspect_ratio,
      ].join(" · ")}
    />
  );
}
