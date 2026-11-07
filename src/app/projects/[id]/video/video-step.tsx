"use client";

import { useOptimistic, useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ClapperboardIcon,
  ExternalLinkIcon,
  FilmIcon,
  ImageOffIcon,
  Loader2Icon,
  MessageSquareIcon,
  RotateCcwIcon,
  SparklesIcon,
  UndoIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import type { EngineInfo } from "@/lib/engines/registry";
import type { JobProgress } from "@/lib/jobs/types";
import { MAX_VIDEO_REFERENCES } from "@/lib/pipeline/reference-limits";
import type { ProjectJob } from "@/lib/projects/data";
import { formatUsd } from "@/lib/projects/data";
import type { FrameOptionView, LibraryImageView, ShotReferencesView } from "@/lib/projects/review";
import { cn } from "@/lib/utils";
import { setProjectEngines } from "../../actions";
import {
  AiPromptEditor,
  ASPECT_CLASS,
  DensityToggle,
  Filmstrip,
  GRID_CLASS,
  groupByScene,
  HoverVideo,
  PanelSection,
  ReferencesEditor,
  ReviewDialog,
  reviewStatus,
  SceneHeading,
  StatusFilter,
  StatusPill,
  useReviewKeys,
  type Density,
  type ReviewStatus,
  type StatusFilterValue,
} from "../_review/review-ui";
import { isActive, useProjectJobs } from "../jobs-provider";
import {
  generateClips,
  generateVideoPrompts,
  rejectClip,
  rejectUnapprovedClips,
  selectClip,
  setClipNotes,
  unselectClip,
  updateShotVideo,
} from "./actions";

export type ClipView = {
  id: string;
  variantIndex: number;
  url: string;
  posterUrl: string | null;
  engine: string;
  model: string;
  durationSec: number | null;
  resolution: string | null;
  selected: boolean;
  rejected: boolean;
  reviewNotes: string | null;
  /** Salió de un frame que ya no es el aprobado. */
  fromOtherFrame: boolean;
  promptChanged: boolean;
  costUsd: number;
};

export type ShotVideoView = {
  id: string;
  number: number;
  sceneNumber: number;
  sceneTitle: string | null;
  action: string | null;
  voLine: string | null;
  estDurationSec: number;
  characters: string[];
  missingConsent: string[];
  realPeople: string[];
  location: string | null;
  frame: { id: string; url: string; thumbUrl: string } | null;
  videoPrompt: string | null;
  videoNegative: string | null;
  videoDurationSec: number | null;
  videoQaNotes: string | null;
  promptStale: boolean;
  /** Cambiaron las referencias después de escribir el prompt. */
  referencesChanged: boolean;
  references: ShotReferencesView;
  /** Del más nuevo al más viejo. */
  clips: ClipView[];
};

type ShotState = {
  status: ReviewStatus;
  promptJob?: ProjectJob;
  clipsJob?: ProjectJob;
  lastError: string | null;
  blocked: string | null;
};

// Tarifa publicada de Gemini Omni a 720p (~5.792 tokens de video por segundo a US$ 17,50 por millón): solo para el aviso.
const USD_PER_SEC: Record<string, number> = { gemini: 0.1 };

function includesShot(job: ProjectJob, shotId: string) {
  return ((job.payload as { shotIds?: string[] }).shotIds ?? []).includes(shotId);
}

function activeJobFor(jobs: ProjectJob[], type: ProjectJob["type"], shotId: string) {
  return jobs.find((j) => j.type === type && isActive(j) && includesShot(j, shotId));
}

function lastErrorFor(jobs: ProjectJob[], shotId: string): string | null {
  const latest = jobs.find((j) => (j.type === "generate_clips" || j.type === "generate_video_prompts") && includesShot(j, shotId));
  return latest?.status === "error" ? latest.error : null;
}

function secondsFor(shot: ShotVideoView) {
  return shot.videoDurationSec ?? Math.max(4, Math.ceil(shot.estDurationSec) + 1);
}

function blockedReason(shot: ShotVideoView): string | null {
  if (!shot.frame) return "Sin frame aprobado: aprobá una imagen en Frames.";
  if (shot.missingConsent.length) return `Falta consentimiento de ${shot.missingConsent.join(", ")}.`;
  return null;
}

/** El clip que representa al plano: el aprobado, si no el más nuevo sin rechazar. */
function featuredClip(shot: ShotVideoView): ClipView | null {
  return shot.clips.find((c) => c.selected) ?? shot.clips.find((c) => !c.rejected) ?? null;
}

function shotWarnings(shot: ShotVideoView, state: ShotState, engine: string): string[] {
  return [
    state.blocked,
    shot.promptStale && "El prompt se escribió para otro frame (se reescribe solo al generar el clip).",
    shot.referencesChanged && "Cambiaron las referencias después de escribir el prompt.",
    shot.realPeople.length > 0 &&
      engine === "gemini" &&
      `${shot.realPeople.join(", ")} ${shot.realPeople.length > 1 ? "están basados" : "está basado/a"} en una persona real: Gemini Omni puede bloquear el clip.`,
    !state.clipsJob && state.lastError && `Último intento falló: ${state.lastError}`,
  ].filter((w): w is string => Boolean(w));
}

export function VideoStep({
  projectId,
  aspectRatio,
  shots,
  engines,
  engine: projectEngine,
  videoSummary,
  systemPrompt,
  libraryImages,
  frameOptions,
}: {
  projectId: string;
  aspectRatio: string;
  shots: ShotVideoView[];
  engines: EngineInfo[];
  engine: string;
  videoSummary: string;
  /** Título y versión del system prompt de video activo del cliente. */
  systemPrompt: string | null;
  libraryImages: LibraryImageView[];
  frameOptions: FrameOptionView[];
}) {
  const { jobs, refresh } = useProjectJobs();
  const { pending, run } = useAction();
  const [engine, setOptimisticEngine] = useOptimistic(projectEngine);
  const setEngine = (name: string) =>
    run(async () => {
      setOptimisticEngine(name);
      return setProjectEngines({ projectId, videoEngine: name });
    });
  const [n, setN] = useState(1);
  const [filter, setFilter] = useState<StatusFilterValue>("all");
  const [density, setDensity] = useState<Density>("m");
  const [open, setOpen] = useState<{ shotId: string; clipId: string | null; nav: string[] } | null>(null);

  const states = new Map<string, ShotState>(
    shots.map((s) => {
      const lastError = lastErrorFor(jobs, s.id);
      return [
        s.id,
        {
          status: reviewStatus(s.clips, Boolean(lastError)),
          promptJob: activeJobFor(jobs, "generate_video_prompts", s.id),
          clipsJob: activeJobFor(jobs, "generate_clips", s.id),
          lastError,
          blocked: blockedReason(s),
        },
      ];
    }),
  );
  const counts = { all: shots.length, review: 0, regenerate: 0, approved: 0, pending: 0 };
  for (const s of states.values()) counts[s.status]++;
  const visible = filter === "all" ? shots : shots.filter((s) => states.get(s.id)!.status === filter);

  const withFrame = shots.filter((s) => s.frame);
  const needPrompts = withFrame.filter((s) => !s.videoPrompt || s.promptStale);
  const needClips = withFrame.filter((s) => !s.clips.some((c) => c.selected) && s.missingConsent.length === 0);
  const batches = jobs.filter((j) => isActive(j) && (j.type === "generate_clips" || j.type === "generate_video_prompts") && !j.shot_id);
  const engineInfo = engines.find((e) => e.name === engine);
  const unsupportedAspect = engine === "gemini" && !["16:9", "9:16"].includes(aspectRatio);
  const batchSeconds = needClips.reduce((sum, s) => sum + secondsFor(s), 0) * n;
  const batchCost = USD_PER_SEC[engine] ? ` Costo estimado: ${formatUsd(batchSeconds * USD_PER_SEC[engine])} (${batchSeconds} s de video).` : "";
  const aspectClass = ASPECT_CLASS[aspectRatio] ?? "aspect-video";

  const openShot = (shotId: string, clipId: string | null = null) => setOpen({ shotId, clipId, nav: visible.map((s) => s.id) });
  const current = open ? shots.find((s) => s.id === open.shotId) : undefined;

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] flex-col">
      <div className="sticky top-11 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-6 py-2">
          <Select value={engine} onValueChange={setEngine}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {engines.map((e) => (
                <SelectItem key={e.name} value={e.name} disabled={!e.configured}>
                  {e.label}
                  {!e.configured && " · sin configurar"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{videoSummary}</span>
            </TooltipTrigger>
            <TooltipContent>Modelo, resolución, formato y modo logo: se cambian en Motores, arriba a la derecha.</TooltipContent>
          </Tooltip>
          <ClipsSelect value={n} onChange={setN} />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || needPrompts.length === 0}
            onClick={() =>
              run(() => generateVideoPrompts({ projectId, shotIds: needPrompts.map((s) => s.id), engine }), {
                success: "Prompts de video en cola",
                onSuccess: refresh,
              })
            }
          >
            <WandSparklesIcon />
            Prompts faltantes · {needPrompts.length}
          </Button>
          <ConfirmButton
            title={`¿Generar ${n} clip${n > 1 ? "s" : ""} para ${needClips.length} planos?`}
            description={`Se usa ${engineInfo?.label ?? engine} desde el frame aprobado de cada plano. Los planos sin prompt de video lo generan primero.${batchCost} Queda en cola y podés seguir trabajando.`}
            confirmLabel="Generar lote"
            onConfirm={() =>
              run(() => generateClips({ projectId, shotIds: needClips.map((s) => s.id), engine, n }), {
                success: "Lote de clips en cola",
                onSuccess: refresh,
              })
            }
          >
            <Button size="sm" disabled={pending || needClips.length === 0 || !engineInfo?.configured || unsupportedAspect}>
              <ClapperboardIcon />
              Lote: planos sin clip aprobado · {needClips.length}
            </Button>
          </ConfirmButton>
          {batches.map((b) => {
            const p = b.progress as JobProgress | null;
            return (
              <span key={b.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                {b.type === "generate_video_prompts" ? "Prompts" : "Clips"} {p ? `${p.done}/${p.total}` : "en cola"}
              </span>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground">
            System prompt:{" "}
            {systemPrompt ? (
              <Link href="/settings?step=video" className="text-foreground underline-offset-2 hover:underline">
                {systemPrompt}
              </Link>
            ) : (
              <span className="text-amber-500">ninguno activo (cargalo en Settings)</span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-6 pb-2">
          <StatusFilter value={filter} onChange={setFilter} counts={counts} />
          <span className={cn("text-xs text-muted-foreground", counts.approved === shots.length && shots.length > 0 && "text-emerald-500")}>
            {counts.approved}/{shots.length} con clip aprobado · {withFrame.length}/{shots.length} con frame aprobado
          </span>
          {unsupportedAspect && (
            <span className="flex items-center gap-1 text-xs text-amber-500">
              <AlertTriangleIcon className="size-3.5" />
              Gemini Omni solo genera 16:9 o 9:16 y el proyecto está en {aspectRatio}.
            </span>
          )}
          <div className="ml-auto">
            <DensityToggle value={density} onChange={setDensity} />
          </div>
        </div>
      </div>

      {shots.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Todavía no hay shot list.</p>
      ) : visible.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No hay planos en este filtro.</p>
      ) : (
        <div className="space-y-6 px-6 py-4">
          {groupByScene(visible).map((group) => (
            <section key={`${group.sceneNumber}-${group.items[0].id}`}>
              <SceneHeading number={group.sceneNumber} title={group.sceneTitle} count={group.items.length} />
              <div className={cn("grid gap-4", GRID_CLASS[density])}>
                {group.items.map((shot) => (
                  <ClipCard
                    key={shot.id}
                    projectId={projectId}
                    shot={shot}
                    state={states.get(shot.id)!}
                    engine={engine}
                    aspectClass={aspectClass}
                    onOpen={(clipId) => openShot(shot.id, clipId)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {open && current && (
        <ClipReview
          projectId={projectId}
          shot={current}
          state={states.get(current.id)!}
          clipId={open.clipId}
          onClipChange={(clipId) => setOpen({ ...open, clipId })}
          nav={open.nav}
          onNavigate={(shotId) => setOpen({ ...open, shotId, clipId: null })}
          onClose={() => setOpen(null)}
          engine={engine}
          engineReady={Boolean(engineInfo?.configured) && !unsupportedAspect}
          n={n}
          onNChange={setN}
          aspectClass={aspectClass}
          libraryImages={libraryImages}
          frameOptions={frameOptions}
          onQueued={refresh}
        />
      )}
    </div>
  );
}

function ClipsSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[1, 2, 3, 4].map((v) => (
          <SelectItem key={v} value={String(v)}>
            {v} clip{v > 1 ? "s" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de la grilla: el clip se reproduce al pasar el mouse
// ---------------------------------------------------------------------------

function ClipCard({
  projectId,
  shot,
  state,
  engine,
  aspectClass,
  onOpen,
}: {
  projectId: string;
  shot: ShotVideoView;
  state: ShotState;
  engine: string;
  aspectClass: string;
  onOpen: (clipId: string | null) => void;
}) {
  const { pending, run } = useAction();
  const [hovering, setHovering] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const live = shot.clips.filter((c) => !c.rejected || c.selected);
  const featured = featuredClip(shot);
  const shown = live.find((c) => c.id === hoverId) ?? featured;
  const warnings = shotWarnings(shot, state, engine);
  const progress = state.clipsJob?.progress as JobProgress | null | undefined;

  return (
    <article className="group/card min-w-0">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl bg-muted ring-1 ring-border transition",
          aspectClass,
          state.status === "approved" && "ring-2 ring-emerald-500/70",
        )}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {shown ? (
          <button type="button" className="absolute inset-0 block size-full" onClick={() => onOpen(shown.id)} aria-label={`Abrir plano ${shot.number}`}>
            <HoverVideo src={shown.url} poster={shown.posterUrl} playing={hovering} />
          </button>
        ) : shot.frame ? (
          <button type="button" className="absolute inset-0 block size-full" onClick={() => onOpen(null)} aria-label={`Abrir plano ${shot.number}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
            <img src={shot.frame.thumbUrl} alt={`Frame aprobado del plano ${shot.number}`} loading="lazy" className="size-full object-cover opacity-50" />
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-medium text-white">
              <FilmIcon className="size-5" />
              {shot.clips.length ? "Todos los clips rechazados" : "Sin clips todavía"}
            </span>
          </button>
        ) : (
          <Link
            href={`/projects/${projectId}/frames`}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 border border-dashed text-xs text-muted-foreground hover:text-foreground"
          >
            <ImageOffIcon className="size-5" />
            Aprobá un frame primero
          </Link>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-1.5 bg-gradient-to-b from-black/60 to-transparent p-2">
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">#{shot.number}</span>
          <StatusPill status={state.status} />
          {shown?.fromOtherFrame && <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-amber-300">Otro frame</span>}
          {warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="pointer-events-auto ml-auto flex size-6 items-center justify-center rounded-full bg-amber-500/90 text-white">
                  <AlertTriangleIcon className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 whitespace-pre-line">{warnings.join("\n")}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {state.clipsJob && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
              <Loader2Icon className="size-3.5 animate-spin" />
              {state.clipsJob.status === "queued" ? "En cola" : (progress?.message ?? "Generando")}
            </span>
          </div>
        )}

        {shown && !state.clipsJob && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition group-hover/card:opacity-100 focus-within:opacity-100">
            <span className="text-[11px] text-white/80 tabular-nums">
              v{shown.variantIndex}
              {shown.durationSec ? ` · ${shown.durationSec} s` : ""}
            </span>
            <span className="flex-1" />
            {shown.selected ? (
              <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => unselectClip(shown.id), { success: "Aprobación quitada" })}>
                <UndoIcon />
                Quitar aprobación
              </Button>
            ) : (
              <>
                <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => rejectClip(shown.id, true))} aria-label="Rechazar">
                  <XIcon />
                </Button>
                <Button size="xs" className="bg-emerald-600 text-white hover:bg-emerald-600/90" disabled={pending} onClick={() => run(() => selectClip(shown.id), { success: `Clip del plano ${shot.number} aprobado` })}>
                  <CheckIcon />
                  Aprobar
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2 px-0.5 pt-1.5 text-xs">
        <span className="truncate text-muted-foreground">
          {shot.characters.length ? shot.characters.join(", ") : "sin personajes"}
          {shot.location ? ` · ${shot.location}` : ""} · ~{shot.estDurationSec} s de locución
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground/70 tabular-nums">
          {live.length} clip{live.length === 1 ? "" : "s"}
          {shot.clips.length > live.length ? ` · ${shot.clips.length - live.length} rech.` : ""}
        </span>
      </div>
      {shot.action && <p className="line-clamp-1 px-0.5 text-xs text-foreground/80">{shot.action}</p>}
      {live.length > 1 && (
        <div className="mt-1.5 flex gap-1 overflow-hidden" onMouseLeave={() => setHoverId(null)}>
          {live.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => {
                setHoverId(c.id);
                setHovering(true);
              }}
              onMouseLeave={() => setHovering(false)}
              onClick={() => onOpen(c.id)}
              className={cn(
                "relative h-9 shrink-0 overflow-hidden rounded bg-black ring-1 ring-border",
                aspectClass,
                c.id === shown?.id && "ring-2 ring-foreground",
                c.selected && "ring-2 ring-emerald-500",
              )}
            >
              {c.posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
                <img src={c.posterUrl} alt={`Clip ${c.variantIndex}`} loading="lazy" className="size-full object-cover opacity-80" />
              )}
              <span className="absolute bottom-0 left-0.5 text-[9px] text-white tabular-nums">v{c.variantIndex}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Detalle del plano
// ---------------------------------------------------------------------------

function ClipReview({
  projectId,
  shot,
  state,
  clipId,
  onClipChange,
  nav,
  onNavigate,
  onClose,
  engine,
  engineReady,
  n,
  onNChange,
  aspectClass,
  libraryImages,
  frameOptions,
  onQueued,
}: {
  projectId: string;
  shot: ShotVideoView;
  state: ShotState;
  clipId: string | null;
  onClipChange: (clipId: string) => void;
  nav: string[];
  onNavigate: (shotId: string) => void;
  onClose: () => void;
  engine: string;
  engineReady: boolean;
  n: number;
  onNChange: (n: number) => void;
  aspectClass: string;
  libraryImages: LibraryImageView[];
  frameOptions: FrameOptionView[];
  onQueued: () => void;
}) {
  const { pending, run } = useAction();
  const clip = shot.clips.find((c) => c.id === clipId) ?? featuredClip(shot) ?? shot.clips[0] ?? null;
  const ordered = [...shot.clips].reverse();
  const index = clip ? ordered.findIndex((c) => c.id === clip.id) : -1;
  const navIndex = nav.indexOf(shot.id);
  const prevShot = navIndex > 0 ? () => onNavigate(nav[navIndex - 1]) : undefined;
  const nextShot = navIndex >= 0 && navIndex < nav.length - 1 ? () => onNavigate(nav[navIndex + 1]) : undefined;
  const generate = () => run(() => generateClips({ projectId, shotIds: [shot.id], engine, n }), { success: "Clip en cola", onSuccess: onQueued });

  useReviewKeys(
    {
      prevVariant: index > 0 ? () => onClipChange(ordered[index - 1].id) : undefined,
      nextVariant: index >= 0 && index < ordered.length - 1 ? () => onClipChange(ordered[index + 1].id) : undefined,
      prevShot,
      nextShot,
      approve: clip && !clip.selected && !pending ? () => run(() => selectClip(clip.id), { success: `Clip del plano ${shot.number} aprobado` }) : undefined,
      reject: clip && !clip.selected && !pending ? () => run(() => rejectClip(clip.id, !clip.rejected)) : undefined,
    },
    true,
  );

  const viewer = (
    <>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {clip ? (
          <video
            key={clip.id}
            src={clip.url}
            poster={clip.posterUrl ?? undefined}
            controls
            autoPlay
            loop
            playsInline
            className={cn("max-h-full max-w-full rounded-md bg-black", clip.rejected && "opacity-50")}
          />
        ) : shot.frame ? (
          <div className="relative flex max-h-full max-w-full flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
            <img src={shot.frame.url} alt={`Frame aprobado del plano ${shot.number}`} className="max-h-[70svh] max-w-full rounded-md object-contain opacity-60" />
            <span className="text-sm text-zinc-400">Sin clips todavía: este es el primer frame. Generá desde el panel de la derecha.</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-sm text-zinc-400">
            <ImageOffIcon className="size-8" />
            Sin frame aprobado.
            <Link href={`/projects/${projectId}/frames`} className="text-zinc-200 underline underline-offset-2">
              Ir a Frames
            </Link>
          </div>
        )}
        {clip && (
          <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-white tabular-nums">
              v{clip.variantIndex} · {clip.durationSec ? `${clip.durationSec} s` : "—"} · {clip.resolution ?? clip.engine} · {clip.model} · {formatUsd(clip.costUsd)}
            </span>
            {clip.selected && (
              <span className="flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 font-medium text-white">
                <CheckIcon className="size-3" />
                Aprobado
              </span>
            )}
            {clip.rejected && <span className="rounded bg-red-600/90 px-1.5 py-0.5 text-white">Rechazado</span>}
            {clip.fromOtherFrame && <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-white">Salió de otro frame</span>}
            {!clip.fromOtherFrame && clip.promptChanged && <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-white">Generado con un prompt anterior</span>}
          </div>
        )}
        {state.clipsJob && (
          <span className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
            <Loader2Icon className="size-3.5 animate-spin" />
            {state.clipsJob.status === "queued" ? "En cola" : ((state.clipsJob.progress as JobProgress | null)?.message ?? "Generando")} (cada clip tarda un par de minutos)
          </span>
        )}
      </div>

      {clip && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-3 py-2">
          {clip.selected ? (
            <Button size="sm" variant="outline" className="border-emerald-500/50 bg-transparent text-emerald-400 hover:bg-emerald-500/10" disabled={pending} onClick={() => run(() => unselectClip(clip.id), { success: "Aprobación quitada" })}>
              <UndoIcon />
              Quitar aprobación
            </Button>
          ) : (
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-600/90" disabled={pending} onClick={() => run(() => selectClip(clip.id), { success: `Clip del plano ${shot.number} aprobado` })}>
              <CheckIcon />
              Aprobar
            </Button>
          )}
          {!clip.selected && (
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" disabled={pending} onClick={() => run(() => rejectClip(clip.id, !clip.rejected))}>
              {clip.rejected ? <UndoIcon /> : <XIcon />}
              {clip.rejected ? "Quitar rechazo" : "Rechazar"}
            </Button>
          )}
          <ClipNotePopover key={clip.id} clip={clip} />
          <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" asChild>
            <a href={clip.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Original
            </a>
          </Button>
          <span className="ml-auto text-xs text-zinc-400 tabular-nums">
            {index + 1} de {ordered.length}
          </span>
        </div>
      )}
      {clip?.reviewNotes && (
        <p className="flex items-start gap-1.5 border-t border-white/10 px-3 py-1.5 text-xs text-zinc-300">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0" />
          {clip.reviewNotes}
        </p>
      )}
      <Filmstrip
        items={ordered}
        activeId={clip?.id ?? null}
        onSelect={onClipChange}
        aspectClass={aspectClass}
        render={(c) => (
          <>
            {c.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
              <img src={c.posterUrl} alt={`Clip ${c.variantIndex}`} loading="lazy" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center bg-zinc-800">
                <FilmIcon className="size-4 text-zinc-500" />
              </span>
            )}
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">
              v{c.variantIndex}
              {c.durationSec ? ` · ${c.durationSec} s` : ""}
            </span>
            {c.selected && (
              <span className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-600 text-white">
                <CheckIcon className="size-3" />
              </span>
            )}
          </>
        )}
      />
    </>
  );

  return (
    <ReviewDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Plano #${shot.number} · Escena ${shot.sceneNumber}${shot.sceneTitle ? ` · ${shot.sceneTitle}` : ""}`}
      description={`${shot.characters.length ? shot.characters.join(", ") : "sin personajes"} · ${shot.location ?? "sin locación"} · ~${shot.estDurationSec} s de locución`}
      status={state.status}
      position={navIndex >= 0 ? `${navIndex + 1} de ${nav.length}` : ""}
      onPrevShot={prevShot}
      onNextShot={nextShot}
      viewer={viewer}
      panel={
        <ClipPanel
          key={shot.id}
          projectId={projectId}
          shot={shot}
          state={state}
          engine={engine}
          engineReady={engineReady}
          n={n}
          onNChange={onNChange}
          onGenerate={generate}
          onPrompts={() => run(() => generateVideoPrompts({ projectId, shotIds: [shot.id], engine }), { success: "Prompt de video en cola", onSuccess: onQueued })}
          pending={pending}
          libraryImages={libraryImages}
          frameOptions={frameOptions}
        />
      }
    />
  );
}

function ClipPanel({
  projectId,
  shot,
  state,
  engine,
  engineReady,
  n,
  onNChange,
  onGenerate,
  onPrompts,
  pending,
  libraryImages,
  frameOptions,
}: {
  projectId: string;
  shot: ShotVideoView;
  state: ShotState;
  engine: string;
  engineReady: boolean;
  n: number;
  onNChange: (n: number) => void;
  onGenerate: () => void;
  onPrompts: () => void;
  pending: boolean;
  libraryImages: LibraryImageView[];
  frameOptions: FrameOptionView[];
}) {
  const { pending: saving, run } = useAction();
  const [prompt, setPrompt] = useState(shot.videoPrompt ?? "");
  const [negative, setNegative] = useState(shot.videoNegative ?? "");
  const [seconds, setSeconds] = useState(shot.videoDurationSec ? String(shot.videoDurationSec) : "");
  const [synced, setSynced] = useState({ p: shot.videoPrompt, n: shot.videoNegative, s: shot.videoDurationSec });
  if (synced.p !== shot.videoPrompt || synced.n !== shot.videoNegative || synced.s !== shot.videoDurationSec) {
    setSynced({ p: shot.videoPrompt, n: shot.videoNegative, s: shot.videoDurationSec });
    setPrompt(shot.videoPrompt ?? "");
    setNegative(shot.videoNegative ?? "");
    setSeconds(shot.videoDurationSec ? String(shot.videoDurationSec) : "");
  }

  const commit = (field: "video_prompt" | "video_negative", value: string, original: string | null) => {
    if (value.trim() !== (original ?? "").trim()) run(() => updateShotVideo(shot.id, { [field]: value.trim() || null }), { success: "Prompt guardado" });
  };
  const parsedSeconds = seconds.trim() ? Number(seconds.replace(",", ".")) : null;
  const commitSeconds = () => {
    if (parsedSeconds !== shot.videoDurationSec && (parsedSeconds === null || Number.isFinite(parsedSeconds))) {
      run(() => updateShotVideo(shot.id, { video_duration_sec: parsedSeconds }), { success: "Duración guardada" });
    }
  };
  const unreviewed = shot.clips.filter((c) => !c.selected && !c.rejected).length;
  const cantGenerate = state.blocked ?? (!engineReady ? "El motor de video no está configurado o no admite el formato del proyecto." : null);

  return (
    <div>
      <PanelSection title="Plano">
        {shot.action && <p className="text-sm">{shot.action}</p>}
        {shot.voLine && <p className="text-xs text-muted-foreground italic">“{shot.voLine}”</p>}
        {shotWarnings(shot, state, engine).map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {w}
          </p>
        ))}
        {shot.videoQaNotes && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs whitespace-pre-line">
            <div className="mb-0.5 font-medium text-amber-600 dark:text-amber-400">Revisión del frame y notas</div>
            {shot.videoQaNotes}
          </div>
        )}
      </PanelSection>

      <PanelSection title="Generar">
        <div className="flex flex-wrap items-center gap-2">
          <ClipsSelect value={n} onChange={onNChange} />
          <Button size="sm" disabled={pending || Boolean(state.clipsJob) || Boolean(cantGenerate)} onClick={onGenerate}>
            {state.clipsJob ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generar {n} clip{n > 1 ? "s" : ""} · {secondsFor(shot)} s
          </Button>
          <Button size="sm" variant="outline" disabled={pending || Boolean(state.promptJob) || !shot.frame} onClick={onPrompts}>
            {state.promptJob ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
            {shot.videoPrompt ? "Reescribir prompt" : "Escribir prompt"}
          </Button>
        </div>
        {unreviewed > 0 && (
          <ConfirmButton
            title={`¿Rechazar ${unreviewed} clip${unreviewed > 1 ? "s" : ""} sin revisar?`}
            description="El plano queda marcado como “A regenerar”. Se pueden recuperar desde la tira de clips."
            confirmLabel="Rechazar"
            onConfirm={() => run(() => rejectUnapprovedClips(shot.id), { success: "Clips rechazados" })}
          >
            <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={saving}>
              <BanIcon />
              Rechazar los {unreviewed} sin revisar
            </Button>
          </ConfirmButton>
        )}
      </PanelSection>

      <PanelSection title="Editar con IA">
        <AiPromptEditor
          shotId={shot.id}
          target="video"
          engine={engine}
          draft={() => ({ prompt, negative: negative || null, seconds: parsedSeconds })}
          disabled={!shot.frame ? "Sin frame aprobado." : shot.videoPrompt ? null : "Primero escribí el prompt."}
          onApplyAndGenerate={cantGenerate ? undefined : onGenerate}
          generateLabel={`generar ${n} clip${n > 1 ? "s" : ""}`}
        />
      </PanelSection>

      <PanelSection title="Prompt de video">
        {!shot.videoPrompt && !prompt ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Sin prompt de video todavía.</p>
        ) : (
          <div className="space-y-1.5">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => commit("video_prompt", prompt, shot.videoPrompt)}
              className="max-h-96 min-h-40 resize-y font-mono text-[11px] leading-snug md:text-[11px]"
            />
            <div className="text-[11px] text-muted-foreground">Avoid (se agrega al final del prompt)</div>
            <Textarea
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              onBlur={() => commit("video_negative", negative, shot.videoNegative)}
              className="max-h-40 min-h-14 resize-y font-mono text-[11px] leading-snug md:text-[11px]"
            />
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Segundos a generar
              <Input value={seconds} inputMode="decimal" onChange={(e) => setSeconds(e.target.value)} onBlur={commitSeconds} className="h-6 w-16 text-xs" />
            </label>
          </div>
        )}
      </PanelSection>

      <PanelSection
        title="Referencias"
        className="border-b-0"
        action={
          shot.frame ? (
            <Link href={`/projects/${projectId}/frames`} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
              Cambiar primer frame
            </Link>
          ) : null
        }
      >
        <ReferencesEditor
          shotId={shot.id}
          target="video"
          references={shot.references}
          libraryImages={libraryImages}
          frameOptions={frameOptions}
          max={MAX_VIDEO_REFERENCES}
          leading={shot.frame ? { label: "Imagen 1 · primer frame (el frame aprobado)", thumbUrl: shot.frame.thumbUrl, url: shot.frame.url } : undefined}
        />
      </PanelSection>
    </div>
  );
}

function ClipNotePopover({ clip }: { clip: ClipView }) {
  const { pending, run } = useAction();
  const [notes, setNotes] = useState(clip.reviewNotes ?? "");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white">
          <MessageSquareIcon />
          Nota
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 p-2">
        <div className="text-xs font-medium">Nota de revisión</div>
        <Textarea rows={3} value={notes} placeholder="Ej.: la mano izquierda se deforma en el segundo 3" onChange={(e) => setNotes(e.target.value)} className="text-xs" />
        <Button size="xs" disabled={pending} onClick={() => run(() => setClipNotes(clip.id, notes), { success: "Nota guardada" })}>
          Guardar nota
        </Button>
      </PopoverContent>
    </Popover>
  );
}
