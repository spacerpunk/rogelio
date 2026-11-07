"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Grid2x2Icon,
  Grid3x3Icon,
  ImagePlusIcon,
  Loader2Icon,
  PlusIcon,
  RectangleHorizontalIcon,
  SparklesIcon,
  Undo2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import type { PromptEditResult } from "@/lib/pipeline/prompt-edit";
import type { FrameOptionView, LibraryImageView, ReferenceView, ShotReferencesView } from "@/lib/projects/review";
import { uploadToSignedTarget } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { isActive, useProjectJobs } from "../jobs-provider";
import { addShotReference, createReferenceUploadTarget, removeShotReference, requestPromptEdit, resolvePromptEdit, setAutoReferenceExcluded } from "./actions";

export const ASPECT_CLASS: Record<string, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "1:1": "aspect-square",
  "4:3": "aspect-[4/3]",
};

// ---------------------------------------------------------------------------
// Estado de revisión de un plano
// ---------------------------------------------------------------------------

export type ReviewStatus = "review" | "regenerate" | "approved" | "pending";
export type StatusFilterValue = "all" | ReviewStatus;

export const STATUS_META: Record<ReviewStatus, { label: string; dot: string; pill: string }> = {
  review: { label: "Por revisar", dot: "bg-sky-400", pill: "bg-sky-500/90 text-white" },
  regenerate: { label: "A regenerar", dot: "bg-amber-400", pill: "bg-amber-500/90 text-white" },
  approved: { label: "Aprobado", dot: "bg-emerald-400", pill: "bg-emerald-600/90 text-white" },
  pending: { label: "Sin generar", dot: "bg-zinc-400", pill: "bg-zinc-700/90 text-white" },
};

/** Aprobado si hay una variante aprobada; por revisar si quedan sin rechazar; a regenerar si todas se rechazaron o falló. */
export function reviewStatus(variants: { selected: boolean; rejected: boolean }[], failed: boolean): ReviewStatus {
  if (variants.some((v) => v.selected)) return "approved";
  if (variants.some((v) => !v.rejected)) return "review";
  if (variants.length > 0 || failed) return "regenerate";
  return "pending";
}

export function StatusPill({ status, className }: { status: ReviewStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm", STATUS_META[status].pill, className)}>
      {STATUS_META[status].label}
    </span>
  );
}

export function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
  counts: Record<StatusFilterValue, number>;
}) {
  const options: StatusFilterValue[] = ["all", "review", "regenerate", "approved", "pending"];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5" role="radiogroup" aria-label="Filtrar planos">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
            value === option && "bg-background text-foreground shadow-sm",
          )}
        >
          {option !== "all" && <span className={cn("size-1.5 rounded-full", STATUS_META[option].dot)} />}
          {option === "all" ? "Todos" : STATUS_META[option].label}
          <span className="tabular-nums opacity-60">{counts[option]}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grilla
// ---------------------------------------------------------------------------

export type Density = "l" | "m" | "s";

export const GRID_CLASS: Record<Density, string> = {
  l: "grid-cols-1 lg:grid-cols-2",
  m: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
  s: "grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
};

export function DensityToggle({ value, onChange }: { value: Density; onChange: (value: Density) => void }) {
  const options: { value: Density; label: string; icon: React.ReactNode }[] = [
    { value: "l", label: "Grande", icon: <RectangleHorizontalIcon /> },
    { value: "m", label: "Mediano", icon: <Grid2x2Icon /> },
    { value: "s", label: "Chico", icon: <Grid3x3Icon /> },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5" role="radiogroup" aria-label="Tamaño de la grilla">
      {options.map((o) => (
        <Tooltip key={o.value}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={value === o.value}
              aria-label={o.label}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-3.5",
                value === o.value && "bg-background text-foreground shadow-sm",
              )}
            >
              {o.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent>{o.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** Agrupa por escena, manteniendo el orden del shot list. */
export function groupByScene<T extends { sceneNumber: number; sceneTitle: string | null }>(items: T[]) {
  const groups: { sceneNumber: number; sceneTitle: string | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.sceneNumber === item.sceneNumber) last.items.push(item);
    else groups.push({ sceneNumber: item.sceneNumber, sceneTitle: item.sceneTitle, items: [item] });
  }
  return groups;
}

export function SceneHeading({ number, title, count }: { number: number; title: string | null; count: number }) {
  return (
    <h2 className="mb-2 flex items-baseline gap-2 text-sm">
      <span className="font-semibold">Escena {number}</span>
      {title && <span className="text-muted-foreground">{title}</span>}
      <span className="text-xs text-muted-foreground/60 tabular-nums">· {count} plano{count === 1 ? "" : "s"}</span>
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Video que se reproduce al pasar el mouse
// ---------------------------------------------------------------------------

export function HoverVideo({ src, poster, playing, className }: { src: string; poster?: string | null; playing: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [playing, src]);

  return (
    <>
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        muted
        loop
        playsInline
        preload="none"
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        className={cn("size-full bg-black object-cover", className)}
      />
      {playing && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
          <span className="block h-full bg-white/80" style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel de detalle
// ---------------------------------------------------------------------------

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

export type ReviewKeys = {
  prevVariant?: () => void;
  nextVariant?: () => void;
  prevShot?: () => void;
  nextShot?: () => void;
  approve?: () => void;
  reject?: () => void;
};

/** Atajos del panel de detalle: ← → variantes, ↑ ↓ planos, A aprobar, X rechazar. */
export function useReviewKeys(keys: ReviewKeys, enabled: boolean) {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = ref.current;
      const map: Record<string, (() => void) | undefined> = {
        ArrowLeft: k.prevVariant,
        ArrowRight: k.nextVariant,
        ArrowUp: k.prevShot,
        ArrowDown: k.nextShot,
        a: k.approve,
        x: k.reject,
      };
      const fn = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export function ReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  status,
  position,
  onPrevShot,
  onNextShot,
  viewer,
  panel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  status: ReviewStatus;
  /** "3 de 12": posición del plano en la lista filtrada. */
  position: string;
  onPrevShot?: () => void;
  onNextShot?: () => void;
  viewer: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[94svh] w-[97vw] max-w-[97vw] gap-0 overflow-hidden p-0 sm:max-w-[min(97vw,1760px)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
          <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <div className="flex items-center">
              <Button size="icon-sm" variant="ghost" className="text-zinc-300 hover:bg-white/10 hover:text-white" disabled={!onPrevShot} onClick={onPrevShot} aria-label="Plano anterior (↑)">
                <ChevronLeftIcon />
              </Button>
              <Button size="icon-sm" variant="ghost" className="text-zinc-300 hover:bg-white/10 hover:text-white" disabled={!onNextShot} onClick={onNextShot} aria-label="Plano siguiente (↓)">
                <ChevronRightIcon />
              </Button>
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-semibold text-white">{title}</DialogTitle>
              <DialogDescription className="truncate text-xs text-zinc-400">{description}</DialogDescription>
            </div>
            <StatusPill status={status} />
            <span className="ml-auto hidden text-[11px] text-zinc-500 lg:inline">
              ← → variantes · ↑ ↓ planos · A aprobar · X rechazar · {position}
            </span>
            <Button size="icon-sm" variant="ghost" className="text-zinc-300 hover:bg-white/10 hover:text-white" onClick={() => onOpenChange(false)} aria-label="Cerrar">
              <XIcon />
            </Button>
          </header>
          {viewer}
        </div>
        <aside className="w-[28rem] shrink-0 overflow-y-auto border-l bg-background">{panel}</aside>
      </DialogContent>
    </Dialog>
  );
}

export function PanelSection({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2 border-b px-4 py-3", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Tira de variantes debajo del visor. */
export function Filmstrip<T extends { id: string; selected: boolean; rejected: boolean }>({
  items,
  activeId,
  onSelect,
  aspectClass,
  render,
}: {
  items: T[];
  activeId: string | null;
  onSelect: (id: string) => void;
  aspectClass: string;
  render: (item: T) => React.ReactNode;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);
  if (items.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-white/10 px-3 py-2">
      {items.map((item) => (
        <button
          key={item.id}
          ref={item.id === activeId ? activeRef : undefined}
          type="button"
          onClick={() => onSelect(item.id)}
          className={cn(
            "relative h-20 shrink-0 overflow-hidden rounded-md ring-2 ring-transparent transition",
            aspectClass,
            item.id === activeId && "ring-white",
            item.selected && item.id !== activeId && "ring-emerald-500",
            item.rejected && "opacity-35 hover:opacity-70",
          )}
        >
          {render(item)}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edición del prompt con IA
// ---------------------------------------------------------------------------

export function AiPromptEditor({
  shotId,
  target,
  engine,
  draft,
  frameId,
  disabled,
  onApplyAndGenerate,
  generateLabel,
}: {
  shotId: string;
  target: "image" | "video";
  engine: string;
  /** Lo que hay en los editores ahora (puede no estar guardado). */
  draft: () => { prompt: string; negative: string | null; seconds?: number | null };
  /** Variante que se está mirando: el motor de texto la ve. */
  frameId?: string | null;
  disabled?: string | null;
  onApplyAndGenerate?: () => void;
  generateLabel?: string;
}) {
  const { jobs, refresh } = useProjectJobs();
  const { pending, run } = useAction();
  const [instruction, setInstruction] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);

  const mine = jobs.filter((j) => j.type === "edit_prompt" && j.shot_id === shotId && (j.payload as { target?: string }).target === target);
  const active = mine.find(isActive);
  const latest = mine[0];
  const proposal = latest?.status === "done" && (latest.result as PromptEditResult | null)?.state === "proposed" ? (latest.result as PromptEditResult) : null;
  const failed = latest?.status === "error" ? latest.error : null;

  const submit = () => {
    const current = draft();
    run(
      () =>
        requestPromptEdit({
          shotId,
          target,
          instruction,
          engine,
          prompt: current.prompt,
          negative: current.negative,
          seconds: current.seconds ?? null,
          frameId: frameId ?? null,
        }),
      {
        onSuccess: () => {
          setInstruction("");
          refresh();
        },
      },
    );
  };
  const resolve = (apply: boolean, generate = false) =>
    run(() => resolvePromptEdit(latest!.id, apply), {
      success: apply ? "Prompt actualizado" : undefined,
      onSuccess: () => {
        refresh();
        if (generate) onApplyAndGenerate?.();
      },
    });

  return (
    <div className="space-y-2">
      {proposal ? (
        <div className="space-y-2 rounded-lg border border-violet-500/40 bg-violet-500/5 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-300">
            <SparklesIcon className="size-3.5" />
            Propuesta: «{proposal.instruction}»
          </div>
          {proposal.changes && <p className="text-xs whitespace-pre-line">{proposal.changes}</p>}
          <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? "Ocultar prompt propuesto" : "Ver prompt propuesto"}
          </button>
          {showPrompt && (
            <pre className="max-h-60 overflow-y-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap">
              {proposal.prompt}
              {proposal.negative ? `\n\n— ${target === "image" ? "Negativo" : "Avoid"}: ${proposal.negative}` : ""}
              {proposal.seconds ? `\n— Segundos: ${proposal.seconds}` : ""}
            </pre>
          )}
          <div className="flex flex-wrap gap-1.5">
            {onApplyAndGenerate && (
              <Button size="xs" disabled={pending || Boolean(disabled)} onClick={() => resolve(true, true)}>
                <SparklesIcon />
                Aplicar y {generateLabel ?? "generar"}
              </Button>
            )}
            <Button size="xs" variant={onApplyAndGenerate ? "outline" : "default"} disabled={pending} onClick={() => resolve(true)}>
              Aplicar
            </Button>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => resolve(false)}>
              Descartar
            </Button>
          </div>
        </div>
      ) : active ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          Reescribiendo el prompt…
        </p>
      ) : null}

      {!active && (
        <div className="space-y-1.5">
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instruction.trim()) submit();
            }}
            rows={2}
            placeholder={
              target === "image"
                ? "¿Qué querés cambiar? Ej.: que sea de noche, Aníbal mirando a cámara, sacá el casco de la mesa"
                : "¿Qué querés cambiar? Ej.: cámara fija, que camine más lento, que no hable"
            }
            className="min-h-14 resize-none text-xs md:text-xs"
          />
          <div className="flex items-center gap-2">
            <Button size="xs" variant="secondary" disabled={pending || !instruction.trim() || Boolean(disabled)} onClick={submit}>
              <SparklesIcon />
              Reescribir con IA
            </Button>
            <span className="text-[11px] text-muted-foreground">{disabled ?? "Ctrl + Enter · queda como propuesta para aplicar o descartar"}</span>
          </div>
          {failed && !proposal && <p className="text-[11px] text-destructive">La última edición falló: {failed}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Referencias del plano
// ---------------------------------------------------------------------------

function ReferenceThumb({ reference, index, onRemove, disabled }: { reference: ReferenceView; index: number; onRemove?: () => void; disabled?: boolean }) {
  return (
    <div className="group/ref relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <a href={reference.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
            <img src={reference.thumbUrl} alt={reference.label} loading="lazy" className="aspect-square w-full object-cover" />
          </a>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {reference.label}
          {!reference.auto && " · agregada a mano"}
        </TooltipContent>
      </Tooltip>
      <span className="pointer-events-none absolute top-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">{index}</span>
      {!reference.auto && <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-violet-600/90 px-1 text-[9px] text-white">extra</span>}
      {onRemove && (
        <button
          type="button"
          aria-label="Quitar referencia"
          disabled={disabled}
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/ref:opacity-100 hover:bg-destructive focus-visible:opacity-100"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

export function ReferencesEditor({
  shotId,
  target,
  references,
  libraryImages,
  frameOptions,
  leading,
  max,
  extraFrames,
}: {
  shotId: string;
  target: "image" | "video";
  references: ShotReferencesView;
  libraryImages: LibraryImageView[];
  frameOptions: FrameOptionView[];
  /** Video: el primer frame, que va siempre como imagen 1. */
  leading?: { label: string; thumbUrl: string; url: string };
  max: number;
  /** Variantes del mismo plano que también se pueden sumar (frames). */
  extraFrames?: { id: string; label: string; thumbUrl: string }[];
}) {
  const { pending, run } = useAction();
  const offset = leading ? 2 : 1;
  const remove = (ref: ReferenceView) =>
    run(() =>
      ref.manualId ? removeShotReference(ref.manualId) : setAutoReferenceExcluded({ shotId, target, assetId: ref.assetId!, excluded: true }),
    );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {leading && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a href={leading.url} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-md border border-emerald-500/60 bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
                <img src={leading.thumbUrl} alt={leading.label} className="aspect-square w-full object-cover" />
                <span className="absolute top-0.5 left-0.5 rounded bg-emerald-600 px-1 text-[10px] text-white">1</span>
              </a>
            </TooltipTrigger>
            <TooltipContent>{leading.label}</TooltipContent>
          </Tooltip>
        )}
        {references.active.map((ref, i) => (
          <ReferenceThumb key={ref.key} reference={ref} index={i + offset} disabled={pending} onRemove={() => remove(ref)} />
        ))}
        <AddReferenceButton
          shotId={shotId}
          target={target}
          libraryImages={libraryImages}
          frameOptions={frameOptions}
          extraFrames={extraFrames}
          full={references.active.length >= max}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {references.active.length}/{max} referencias
        {target === "image" ? " · sheets de los personajes, plates de la locación y EPP se suman solas." : " · las sheets de los personajes se suman solas."}
      </p>
      {references.removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          Quitadas:
          {references.removed.map((ref) => (
            <Tooltip key={ref.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setAutoReferenceExcluded({ shotId, target, assetId: ref.assetId!, excluded: false }))}
                  className="group/rm relative size-8 overflow-hidden rounded border opacity-60 hover:opacity-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
                  <img src={ref.thumbUrl} alt={ref.label} className="size-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover/rm:opacity-100">
                    <Undo2Icon className="size-3.5" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Devolver: {ref.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

function AddReferenceButton({
  shotId,
  target,
  libraryImages,
  frameOptions,
  extraFrames,
  full,
}: {
  shotId: string;
  target: "image" | "video";
  libraryImages: LibraryImageView[];
  frameOptions: FrameOptionView[];
  extraFrames?: { id: string; label: string; thumbUrl: string }[];
  full: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pending, run } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const add = (input: Omit<Parameters<typeof addShotReference>[0], "shotId" | "target">) =>
    run(() => addShotReference({ shotId, target, ...input }), { success: "Referencia agregada", onSuccess: () => setOpen(false) });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name} no es una imagen`);
          continue;
        }
        const targetUrl = await createReferenceUploadTarget({ shotId, fileName: file.name });
        if (!targetUrl.ok) throw new Error(targetUrl.error);
        await uploadToSignedTarget("projects", targetUrl.data, file);
        const added = await addShotReference({ shotId, target, source: "upload", path: targetUrl.data.path, name: file.name.replace(/\.[^.]+$/, "") });
        if (!added.ok) throw new Error(added.error);
      }
      toast.success("Referencia subida");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const otherFrames = frameOptions.filter((f) => f.shotId !== shotId);
  const byKind = libraryImages.reduce<Record<string, LibraryImageView[]>>((acc, img) => {
    (acc[img.kindLabel] ??= []).push(img);
    return acc;
  }, {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={full}
          className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
        >
          <PlusIcon className="size-4" />
          Agregar
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="left" className="w-[30rem] p-0">
        <Tabs defaultValue="upload" className="gap-0">
          <TabsList className="m-2">
            <TabsTrigger value="upload">Subir</TabsTrigger>
            <TabsTrigger value="library">Biblioteca</TabsTrigger>
            <TabsTrigger value="frames">Frames del proyecto</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="p-3 pt-1">
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            >
              {busy ? <Loader2Icon className="size-5 animate-spin" /> : <UploadIcon className="size-5" />}
              Elegí una o varias imágenes
              <span className="text-[11px] opacity-70">Quedan solo para este plano (no se suman a la biblioteca).</span>
            </button>
          </TabsContent>
          <TabsContent value="library" className="max-h-96 space-y-3 overflow-y-auto p-3 pt-1">
            {Object.keys(byKind).length === 0 && <p className="text-xs text-muted-foreground">La biblioteca del cliente no tiene imágenes.</p>}
            {Object.entries(byKind).map(([kind, images]) => (
              <div key={kind}>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">{kind}</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {images.map((img) => (
                    <Tooltip key={img.id}>
                      <TooltipTrigger asChild>
                        <button type="button" disabled={pending} onClick={() => add({ source: "library", assetId: img.id })} className="overflow-hidden rounded-md border hover:ring-2 hover:ring-primary">
                          {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
                          <img src={img.thumbUrl} alt={img.title} loading="lazy" className="aspect-square w-full object-cover" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{img.title}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="frames" className="max-h-96 space-y-3 overflow-y-auto p-3 pt-1">
            {extraFrames && extraFrames.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">Variantes de este plano</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {extraFrames.map((f) => (
                    <FrameOption key={f.id} label={f.label} thumbUrl={f.thumbUrl} disabled={pending} onClick={() => add({ source: "frame", frameId: f.id })} />
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Frames aprobados de otros planos (continuidad)</div>
              {otherFrames.length === 0 ? (
                <p className="text-xs text-muted-foreground">Todavía no hay frames aprobados en otros planos.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {otherFrames.map((f) => (
                    <FrameOption key={f.id} label={`Plano #${f.shotNumber}`} thumbUrl={f.thumbUrl} disabled={pending} onClick={() => add({ source: "frame", frameId: f.id })} />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function FrameOption({ label, thumbUrl, disabled, onClick }: { label: string; thumbUrl: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="relative overflow-hidden rounded-md border hover:ring-2 hover:ring-primary">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
      <img src={thumbUrl} alt={label} loading="lazy" className="aspect-video w-full object-cover" />
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[10px] text-white">{label}</span>
    </button>
  );
}

/** Botón chico para sumar la variante que se está mirando como referencia del plano. */
export function UseAsReferenceButton({ shotId, frameId, className }: { shotId: string; frameId: string; className?: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="xs"
      variant="ghost"
      className={className}
      disabled={pending}
      onClick={() => run(() => addShotReference({ shotId, target: "image", source: "frame", frameId }), { success: "Variante sumada como referencia" })}
    >
      <ImagePlusIcon />
      Usar como referencia
    </Button>
  );
}
