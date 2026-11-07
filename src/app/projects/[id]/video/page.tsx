import type { Metadata } from "next";
import { defaultVideoEngineName, listVideoEngines } from "@/lib/engines/registry";
import { locationLabel } from "@/lib/library/locations";
import { autoReferences } from "@/lib/pipeline/references";
import { referencePickerOptions, shotReferenceViews } from "@/lib/projects/review";
import { signFiles, signImages } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { VideoStep, type ClipView, type ShotVideoView } from "./video-step";

export const metadata: Metadata = { title: "Video" };

export default async function VideoPage({ params }: PageProps<"/projects/[id]/video">) {
  const { id } = await params;
  const db = await createClient();
  const { data: project } = await db
    .from("projects")
    .select("client_id, aspect_ratio, video_engine, video_model, video_resolution")
    .eq("id", id)
    .single();
  const clientId = project!.client_id;

  const [shots, characters, locations, sheets, videoSystem] = await Promise.all([
    db.from("shots").select("*").eq("project_id", id).is("deleted_at", null).order("order_index"),
    db.from("characters").select("id, name, sheet_asset_ids, based_on_real_person, consent_confirmed").eq("client_id", clientId).is("deleted_at", null),
    db.from("locations").select("id, code, name").eq("client_id", clientId),
    db.from("library_assets").select("id, title, storage_path").eq("client_id", clientId).eq("kind", "character_sheet").is("deleted_at", null),
    db
      .from("library_assets")
      .select("title, version")
      .eq("client_id", clientId)
      .eq("kind", "video_system_prompt")
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (shots.error) throw new Error(shots.error.message);

  const shotIds = shots.data.map((s) => s.id);
  const [frames, clips] = shotIds.length
    ? await Promise.all([
        db.from("frames").select("id, shot_id, storage_path, selected").in("shot_id", shotIds).is("deleted_at", null),
        db
          .from("clips")
          .select("*")
          .in("shot_id", shotIds)
          .is("deleted_at", null)
          .order("variant_index", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const charactersById = new Map((characters.data ?? []).map((c) => [c.id, c]));
  const locationsById = new Map((locations.data ?? []).map((l) => [l.id, l]));
  const sheetsById = new Map((sheets.data ?? []).map((a) => [a.id, a]));
  const charactersOf = (ids: string[]) => ids.flatMap((cid) => (charactersById.has(cid) ? [charactersById.get(cid)!] : []));
  const autoByShot = new Map(shots.data.map((s) => [s.id, autoReferences("video", charactersOf(s.character_ids), null, sheetsById, [])]));

  const framesById = new Map((frames.data ?? []).map((f) => [f.id, f]));
  const approvedByShot = new Map((frames.data ?? []).filter((f) => f.selected).map((f) => [f.shot_id, f]));
  // Imágenes: el frame aprobado de cada plano y el frame del que salió cada clip (póster del video).
  const framePaths = [
    ...[...approvedByShot.values()].map((f) => f.storage_path),
    ...(clips.data ?? []).flatMap((c) => (c.frame_id && framesById.has(c.frame_id) ? [framesById.get(c.frame_id)!.storage_path] : [])),
  ];
  const [signedFrames, signedClips, references, picker] = await Promise.all([
    signImages(db, "projects", framePaths),
    signFiles(db, "projects", (clips.data ?? []).flatMap((c) => (c.video_path ? [c.video_path] : []))),
    shotReferenceViews(db, "video", shots.data, autoByShot),
    referencePickerOptions(db, clientId, shots.data.map((s, i) => ({ id: s.id, number: i + 1 }))),
  ]);

  const views: ShotVideoView[] = shots.data.map((s, i) => {
    const shotCharacters = charactersOf(s.character_ids);
    const frame = approvedByShot.get(s.id) ?? null;
    const frameImage = frame ? signedFrames.get(frame.storage_path) : undefined;
    const refs = references.get(s.id) ?? { active: [], removed: [], key: "" };
    return {
      id: s.id,
      number: i + 1,
      sceneNumber: s.scene_number,
      sceneTitle: s.scene_title,
      action: s.action,
      voLine: s.vo_line,
      estDurationSec: Number(s.est_duration_sec ?? 0),
      characters: shotCharacters.map((c) => c.name),
      missingConsent: shotCharacters.filter((c) => c.based_on_real_person && !c.consent_confirmed).map((c) => c.name),
      realPeople: shotCharacters.filter((c) => c.based_on_real_person).map((c) => c.name),
      location: s.location_id && locationsById.has(s.location_id) ? locationLabel(locationsById.get(s.location_id)!) : null,
      frame: frame && frameImage ? { id: frame.id, url: frameImage.url, thumbUrl: frameImage.thumbUrl } : null,
      videoPrompt: s.video_prompt,
      videoNegative: s.video_negative,
      videoDurationSec: s.video_duration_sec === null ? null : Number(s.video_duration_sec),
      videoQaNotes: s.video_qa_notes,
      // El prompt se escribió mirando otro frame (o es un borrador viejo, sin frame): hay que regenerarlo.
      promptStale: Boolean(s.video_prompt && frame && s.video_prompt_frame_id !== frame.id),
      referencesChanged: Boolean(s.video_prompt && s.video_prompt_references_key !== null && s.video_prompt_references_key !== refs.key),
      references: refs,
      clips: (clips.data ?? [])
        .filter((c) => c.shot_id === s.id)
        .flatMap((c): ClipView[] => {
          const url = c.video_path ? signedClips.get(c.video_path) : undefined;
          if (!url) return [];
          const source = c.frame_id ? framesById.get(c.frame_id) : undefined;
          return [
            {
              id: c.id,
              variantIndex: c.variant_index,
              url,
              posterUrl: source ? (signedFrames.get(source.storage_path)?.thumbUrl ?? null) : null,
              engine: c.engine ?? "",
              model: c.model ?? "",
              durationSec: c.duration_sec === null ? null : Number(c.duration_sec),
              resolution: c.resolution,
              selected: c.selected,
              rejected: c.rejected,
              reviewNotes: c.review_notes,
              fromOtherFrame: Boolean(frame && c.frame_id !== frame.id),
              promptChanged: Boolean(s.video_prompt && c.prompt_used !== s.video_prompt),
              costUsd: Number(c.cost_usd),
            },
          ];
        }),
    };
  });

  const engines = listVideoEngines();
  const videoEngine = project!.video_engine ?? defaultVideoEngineName();
  const videoModel = project!.video_model ?? engines.find((e) => e.name === videoEngine)?.model ?? null;

  return (
    <VideoStep
      projectId={id}
      aspectRatio={project!.aspect_ratio}
      shots={views}
      engines={engines}
      engine={videoEngine}
      videoSummary={[videoModel ?? "sin modelo", project!.video_resolution, project!.aspect_ratio].join(" · ")}
      systemPrompt={videoSystem.data ? `${videoSystem.data.title} · v${videoSystem.data.version}` : null}
      libraryImages={picker.libraryImages}
      frameOptions={picker.frameOptions}
    />
  );
}
