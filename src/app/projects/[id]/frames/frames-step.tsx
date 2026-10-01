"use client";

import { useOptimistic, useState } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import type { EngineInfo } from "@/lib/engines/registry";
import type { JobProgress } from "@/lib/jobs/types";
import { FRAMING_LABEL, type Framing } from "@/lib/pipeline/shotlist";
import type { ProjectJob } from "@/lib/projects/data";
import { cn } from "@/lib/utils";
import { setProjectEngines } from "../../actions";
import { isActive, useProjectJobs } from "../jobs-provider";
import {
  generateFrames,
  generatePrompts,
  rejectFrame,
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
  videoPrompt: string | null;
  promptStale: boolean;
  references: { label: string; thumbUrl: string }[];
  frames: FrameView[];
};

const ASPECT_CLASS: Record<string, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "4:3": "aspect-[4/3]",
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

export function FramesStep({
  projectId,
  aspectRatio,
  shots,
  engines,
  engine: projectEngine,
  imageSummary,
}: {
  projectId: string;
  aspectRatio: string;
  shots: ShotFramesView[];
  engines: EngineInfo[];
  /** Motor de imagen del proyecto: elegirlo acá lo guarda en el proyecto. */
  engine: string;
  /** Modelo, resolución y formato con que se generan los frames (se cambian en Motores). */
  imageSummary: string;
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
  const [showRejected, setShowRejected] = useState(false);

  const approved = shots.filter((s) => s.status !== "draft");
  const needPrompts = approved.filter((s) => !s.imagePrompt || s.promptStale);
  const needFrames = approved.filter((s) => s.status !== "frame_selected" && s.missingConsent.length === 0);
  const selectedCount = shots.filter((s) => s.status === "frame_selected").length;
  const batches = jobs.filter((j) => isActive(j) && (j.type === "generate_frames" || j.type === "generate_prompts") && !j.shot_id);
  const engineInfo = engines.find((e) => e.name === engine);

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] flex-col">
      <div className="sticky top-11 z-20 flex flex-wrap items-center gap-2 border-b bg-background/95 px-6 py-2 backdrop-blur">
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
        <Select value={String(n)} onValueChange={(v) => setN(Number(v))}>
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
            Lote: planos sin frame elegido · {needFrames.length}
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
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <Switch size="sm" checked={showRejected} onCheckedChange={setShowRejected} />
            Mostrar rechazados
          </label>
          <span className={cn(selectedCount === shots.length && shots.length > 0 && "text-emerald-500")}>
            {selectedCount}/{shots.length} con frame elegido
          </span>
        </div>
      </div>

      {shots.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Todavía no hay shot list.</p>
      ) : (
        <div className="divide-y">
          {shots.map((shot) => (
            <ShotFrames
              key={shot.id}
              projectId={projectId}
              shot={shot}
              engine={engine}
              engineReady={Boolean(engineInfo?.configured)}
              n={n}
              aspectClass={ASPECT_CLASS[aspectRatio] ?? "aspect-video"}
              showRejected={showRejected}
              promptJob={activeJobFor(jobs, "generate_prompts", shot.id)}
              framesJob={activeJobFor(jobs, "generate_frames", shot.id)}
              lastError={lastErrorFor(jobs, shot.id)}
              onQueued={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShotFrames({
  projectId,
  shot,
  engine,
  engineReady,
  n,
  aspectClass,
  showRejected,
  promptJob,
  framesJob,
  lastError,
  onQueued,
}: {
  projectId: string;
  shot: ShotFramesView;
  engine: string;
  engineReady: boolean;
  n: number;
  aspectClass: string;
  showRejected: boolean;
  promptJob?: ProjectJob;
  framesJob?: ProjectJob;
  lastError: string | null;
  onQueued: () => void;
}) {
  const { pending, run } = useAction();
  const visible = shot.frames.filter((f) => showRejected || !f.rejected || f.selected);
  const hiddenRejected = shot.frames.length - visible.length;
  const blocked = shot.status === "draft" ? "Plano sin aprobar: aprobá el shot list." : shot.missingConsent.length ? `Falta consentimiento de ${shot.missingConsent.join(", ")}.` : null;

  return (
    <section className="grid grid-cols-[26rem_1fr] gap-4 px-6 py-4">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tabular-nums">#{shot.number}</span>
          <span className="text-muted-foreground">
            Escena {shot.sceneNumber}
            {shot.sceneTitle ? ` · ${shot.sceneTitle}` : ""}
          </span>
          {shot.status === "frame_selected" && <Badge className="bg-emerald-500/15 text-emerald-500">Frame elegido</Badge>}
          {shot.status === "draft" && <Badge variant="secondary">Sin aprobar</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {FRAMING_LABEL[shot.framing]} · {shot.characters.length ? shot.characters.join(", ") : "sin personajes"} ·{" "}
          {shot.location ?? "sin locación"}
        </div>
        {shot.action && <p className="text-xs">{shot.action}</p>}
        {shot.voLine && <p className="text-xs text-muted-foreground italic">“{shot.voLine}”</p>}

        <PromptEditor shot={shot} />

        {shot.promptStale && (
          <p className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            El plano cambió después de generar el prompt. Regeneralo para que lo refleje.
          </p>
        )}
        {blocked && (
          <p className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {blocked}
          </p>
        )}
        {lastError && !promptJob && !framesJob && (
          <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            Último intento falló: {lastError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || Boolean(promptJob) || shot.status === "draft"}
            onClick={() =>
              run(() => generatePrompts({ projectId, shotIds: [shot.id], engine }), { success: "Prompt en cola", onSuccess: onQueued })
            }
          >
            {promptJob ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
            {shot.imagePrompt ? "Regenerar prompt" : "Generar prompt"}
          </Button>
          <Button
            size="sm"
            disabled={pending || Boolean(framesJob) || Boolean(blocked) || !engineReady}
            onClick={() =>
              run(() => generateFrames({ projectId, shotIds: [shot.id], engine, n }), {
                success: "Frames en cola",
                onSuccess: onQueued,
              })
            }
          >
            {framesJob ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generar {n} variante{n > 1 ? "s" : ""}
          </Button>
        </div>

        {shot.references.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">Referencias que se adjuntan</div>
            <div className="flex flex-wrap gap-1">
              {shot.references.map((r, i) => (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
                    <img src={r.thumbUrl} alt={r.label} loading="lazy" className="h-10 w-14 rounded border object-cover" />
                  </TooltipTrigger>
                  <TooltipContent>{r.label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {framesJob && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {framesJob.status === "queued" ? "En cola" : ((framesJob.progress as JobProgress | null)?.message ?? "Generando")}…
          </div>
        )}
        {visible.length === 0 && !framesJob ? (
          <div className={cn("flex max-w-md items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground", aspectClass)}>
            <span className="flex flex-col items-center gap-1">
              <ImageIcon className="size-6" />
              Sin frames todavía
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {visible.map((frame) => (
              <FrameTile key={frame.id} frame={frame} aspectClass={aspectClass} />
            ))}
          </div>
        )}
        {hiddenRejected > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {hiddenRejected} rechazado{hiddenRejected > 1 ? "s" : ""} oculto{hiddenRejected > 1 ? "s" : ""}
          </p>
        )}
      </div>
    </section>
  );
}

function PromptEditor({ shot }: { shot: ShotFramesView }) {
  const { run } = useAction();
  const [prompt, setPrompt] = useState(shot.imagePrompt ?? "");
  const [negative, setNegative] = useState(shot.imageNegative ?? "");
  const [video, setVideo] = useState(shot.videoPrompt ?? "");
  const [synced, setSynced] = useState({ p: shot.imagePrompt, n: shot.imageNegative, v: shot.videoPrompt });
  if (synced.p !== shot.imagePrompt || synced.n !== shot.imageNegative || synced.v !== shot.videoPrompt) {
    setSynced({ p: shot.imagePrompt, n: shot.imageNegative, v: shot.videoPrompt });
    setPrompt(shot.imagePrompt ?? "");
    setNegative(shot.imageNegative ?? "");
    setVideo(shot.videoPrompt ?? "");
  }

  const commit = (field: "image_prompt" | "image_negative" | "video_prompt", value: string, original: string | null) => {
    if (value.trim() !== (original ?? "").trim()) run(() => updateShotPrompt(shot.id, { [field]: value.trim() || null }), { success: "Prompt guardado" });
  };

  if (!shot.imagePrompt && !prompt) {
    return <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Sin prompt todavía.</p>;
  }

  return (
    <details className="group rounded-md border" open>
      <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted-foreground select-none">Prompt de imagen</summary>
      <div className="space-y-1.5 border-t p-1.5">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => commit("image_prompt", prompt, shot.imagePrompt)}
          className="max-h-60 min-h-24 resize-none font-mono text-[11px] leading-snug md:text-[11px]"
        />
        <div className="text-[11px] text-muted-foreground">Negativo</div>
        <Textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          onBlur={() => commit("image_negative", negative, shot.imageNegative)}
          className="max-h-32 min-h-12 resize-none font-mono text-[11px] leading-snug md:text-[11px]"
        />
        {shot.videoPrompt !== null && (
          <details>
            <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">Borrador de video prompt (fase 2)</summary>
            <Textarea
              value={video}
              onChange={(e) => setVideo(e.target.value)}
              onBlur={() => commit("video_prompt", video, shot.videoPrompt)}
              className="mt-1 max-h-60 min-h-20 resize-none font-mono text-[11px] leading-snug md:text-[11px]"
            />
          </details>
        )}
      </div>
    </details>
  );
}

function FrameTile({ frame, aspectClass }: { frame: FrameView; aspectClass: string }) {
  const { pending, run } = useAction();
  const [notes, setNotes] = useState(frame.reviewNotes ?? "");

  return (
    <figure
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted/40",
        frame.selected && "border-emerald-500 ring-2 ring-emerald-500/50",
        frame.rejected && "opacity-40",
      )}
    >
      <a href={frame.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
        <img src={frame.thumbUrl} alt={`Variante ${frame.variantIndex}`} loading="lazy" className={cn("w-full object-cover", aspectClass)} />
      </a>
      <div className="absolute top-1 left-1 flex gap-1">
        <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white tabular-nums">
          v{frame.variantIndex} · {frame.engine}
        </span>
        {frame.selected && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">Elegido</span>}
        {frame.promptChanged && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-[10px] text-white">Prompt anterior</span>
            </TooltipTrigger>
            <TooltipContent>Se generó con un prompt distinto al actual.</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="absolute right-1 bottom-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {frame.selected ? (
          <Button size="icon-xs" variant="secondary" aria-label="Quitar elegido" disabled={pending} onClick={() => run(() => unselectFrame(frame.id))}>
            <UndoIcon />
          </Button>
        ) : (
          <Button size="icon-xs" aria-label="Elegir este frame" disabled={pending} onClick={() => run(() => selectFrame(frame.id), { success: "Frame elegido" })}>
            <CheckIcon />
          </Button>
        )}
        {!frame.selected && (
          <Button
            size="icon-xs"
            variant="secondary"
            aria-label={frame.rejected ? "Quitar rechazo" : "Rechazar"}
            disabled={pending}
            onClick={() => run(() => rejectFrame(frame.id, !frame.rejected))}
          >
            {frame.rejected ? <UndoIcon /> : <XIcon />}
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon-xs" variant="secondary" aria-label="Nota de revisión">
              <MessageSquareIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2 p-2">
            <div className="text-xs font-medium">Nota de revisión</div>
            <Textarea
              rows={3}
              value={notes}
              placeholder="Ej.: HSE: falta el detector de gases en el pecho"
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs"
            />
            <Button size="xs" disabled={pending} onClick={() => run(() => setReviewNotes(frame.id, notes), { success: "Nota guardada" })}>
              Guardar nota
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      {frame.reviewNotes && (
        <figcaption className="flex items-start gap-1 border-t bg-background/90 px-2 py-1 text-[11px]">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          {frame.reviewNotes}
        </figcaption>
      )}
    </figure>
  );
}
