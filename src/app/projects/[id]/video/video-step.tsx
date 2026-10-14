"use client";

import { useOptimistic, useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClapperboardIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import type { EngineInfo } from "@/lib/engines/registry";
import type { JobProgress } from "@/lib/jobs/types";
import type { ProjectJob } from "@/lib/projects/data";
import { formatUsd } from "@/lib/projects/data";
import { cn } from "@/lib/utils";
import { setProjectEngines } from "../../actions";
import { isActive, useProjectJobs } from "../jobs-provider";
import { generateClips, generateVideoPrompts, rejectClip, selectClip, setClipNotes, unselectClip, updateShotVideo } from "./actions";

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
  clips: ClipView[];
};

const ASPECT_CLASS: Record<string, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "4:3": "aspect-[4/3]",
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

export function VideoStep({
  projectId,
  aspectRatio,
  shots,
  engines,
  engine: projectEngine,
  videoSummary,
  systemPrompt,
}: {
  projectId: string;
  aspectRatio: string;
  shots: ShotVideoView[];
  engines: EngineInfo[];
  engine: string;
  videoSummary: string;
  /** Título y versión del system prompt de video activo del cliente. */
  systemPrompt: string | null;
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
  const [showRejected, setShowRejected] = useState(false);

  const withFrame = shots.filter((s) => s.frame);
  const needPrompts = withFrame.filter((s) => !s.videoPrompt || s.promptStale);
  const hasApprovedClip = (s: ShotVideoView) => s.clips.some((c) => c.selected);
  const needClips = withFrame.filter((s) => !hasApprovedClip(s) && s.missingConsent.length === 0);
  const approvedCount = shots.filter(hasApprovedClip).length;
  const batches = jobs.filter((j) => isActive(j) && (j.type === "generate_clips" || j.type === "generate_video_prompts") && !j.shot_id);
  const engineInfo = engines.find((e) => e.name === engine);
  const unsupportedAspect = engine === "gemini" && !["16:9", "9:16"].includes(aspectRatio);
  const batchSeconds = needClips.reduce((sum, s) => sum + secondsFor(s), 0) * n;
  const batchCost = USD_PER_SEC[engine] ? ` Costo estimado: ${formatUsd(batchSeconds * USD_PER_SEC[engine])} (${batchSeconds} s de video).` : "";

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] flex-col">
      <div className="sticky top-11 z-20 flex flex-wrap items-center gap-2 border-b bg-background/95 px-6 py-2 backdrop-blur">
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
        <Select value={String(n)} onValueChange={(v) => setN(Number(v))}>
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
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <Switch size="sm" checked={showRejected} onCheckedChange={setShowRejected} />
            Mostrar rechazados
          </label>
          <span className={cn(approvedCount === shots.length && shots.length > 0 && "text-emerald-500")}>
            {approvedCount}/{shots.length} con clip aprobado
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-6 py-1.5 text-xs text-muted-foreground">
        <span>
          System prompt de video:{" "}
          {systemPrompt ? (
            <Link href="/settings?step=video" className="text-foreground underline-offset-2 hover:underline">
              {systemPrompt}
            </Link>
          ) : (
            <span className="text-amber-500">ninguno activo (cargalo en Settings)</span>
          )}
        </span>
        <span>
          {withFrame.length}/{shots.length} planos con frame aprobado
        </span>
        {unsupportedAspect && (
          <span className="flex items-center gap-1 text-amber-500">
            <AlertTriangleIcon className="size-3.5" />
            Gemini Omni solo genera 16:9 o 9:16 y el proyecto está en {aspectRatio}.
          </span>
        )}
      </div>

      {shots.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Todavía no hay shot list.</p>
      ) : (
        <div className="divide-y">
          {shots.map((shot) => (
            <ShotVideo
              key={shot.id}
              projectId={projectId}
              shot={shot}
              engine={engine}
              engineReady={Boolean(engineInfo?.configured) && !unsupportedAspect}
              n={n}
              aspectClass={ASPECT_CLASS[aspectRatio] ?? "aspect-video"}
              showRejected={showRejected}
              promptJob={activeJobFor(jobs, "generate_video_prompts", shot.id)}
              clipsJob={activeJobFor(jobs, "generate_clips", shot.id)}
              lastError={lastErrorFor(jobs, shot.id)}
              onQueued={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShotVideo({
  projectId,
  shot,
  engine,
  engineReady,
  n,
  aspectClass,
  showRejected,
  promptJob,
  clipsJob,
  lastError,
  onQueued,
}: {
  projectId: string;
  shot: ShotVideoView;
  engine: string;
  engineReady: boolean;
  n: number;
  aspectClass: string;
  showRejected: boolean;
  promptJob?: ProjectJob;
  clipsJob?: ProjectJob;
  lastError: string | null;
  onQueued: () => void;
}) {
  const { pending, run } = useAction();
  const visible = shot.clips.filter((c) => showRejected || !c.rejected || c.selected);
  const hiddenRejected = shot.clips.length - visible.length;
  const blocked = !shot.frame
    ? "Sin frame aprobado."
    : shot.missingConsent.length
      ? `Falta consentimiento de ${shot.missingConsent.join(", ")}.`
      : null;

  return (
    <section className="grid grid-cols-[26rem_1fr] gap-4 px-6 py-4">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tabular-nums">#{shot.number}</span>
          <span className="text-muted-foreground">
            Escena {shot.sceneNumber}
            {shot.sceneTitle ? ` · ${shot.sceneTitle}` : ""}
          </span>
          {shot.clips.some((c) => c.selected) && <Badge className="bg-emerald-500/15 text-emerald-500">Clip aprobado</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          {shot.characters.length ? shot.characters.join(", ") : "sin personajes"} · {shot.location ?? "sin locación"} · ~
          {shot.estDurationSec} s de locución
        </div>

        <div className="flex gap-2">
          {shot.frame ? (
            <a href={shot.frame.url} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
              <img src={shot.frame.thumbUrl} alt={`Frame aprobado del plano ${shot.number}`} className="h-20 rounded border object-cover" />
            </a>
          ) : (
            <Link
              href={`/projects/${projectId}/frames`}
              className="flex h-20 w-36 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed text-center text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ImageOffIcon className="size-4" />
              Aprobá un frame
            </Link>
          )}
          <div className="min-w-0 space-y-1">
            {shot.action && <p className="text-xs">{shot.action}</p>}
            {shot.voLine && <p className="text-xs text-muted-foreground italic">“{shot.voLine}”</p>}
          </div>
        </div>

        <VideoPromptEditor shot={shot} />

        {shot.videoQaNotes && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs whitespace-pre-line">
            <div className="mb-0.5 font-medium text-amber-600 dark:text-amber-400">Revisión del frame y notas</div>
            {shot.videoQaNotes}
          </div>
        )}
        {shot.promptStale && (
          <p className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            El prompt se escribió para otro frame. Regeneralo (o se regenera solo al generar el clip).
          </p>
        )}
        {shot.realPeople.length > 0 && engine === "gemini" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {shot.realPeople.join(", ")} {shot.realPeople.length > 1 ? "están basados" : "está basado/a"} en una persona real: Gemini
            Omni puede bloquear el clip.
          </p>
        )}
        {blocked && (
          <p className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            {blocked}
          </p>
        )}
        {lastError && !promptJob && !clipsJob && (
          <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            Último intento falló: {lastError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || Boolean(promptJob) || !shot.frame}
            onClick={() =>
              run(() => generateVideoPrompts({ projectId, shotIds: [shot.id], engine }), {
                success: "Prompt de video en cola",
                onSuccess: onQueued,
              })
            }
          >
            {promptJob ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
            {shot.videoPrompt ? "Regenerar prompt" : "Generar prompt"}
          </Button>
          <Button
            size="sm"
            disabled={pending || Boolean(clipsJob) || Boolean(blocked) || !engineReady}
            onClick={() =>
              run(() => generateClips({ projectId, shotIds: [shot.id], engine, n }), { success: "Clip en cola", onSuccess: onQueued })
            }
          >
            {clipsJob ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generar {n} clip{n > 1 ? "s" : ""} · {secondsFor(shot)} s
          </Button>
        </div>
      </div>

      <div className="min-w-0">
        {clipsJob && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {clipsJob.status === "queued" ? "En cola" : ((clipsJob.progress as JobProgress | null)?.message ?? "Generando")}… (cada clip
            puede tardar un par de minutos)
          </div>
        )}
        {visible.length === 0 && !clipsJob ? (
          <div className={cn("flex max-w-md items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground", aspectClass)}>
            <span className="flex flex-col items-center gap-1">
              <FilmIcon className="size-6" />
              Sin clips todavía
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
            {visible.map((clip) => (
              <ClipTile key={clip.id} clip={clip} aspectClass={aspectClass} />
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

function VideoPromptEditor({ shot }: { shot: ShotVideoView }) {
  const { run } = useAction();
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
  const commitSeconds = () => {
    const value = seconds.trim() ? Number(seconds.replace(",", ".")) : null;
    if (value !== shot.videoDurationSec && (value === null || Number.isFinite(value))) {
      run(() => updateShotVideo(shot.id, { video_duration_sec: value }), { success: "Duración guardada" });
    }
  };

  if (!shot.videoPrompt && !prompt) {
    return <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Sin prompt de video todavía.</p>;
  }

  return (
    <details className="rounded-md border" open>
      <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted-foreground select-none">Prompt de video</summary>
      <div className="space-y-1.5 border-t p-1.5">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => commit("video_prompt", prompt, shot.videoPrompt)}
          className="max-h-72 min-h-28 resize-none font-mono text-[11px] leading-snug md:text-[11px]"
        />
        <div className="text-[11px] text-muted-foreground">Avoid (se agrega al final del prompt)</div>
        <Textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          onBlur={() => commit("video_negative", negative, shot.videoNegative)}
          className="max-h-32 min-h-12 resize-none font-mono text-[11px] leading-snug md:text-[11px]"
        />
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Segundos a generar
          <Input
            value={seconds}
            inputMode="decimal"
            onChange={(e) => setSeconds(e.target.value)}
            onBlur={commitSeconds}
            className="h-6 w-16 text-xs"
          />
        </label>
      </div>
    </details>
  );
}

function ClipTile({ clip, aspectClass }: { clip: ClipView; aspectClass: string }) {
  const { pending, run } = useAction();
  const [notes, setNotes] = useState(clip.reviewNotes ?? "");

  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-lg border bg-muted/40",
        clip.selected && "border-emerald-500 ring-2 ring-emerald-500/50",
        clip.rejected && "opacity-40",
      )}
    >
      <video
        src={clip.url}
        poster={clip.posterUrl ?? undefined}
        controls
        preload="metadata"
        playsInline
        className={cn("w-full bg-black object-contain", aspectClass)}
      />
      <div className="pointer-events-none absolute top-1 left-1 flex gap-1">
        <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white tabular-nums">
          v{clip.variantIndex} · {clip.durationSec ? `${clip.durationSec} s` : "—"} · {clip.resolution ?? clip.engine}
        </span>
        {clip.selected && (
          <span className="flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <CheckIcon className="size-3" />
            Aprobado
          </span>
        )}
        {clip.fromOtherFrame && <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-[10px] text-white">Otro frame</span>}
        {!clip.fromOtherFrame && clip.promptChanged && (
          <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-[10px] text-white">Prompt anterior</span>
        )}
      </div>
      <div className="flex items-center gap-1 border-t bg-background/90 p-1">
        {clip.selected ? (
          <Button
            size="xs"
            variant="outline"
            className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
            disabled={pending}
            onClick={() => run(() => unselectClip(clip.id), { success: "Aprobación quitada" })}
          >
            <UndoIcon />
            Quitar aprobación
          </Button>
        ) : (
          <Button
            size="xs"
            className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={pending || clip.rejected}
            onClick={() => run(() => selectClip(clip.id), { success: "Clip aprobado" })}
          >
            <CheckIcon />
            Aprobar
          </Button>
        )}
        <span className="flex-1 truncate px-1 text-[10px] text-muted-foreground">
          {clip.model} · {formatUsd(clip.costUsd)}
        </span>
        {!clip.selected && (
          <Button
            size="icon-xs"
            variant="secondary"
            aria-label={clip.rejected ? "Quitar rechazo" : "Rechazar"}
            disabled={pending}
            onClick={() => run(() => rejectClip(clip.id, !clip.rejected))}
          >
            {clip.rejected ? <UndoIcon /> : <XIcon />}
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
              placeholder="Ej.: la mano izquierda se deforma en el segundo 3"
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs"
            />
            <Button size="xs" disabled={pending} onClick={() => run(() => setClipNotes(clip.id, notes), { success: "Nota guardada" })}>
              Guardar nota
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      {clip.reviewNotes && (
        <figcaption className="flex items-start gap-1 border-t bg-background/90 px-2 py-1 text-[11px]">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          {clip.reviewNotes}
        </figcaption>
      )}
    </figure>
  );
}
