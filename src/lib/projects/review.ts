import type { Db } from "@/lib/jobs/types";
import { kindLabel, type AssetKind } from "@/lib/library/kinds";
import {
  applyReferenceOverrides,
  excludedFor,
  loadManualReferences,
  referencesKey,
  type ReferenceAsset,
  type ReferenceKind,
  type ReferenceTarget,
} from "@/lib/pipeline/references";
import { signImages, type Bucket } from "@/lib/storage";

/** Una referencia como la ve la UI. */
export type ReferenceView = {
  key: string;
  label: string;
  thumbUrl: string;
  url: string;
  kind: ReferenceKind;
  auto: boolean;
  assetId: string | null;
  manualId: string | null;
};

export type ShotReferencesView = {
  /** Las que se adjuntan, en orden. */
  active: ReferenceView[];
  /** Automáticas que se quitaron del plano (se pueden devolver). */
  removed: ReferenceView[];
  /** Firma actual, para avisar si el prompt se escribió con otras referencias. */
  key: string;
};

export type LibraryImageView = { id: string; title: string; kind: AssetKind; kindLabel: string; thumbUrl: string };
export type FrameOptionView = { id: string; shotId: string; shotNumber: number; thumbUrl: string };

type ShotLite = { id: string; excluded_image_reference_ids: string[]; excluded_video_reference_ids: string[] };

/**
 * Referencias efectivas por plano (automáticas sin las quitadas + manuales), con URLs firmadas.
 * autoByShot: las automáticas de cada plano, calculadas por la página con autoReferences().
 */
export async function shotReferenceViews(
  db: Db,
  target: ReferenceTarget,
  shots: ShotLite[],
  autoByShot: Map<string, ReferenceAsset[]>,
): Promise<Map<string, ShotReferencesView>> {
  const manual = await loadManualReferences(db, shots.map((s) => s.id));
  const resolved = shots.map((shot) => {
    const auto = autoByShot.get(shot.id) ?? [];
    const excluded = excludedFor(shot, target);
    const active = applyReferenceOverrides(target, auto, excluded, manual[target].get(shot.id) ?? []);
    return { shotId: shot.id, active, removed: auto.filter((r) => excluded.includes(r.assetId ?? "")) };
  });

  const all = resolved.flatMap((r) => [...r.active, ...r.removed]);
  const signed = await signByBucket(db, all);
  const view = (ref: ReferenceAsset): ReferenceView[] => {
    const img = signed[ref.bucket].get(ref.storagePath);
    if (!img) return [];
    return [{ key: ref.key, label: ref.label, thumbUrl: img.thumbUrl, url: img.url, kind: ref.kind, auto: ref.auto, assetId: ref.assetId, manualId: ref.manualId }];
  };
  return new Map(
    resolved.map((r) => [r.shotId, { active: r.active.flatMap(view), removed: r.removed.flatMap(view), key: referencesKey(r.active) }]),
  );
}

async function signByBucket(db: Db, refs: ReferenceAsset[]) {
  const paths = (bucket: Bucket) => refs.filter((r) => r.bucket === bucket).map((r) => r.storagePath);
  const [library, projects] = await Promise.all([signImages(db, "library", paths("library")), signImages(db, "projects", paths("projects"))]);
  return { library, projects };
}

/** Lo que se puede sumar a mano: imágenes de la biblioteca del cliente y frames aprobados del proyecto. */
export async function referencePickerOptions(
  db: Db,
  clientId: string,
  shots: { id: string; number: number }[],
): Promise<{ libraryImages: LibraryImageView[]; frameOptions: FrameOptionView[] }> {
  const shotIds = shots.map((s) => s.id);
  const [assets, frames] = await Promise.all([
    db
      .from("library_assets")
      .select("id, title, kind, storage_path")
      .eq("client_id", clientId)
      .in("kind", ["character_sheet", "location_plate", "ppe_sheet", "logo", "reference_other"])
      .not("storage_path", "is", null)
      .is("deleted_at", null)
      .order("kind")
      .order("title"),
    shotIds.length
      ? db.from("frames").select("id, shot_id, storage_path").in("shot_id", shotIds).eq("selected", true).is("deleted_at", null)
      : Promise.resolve({ data: [] as { id: string; shot_id: string; storage_path: string }[] }),
  ]);
  const [signedAssets, signedFrames] = await Promise.all([
    signImages(db, "library", (assets.data ?? []).map((a) => a.storage_path!)),
    signImages(db, "projects", (frames.data ?? []).map((f) => f.storage_path)),
  ]);
  const numberById = new Map(shots.map((s) => [s.id, s.number]));

  return {
    libraryImages: (assets.data ?? []).flatMap((a) => {
      const img = signedAssets.get(a.storage_path!);
      return img ? [{ id: a.id, title: a.title, kind: a.kind, kindLabel: kindLabel(a.kind), thumbUrl: img.thumbUrl }] : [];
    }),
    frameOptions: (frames.data ?? [])
      .flatMap((f) => {
        const img = signedFrames.get(f.storage_path);
        return img ? [{ id: f.id, shotId: f.shot_id, shotNumber: numberById.get(f.shot_id) ?? 0, thumbUrl: img.thumbUrl }] : [];
      })
      .sort((a, b) => a.shotNumber - b.shotNumber),
  };
}
