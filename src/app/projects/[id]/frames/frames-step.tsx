"use client";

import { useOptimistic, useState } from "react";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ExternalLinkIcon,
  ImageIcon,
  ImagesIcon,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import type { EngineInfo } from "@/lib/engines/registry";
import type { JobProgress } from "@/lib/jobs/types";
import { MAX_IMAGE_REFERENCES } from "@/lib/pipeline/reference-limits";
import { FRAMING_LABEL, type Framing } from "@/lib/pipeline/shotlist";
import type { ProjectJob } from "@/lib/projects/data";
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
  PanelSection,
  ReferencesEditor,
  ReviewDialog,
  reviewStatus,
  SceneHeading,
  StatusFilter,
  StatusPill,
  UseAsReferenceButton,
  useReviewKeys,
  type Density,
  type ReviewStatus,
  type StatusFilterValue,
} from "../_review/review-ui";
import { isActive, useProjectJobs } from "../jobs-provider";
import {
  generateFrames,
  generatePrompts,
  rejectFrame,
  rejectUnapprovedFrames,
  selectFrame,
  setReviewNotes,
  unselectFrame,
  updateShotPrompt,
} from "./actions";

export type FrameView = {
  id: string;
  variantIndex: number;
  url: string;
  thumbUrl: string;
  engine: string;
  model: string;
  selected: boolean;
  rejected: boolean;
  reviewNotes: string | null;
  promptChanged: boolean;
  createdAt: string;
  costUsd: number;
};

export type ShotFramesView = {
  id: string;
  number: number;
  sceneNumber: number;
  sceneTitle: string | null;
  framing: Framing;
  status: "draft" | "approved" | "frame_selected";
  action: string | null;
  voLine: string | null;
  characters: string[];
  missingConsent: string[];
  location: string | null;
  imagePrompt: string | null;
  imageNegative: string | null;
  promptStale: boolean;
  /** Cambiaron las referencias después de escribir el prompt. */
  referencesChanged: boolean;
  references: ShotReferencesView;
  /** De la más nueva a la más vieja. */
  frames: FrameView[];
};

type ShotState = {
  status: ReviewStatus;
  promptJob?: ProjectJob;
  framesJob?: ProjectJob;
  lastError: string | null;
  blocked: string | null;
};

function includesShot(job: ProjectJob, shotId: string) {
  return ((job.payload as { shotIds?: string[] }).shotIds ?? []).includes(shotId);
}

function activeJobFor(jobs: ProjectJob[], type: ProjectJob["type"], shotId: string) {
  return jobs.find((j) => j.type === type && isActive(j) && includesShot(j, shotId));
}

/** El motivo del último fallo del plano, si su trabajo más reciente (prompts o frames) terminó con error. */
function lastErrorFor(jobs: ProjectJob[], shotId: string): string | null {
  const latest = jobs.find((j) => (j.type === "generate_frames" || j.type === "generate_prompts") && includesShot(j, shotId));
  return latest?.status === "error" ? latest.error : null;
}

function blockedReason(shot: ShotFramesView): string | null {
  if (shot.status === "draft") return "Plano sin aprobar: aprobá el shot list.";
  if (shot.missingConsent.length) return `Falta consentimiento de ${shot.missingConsent.join(", ")}.`;
  return null;
}

/** La variante que representa al plano: la aprobada, si no la más nueva sin rechazar. */
function featuredFrame(shot: ShotFramesView): FrameView | null {
  return shot.frames.find((f) => f.selected) ?? shot.frames.find((f) => !f.rejected) ?? null;
}

function shotWarnings(shot: ShotFramesView, state: ShotState): string[] {
  return [
    state.blocked,
    shot.promptStale && "El plano cambió después de generar el prompt.",
    shot.referencesChanged && "Cambiaron las referencias después de escribir el prompt.",
    !state.framesJob && state.lastError && `Último intento falló: ${state.lastError}`,
  ].filter((w): w is string => Boolean(w));
}

export function FramesStep({
  projectId,
  aspectRatio,
  shots,
  engines,
  engine: projectEngine,
  imageSummary,
  libraryImages,
  frameOptions,
}: {
  projectId: string;
  aspectRatio: string;
  shots: ShotFramesView[];
  engines: EngineInfo[];
  /** Motor de imagen del proyecto: elegirlo acá lo guarda en el proyecto. */
  engine: string;
  /** Modelo, resolución y formato con que se generan los frames (se cambian en Motores). */
  imageSummary: string;
  libraryImages: LibraryImageView[];
  frameOptions: FrameOptionView[];
}) {
  const { jobs, refresh } = useProjectJobs();
  const { pending, run } = useAction();
  const [engine, setOptimisticEngine] = useOptimistic(projectEngine);
  const setEngine = (name: string) =>
    run(async () => {
      setOptimisticEngine(name);
      return setProjectEngines({ projectId, imageEngine: name });
    });
  const [n, setN] = useState(4);
  const [filter, setFilter] = useState<StatusFilterValue>("all");
  const [density, setDensity] = useState<Density>("m");
  const [open, setOpen] = useState<{ shotId: string; frameId: string | null; nav: string[] } | null>(null);

  const states = new Map<string, ShotState>(
    shots.map((s) => {
      const lastError = lastErrorFor(jobs, s.id);
      return [
        s.id,
        {
          status: reviewStatus(s.frames, Boolean(lastError)),
          promptJob: activeJobFor(jobs, "generate_prompts", s.id),
          framesJob: activeJobFor(jobs, "generate_frames", s.id),
          lastError,
          blocked: blockedReason(s),
        },
      ];
    }),
  );
  const counts = { all: shots.length, review: 0, regenerate: 0, approved: 0, pending: 0 };
  for (const s of states.values()) counts[s.status]++;
  const visible = filter === "all" ? shots : shots.filter((s) => states.get(s.id)!.status === filter);

  const approved = shots.filter((s) => s.status !== "draft");
  const needPrompts = approved.filter((s) => !s.imagePrompt || s.promptStale);
  const needFrames = approved.filter((s) => s.status !== "frame_selected" && s.missingConsent.length === 0);
  const batches = jobs.filter((j) => isActive(j) && (j.type === "generate_frames" || j.type === "generate_prompts") && !j.shot_id);
  const engineInfo = engines.find((e) => e.name === engine);
  const aspectClass = ASPECT_CLASS[aspectRatio] ?? "aspect-video";

  const openShot = (shotId: string, frameId: string | null = null) => setOpen({ shotId, frameId, nav: visible.map((s) => s.id) });
  const current = open ? shots.find((s) => s.id === open.shotId) : undefined;

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] flex-col">
      <div className="sticky top-11 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-6 py-2">
          <Select value={engine} onValueChange={setEngine}>
            <SelectTrigger size="sm" className="w-56">
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
              <span className="text-xs whitespace-nowrap text-muted-foreground">{imageSummary}</span>
            </TooltipTrigger>
            <TooltipContent>Modelo, resolución y formato: se cambian en Motores, arriba a la derecha.</TooltipContent>
          </Tooltip>
          <VariantsSelect value={n} onChange={setN} />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || needPrompts.length === 0}
            onClick={() =>
              run(() => generatePrompts({ projectId, shotIds: needPrompts.map((s) => s.id), engine }), {
                success: "Prompts en cola",
                onSuccess: refresh,
              })
            }
          >
            <WandSparklesIcon />
            Prompts faltantes · {needPrompts.length}
          </Button>
          <ConfirmButton
            title={`¿Generar ${n} variantes para ${needFrames.length} planos?`}
            description={`Se usan ${engineInfo?.label ?? engine}. Los planos sin prompt lo generan primero. Queda en cola y podés seguir trabajando.`}
            confirmLabel="Generar lote"
            onConfirm={() =>
              run(() => generateFrames({ projectId, shotIds: needFrames.map((s) => s.id), engine, n }), {
                success: "Lote en cola",
                onSuccess: refresh,
              })
            }
          >
            <Button size="sm" disabled={pending || needFrames.length === 0 || !engineInfo?.configured}>
              <ImagesIcon />
              Lote: planos sin frame aprobado · {needFrames.length}
            </Button>
          </ConfirmButton>
          {batches.map((b) => {
            const p = b.progress as JobProgress | null;
            return (
              <span key={b.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                {b.type === "generate_prompts" ? "Prompts" : "Frames"} {p ? `${p.done}/${p.total}` : "en cola"}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-6 pb-2">
          <StatusFilter value={filter} onChange={setFilter} counts={counts} />
          <span className={cn("text-xs text-muted-foreground", counts.approved === shots.length && shots.length > 0 && "text-emerald-500")}>
            {counts.approved}/{shots.length} con frame aprobado
          </span>
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
                  <FrameCard
                    key={shot.id}
                    shot={shot}
                    state={states.get(shot.id)!}
                    aspectClass={aspectClass}
                    large={density === "l"}
                    onOpen={(frameId) => openShot(shot.id, frameId)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {open && current && (
        <FrameReview
          projectId={projectId}
          shot={current}
          state={states.get(current.id)!}
          frameId={open.frameId}
          onFrameChange={(frameId) => setOpen({ ...open, frameId })}
          nav={open.nav}
          onNavigate={(shotId) => setOpen({ ...open, shotId, frameId: null })}
          onClose={() => setOpen(null)}
          engine={engine}
          engineReady={Boolean(engineInfo?.configured)}
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

function VariantsSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[1, 2, 3, 4].map((v) => (
          <SelectItem key={v} value={String(v)}>
            {v} variante{v > 1 ? "s" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de la grilla
// ---------------------------------------------------------------------------

function FrameCard({
  shot,
  state,
  aspectClass,
  large,
  onOpen,
}: {
  shot: ShotFramesView;
  state: ShotState;
  aspectClass: string;
  large: boolean;
  onOpen: (frameId: string | null) => void;
}) {
  const { pending, run } = useAction();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const live = shot.frames.filter((f) => !f.rejected || f.selected);
  const featured = featuredFrame(shot);
  const shown = live.find((f) => f.id === hoverId) ?? featured;
  const warnings = shotWarnings(shot, state);
  const progress = state.framesJob?.progress as JobProgress | null | undefined;

  return (
    <article className="group/card min-w-0">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl bg-muted ring-1 ring-border transition",
          aspectClass,
          state.status === "approved" && "ring-2 ring-emerald-500/70",
        )}
      >
        <button type="button" className="absolute inset-0 block size-full" onClick={() => onOpen(shown?.id ?? null)} aria-label={`Abrir plano ${shot.number}`}>
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
            <img src={large ? shown.url : shown.thumbUrl} alt={`Plano ${shot.number}, variante ${shown.variantIndex}`} loading="lazy" className="size-full object-cover" />
          ) : (
            <span className="flex size-full flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ImageIcon className="size-6" />
              {shot.frames.length ? "Todas las variantes rechazadas" : "Sin frames todavía"}
            </span>
          )}
        </button>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-1.5 bg-gradient-to-b from-black/60 to-transparent p-2">
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">#{shot.number}</span>
          <StatusPill status={state.status} />
          {shown?.promptChanged && <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-amber-300">Prompt anterior</span>}
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

        {state.framesJob && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
              <Loader2Icon className="size-3.5 animate-spin" />
              {state.framesJob.status === "queued" ? "En cola" : (progress?.message ?? "Generando")}
            </span>
          </div>
        )}

        {shown && !state.framesJob && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition group-hover/card:opacity-100 focus-within:opacity-100">
            <span className="text-[11px] text-white/80 tabular-nums">v{shown.variantIndex}</span>
            <span className="flex-1" />
            {shown.selected ? (
              <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => unselectFrame(shown.id), { success: "Aprobación quitada" })}>
                <UndoIcon />
                Quitar aprobación
              </Button>
            ) : (
              <>
                <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => rejectFrame(shown.id, true))} aria-label="Rechazar">
                  <XIcon />
                </Button>
                <Button
                  size="xs"
                  className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                  disabled={pending}
                  onClick={() => run(() => selectFrame(shown.id), { success: `Plano ${shot.number} aprobado` })}
                >
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
          {FRAMING_LABEL[shot.framing]} · {shot.characters.length ? shot.characters.join(", ") : "sin personajes"}
          {shot.location ? ` · ${shot.location}` : ""}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground/70 tabular-nums">
          {live.length} var.{shot.frames.length > live.length ? ` · ${shot.frames.length - live.length} rech.` : ""}
        </span>
      </div>
      {shot.action && <p className="line-clamp-1 px-0.5 text-xs text-foreground/80">{shot.action}</p>}
      {live.length > 1 && (
        <div className="mt-1.5 flex gap-1 overflow-hidden" onMouseLeave={() => setHoverId(null)}>
          {live.slice(0, 8).map((f) => (
            <button
              key={f.id}
              type="button"
              onMouseEnter={() => setHoverId(f.id)}
              onFocus={() => setHoverId(f.id)}
              onClick={() => onOpen(f.id)}
              className={cn(
                "h-9 shrink-0 overflow-hidden rounded ring-1 ring-border",
                aspectClass,
                f.id === shown?.id && "ring-2 ring-foreground",
                f.selected && "ring-2 ring-emerald-500",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
              <img src={f.thumbUrl} alt={`Variante ${f.variantIndex}`} loading="lazy" className="size-full object-cover" />
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

function FrameReview({
  projectId,
  shot,
  state,
  frameId,
  onFrameChange,
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
  shot: ShotFramesView;
  state: ShotState;
  frameId: string | null;
  onFrameChange: (frameId: string) => void;
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
  const frame = shot.frames.find((f) => f.id === frameId) ?? featuredFrame(shot) ?? shot.frames[0] ?? null;
  // La tira va en orden de generación (v1, v2…), con las rechazadas atenuadas.
  const ordered = [...shot.frames].reverse();
  const index = frame ? ordered.findIndex((f) => f.id === frame.id) : -1;
  const navIndex = nav.indexOf(shot.id);
  const prevShot = navIndex > 0 ? () => onNavigate(nav[navIndex - 1]) : undefined;
  const nextShot = navIndex >= 0 && navIndex < nav.length - 1 ? () => onNavigate(nav[navIndex + 1]) : undefined;
  const generate = () => run(() => generateFrames({ projectId, shotIds: [shot.id], engine, n }), { success: "Frames en cola", onSuccess: onQueued });

  useReviewKeys(
    {
      prevVariant: index > 0 ? () => onFrameChange(ordered[index - 1].id) : undefined,
      nextVariant: index >= 0 && index < ordered.length - 1 ? () => onFrameChange(ordered[index + 1].id) : undefined,
      prevShot,
      nextShot,
      approve: frame && !frame.selected && !pending ? () => run(() => selectFrame(frame.id), { success: `Plano ${shot.number} aprobado` }) : undefined,
      reject: frame && !frame.selected && !pending ? () => run(() => rejectFrame(frame.id, !frame.rejected)) : undefined,
    },
    true,
  );

  const viewer = (
    <>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
          <img
            src={frame.url}
            alt={`Plano ${shot.number}, variante ${frame.variantIndex}`}
            className={cn("max-h-full max-w-full rounded-md object-contain", frame.rejected && "opacity-50")}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-sm text-zinc-400">
            <ImageIcon className="size-8" />
            Sin frames todavía. Generá variantes desde el panel de la derecha.
          </div>
        )}
        {frame && (
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-white tabular-nums">
              v{frame.variantIndex} · {frame.engine} · {frame.model}
            </span>
            {frame.selected && (
              <span className="flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 font-medium text-white">
                <CheckIcon className="size-3" />
                Aprobado
              </span>
            )}
            {frame.rejected && <span className="rounded bg-red-600/90 px-1.5 py-0.5 text-white">Rechazado</span>}
            {frame.promptChanged && <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-white">Generado con un prompt anterior</span>}
          </div>
        )}
        {state.framesJob && (
          <span className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
            <Loader2Icon className="size-3.5 animate-spin" />
            {state.framesJob.status === "queued" ? "En cola" : ((state.framesJob.progress as JobProgress | null)?.message ?? "Generando")}
          </span>
        )}
      </div>

      {frame && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-3 py-2">
          {frame.selected ? (
            <Button size="sm" variant="outline" className="border-emerald-500/50 bg-transparent text-emerald-400 hover:bg-emerald-500/10" disabled={pending} onClick={() => run(() => unselectFrame(frame.id), { success: "Aprobación quitada" })}>
              <UndoIcon />
              Quitar aprobación
            </Button>
          ) : (
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-600/90" disabled={pending} onClick={() => run(() => selectFrame(frame.id), { success: `Plano ${shot.number} aprobado: es el primer frame del video` })}>
              <CheckIcon />
              Aprobar
            </Button>
          )}
          {!frame.selected && (
            <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" disabled={pending} onClick={() => run(() => rejectFrame(frame.id, !frame.rejected))}>
              {frame.rejected ? <UndoIcon /> : <XIcon />}
              {frame.rejected ? "Quitar rechazo" : "Rechazar"}
            </Button>
          )}
          <NotePopover key={frame.id} frame={frame} />
          <UseAsReferenceButton shotId={shot.id} frameId={frame.id} className="text-zinc-200 hover:bg-white/10 hover:text-white" />
          <Button size="sm" variant="ghost" className="text-zinc-200 hover:bg-white/10 hover:text-white" asChild>
            <a href={frame.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              Original
            </a>
          </Button>
          <span className="ml-auto text-xs text-zinc-400 tabular-nums">
            {index + 1} de {ordered.length}
          </span>
        </div>
      )}
      {frame?.reviewNotes && (
        <p className="flex items-start gap-1.5 border-t border-white/10 px-3 py-1.5 text-xs text-zinc-300">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0" />
          {frame.reviewNotes}
        </p>
      )}
      <Filmstrip
        items={ordered}
        activeId={frame?.id ?? null}
        onSelect={onFrameChange}
        aspectClass={aspectClass}
        render={(f) => (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
            <img src={f.thumbUrl} alt={`Variante ${f.variantIndex}`} loading="lazy" className="size-full object-cover" />
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">v{f.variantIndex}</span>
            {f.selected && (
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
      description={`${FRAMING_LABEL[shot.framing]} · ${shot.characters.length ? shot.characters.join(", ") : "sin personajes"} · ${shot.location ?? "sin locación"}`}
      status={state.status}
      position={navIndex >= 0 ? `${navIndex + 1} de ${nav.length}` : ""}
      onPrevShot={prevShot}
      onNextShot={nextShot}
      viewer={viewer}
      panel={
        <FramePanel
          key={shot.id}
          shot={shot}
          state={state}
          frame={frame}
          engine={engine}
          engineReady={engineReady}
          n={n}
          onNChange={onNChange}
          onGenerate={generate}
          onPrompts={() => run(() => generatePrompts({ projectId, shotIds: [shot.id], engine }), { success: "Prompt en cola", onSuccess: onQueued })}
          pending={pending}
          libraryImages={libraryImages}
          frameOptions={frameOptions}
        />
      }
    />
  );
}

function FramePanel({
  shot,
  state,
  frame,
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
  shot: ShotFramesView;
  state: ShotState;
  frame: FrameView | null;
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
  const { pending: rejecting, run } = useAction();
  const [prompt, setPrompt] = useState(shot.imagePrompt ?? "");
  const [negative, setNegative] = useState(shot.imageNegative ?? "");
  const [synced, setSynced] = useState({ p: shot.imagePrompt, n: shot.imageNegative });
  if (synced.p !== shot.imagePrompt || synced.n !== shot.imageNegative) {
    setSynced({ p: shot.imagePrompt, n: shot.imageNegative });
    setPrompt(shot.imagePrompt ?? "");
    setNegative(shot.imageNegative ?? "");
  }

  const commit = (field: "image_prompt" | "image_negative", value: string, original: string | null) => {
    if (value.trim() !== (original ?? "").trim()) run(() => updateShotPrompt(shot.id, { [field]: value.trim() || null }), { success: "Prompt guardado" });
  };
  const unreviewed = shot.frames.filter((f) => !f.selected && !f.rejected).length;
  const cantGenerate = state.blocked ?? (!engineReady ? "El motor de imagen no está configurado." : null);

  return (
    <div>
      <PanelSection title="Plano">
        {shot.action && <p className="text-sm">{shot.action}</p>}
        {shot.voLine && <p className="text-xs text-muted-foreground italic">“{shot.voLine}”</p>}
        {shotWarnings(shot, state).map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {w}
          </p>
        ))}
      </PanelSection>

      <PanelSection title="Generar">
        <div className="flex flex-wrap items-center gap-2">
          <VariantsSelect value={n} onChange={onNChange} />
          <Button size="sm" disabled={pending || Boolean(state.framesJob) || Boolean(cantGenerate)} onClick={onGenerate}>
            {state.framesJob ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generar {n} variante{n > 1 ? "s" : ""}
          </Button>
          <Button size="sm" variant="outline" disabled={pending || Boolean(state.promptJob) || shot.status === "draft"} onClick={onPrompts}>
            {state.promptJob ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
            {shot.imagePrompt ? "Reescribir prompt" : "Escribir prompt"}
          </Button>
        </div>
        {unreviewed > 0 && (
          <ConfirmButton
            title={`¿Rechazar ${unreviewed} variante${unreviewed > 1 ? "s" : ""} sin revisar?`}
            description="El plano queda marcado como “A regenerar”. Se pueden recuperar desde la tira de variantes."
            confirmLabel="Rechazar"
            onConfirm={() => run(() => rejectUnapprovedFrames(shot.id), { success: "Variantes rechazadas" })}
          >
            <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={rejecting}>
              <BanIcon />
              Rechazar las {unreviewed} sin revisar
            </Button>
          </ConfirmButton>
        )}
      </PanelSection>

      <PanelSection title="Editar con IA">
        <AiPromptEditor
          shotId={shot.id}
          target="image"
          engine={engine}
          draft={() => ({ prompt, negative: negative || null })}
          frameId={frame?.id ?? null}
          disabled={shot.imagePrompt ? null : "Primero escribí el prompt."}
          onApplyAndGenerate={cantGenerate ? undefined : onGenerate}
          generateLabel={`generar ${n}`}
        />
      </PanelSection>

      <PanelSection title="Prompt de imagen">
        {!shot.imagePrompt && !prompt ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Sin prompt todavía.</p>
        ) : (
          <div className="space-y-1.5">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={() => commit("image_prompt", prompt, shot.imagePrompt)}
              className="max-h-96 min-h-40 resize-y font-mono text-[11px] leading-snug md:text-[11px]"
            />
            <div className="text-[11px] text-muted-foreground">Negativo</div>
            <Textarea
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              onBlur={() => commit("image_negative", negative, shot.imageNegative)}
              className="max-h-40 min-h-14 resize-y font-mono text-[11px] leading-snug md:text-[11px]"
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title="Referencias" className="border-b-0">
        <ReferencesEditor
          shotId={shot.id}
          target="image"
          references={shot.references}
          libraryImages={libraryImages}
          frameOptions={frameOptions}
          max={MAX_IMAGE_REFERENCES}
          extraFrames={shot.frames.filter((f) => !f.rejected).map((f) => ({ id: f.id, label: `v${f.variantIndex}`, thumbUrl: f.thumbUrl }))}
        />
      </PanelSection>
    </div>
  );
}

function NotePopover({ frame }: { frame: FrameView }) {
  const { pending, run } = useAction();
  const [notes, setNotes] = useState(frame.reviewNotes ?? "");
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
        <Textarea rows={3} value={notes} placeholder="Ej.: HSE: falta el detector de gases en el pecho" onChange={(e) => setNotes(e.target.value)} className="text-xs" />
        <Button size="xs" disabled={pending} onClick={() => run(() => setReviewNotes(frame.id, notes), { success: "Nota guardada" })}>
          Guardar nota
        </Button>
      </PopoverContent>
    </Popover>
  );
}
