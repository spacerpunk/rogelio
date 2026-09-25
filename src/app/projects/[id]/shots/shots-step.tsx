"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  GripVerticalIcon,
  ListPlusIcon,
  Loader2Icon,
  MergeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/hooks/use-action";
import { FRAMINGS, FRAMING_LABEL, type Framing } from "@/lib/pipeline/shotlist";
import { formatDuration } from "@/lib/projects/data";
import { cn } from "@/lib/utils";
import { isActive, useProjectJobs } from "../jobs-provider";
import {
  approveShotlist,
  deleteShot,
  generateShotlist,
  insertShotAfter,
  mergeWithNext,
  reorderShots,
  splitShot,
  updateShot,
} from "./actions";

export type ShotView = {
  id: string;
  orderIndex: number;
  sceneNumber: number;
  sceneTitle: string | null;
  characterIds: string[];
  locationId: string | null;
  framing: Framing;
  lighting: string | null;
  action: string | null;
  voLine: string | null;
  onScreenText: string | null;
  estDurationSec: number;
  status: "draft" | "approved" | "frame_selected";
  notes: string | null;
  scriptVersion: number;
  updatedAt: string;
};

type Option = { id: string; name: string };
type Patch = Parameters<typeof updateShot>[1];

export function ShotsStep({
  projectId,
  shots,
  characters,
  locations,
  approvedScriptVersion,
  targetSec,
}: {
  projectId: string;
  shots: ShotView[];
  characters: Option[];
  locations: Option[];
  approvedScriptVersion: number | null;
  targetSec: number | null;
}) {
  const { jobs, refresh } = useProjectJobs();
  const generating = jobs.find((j) => j.type === "generate_shotlist" && isActive(j));
  const { pending, run } = useAction();

  // Orden local (optimista) mientras se arrastra; se resincroniza cuando llega data nueva del servidor.
  const [rows, setRows] = useState(shots);
  const [serverShots, setServerShots] = useState(shots);
  if (serverShots !== shots) {
    setServerShots(shots);
    setRows(shots);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    const next = arrayMove(rows, from, to);
    setRows(next);
    run(() => reorderShots(projectId, next.map((r) => r.id)));
  }

  const totalSec = rows.reduce((sum, r) => sum + r.estDurationSec, 0);
  const draftCount = rows.filter((r) => r.status === "draft").length;
  const allApproved = rows.length > 0 && draftCount === 0;
  const scriptVersion = rows[0]?.scriptVersion ?? null;
  const outdated = scriptVersion !== null && approvedScriptVersion !== null && scriptVersion !== approvedScriptVersion;

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-2">
        <div className="text-sm">
          <span className="font-medium">{rows.length} planos</span>
          <span className="text-muted-foreground">
            {" "}
            · {formatDuration(totalSec)}
            {targetSec ? ` de ${formatDuration(targetSec)} objetivo` : ""}
            {scriptVersion ? ` · guion v${scriptVersion}` : ""}
          </span>
        </div>
        {rows.length > 0 && (
          <span className={cn("text-xs", allApproved ? "text-emerald-500" : "text-muted-foreground")}>
            {allApproved ? "Shot list aprobado" : `${draftCount} sin aprobar`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {rows.length === 0 ? (
            <Button
              size="sm"
              disabled={!approvedScriptVersion || Boolean(generating) || pending}
              onClick={() => run(() => generateShotlist(projectId), { success: "Shot list en cola", onSuccess: refresh })}
            >
              <SparklesIcon />
              Generar shot list
            </Button>
          ) : (
            <>
              <ConfirmButton
                title={`¿Regenerar el shot list desde el guion v${approvedScriptVersion}?`}
                description="El shot list actual se reemplaza (queda en el historial). Los frames generados siguen asociados a los planos viejos."
                confirmLabel="Regenerar"
                onConfirm={() => run(() => generateShotlist(projectId), { success: "Shot list en cola", onSuccess: refresh })}
              >
                <Button size="sm" variant="outline" disabled={!approvedScriptVersion || Boolean(generating) || pending}>
                  <RefreshCwIcon />
                  Regenerar
                </Button>
              </ConfirmButton>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => insertShotAfter(projectId, null))}>
                <PlusIcon />
                Agregar plano
              </Button>
              {!allApproved && (
                <ConfirmButton
                  title="¿Aprobar el shot list?"
                  description={`Se aprueban los ${draftCount} planos pendientes y se habilita la etapa de frames.`}
                  confirmLabel="Aprobar shot list"
                  onConfirm={() =>
                    run(() => approveShotlist(projectId), { success: "Shot list aprobado" })
                  }
                >
                  <Button size="sm" disabled={pending}>
                    <CheckCircle2Icon />
                    Aprobar shot list
                  </Button>
                </ConfirmButton>
              )}
              {allApproved && (
                <Button asChild size="sm">
                  <Link href={`/projects/${projectId}/frames`}>
                    Frames
                    <ArrowRightIcon />
                  </Link>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {generating && (
        <div className="flex items-center gap-2 border-b bg-primary/5 px-6 py-2 text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          {(generating.progress as { message?: string } | null)?.message ?? "En cola"}…
        </div>
      )}
      {!approvedScriptVersion && (
        <Alert className="m-6 w-auto">
          <AlertDescription>
            Primero aprobá una versión del <Link href={`/projects/${projectId}/script`} className="underline">guion</Link>.
          </AlertDescription>
        </Alert>
      )}
      {outdated && (
        <Alert className="mx-6 mt-4 w-auto">
          <AlertDescription>
            Este shot list sale del guion v{scriptVersion}, pero el aprobado es el v{approvedScriptVersion}. Regeneralo si
            querés que lo siga.
          </AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <div className="flex-1 overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <table className="w-full min-w-[1400px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-background text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="w-14 px-2 py-2 font-medium">#</th>
                  <th className="w-36 px-2 py-2 font-medium">Encuadre</th>
                  <th className="w-40 px-2 py-2 font-medium">Personajes</th>
                  <th className="w-40 px-2 py-2 font-medium">Locación</th>
                  <th className="px-2 py-2 font-medium">Acción</th>
                  <th className="px-2 py-2 font-medium">Locución</th>
                  <th className="w-12 px-2 py-2 text-right font-medium">Dur.</th>
                  <th className="w-40 px-2 py-2 font-medium">Texto en pantalla</th>
                  <th className="w-40 px-2 py-2 font-medium">Iluminación</th>
                  <th className="w-48 px-2 py-2 font-medium">Notas</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {rows.map((shot, i) => (
                    <Fragment key={shot.id}>
                      {(i === 0 || rows[i - 1].sceneNumber !== shot.sceneNumber) && (
                        <SceneHeader shot={shot} />
                      )}
                      <ShotRow
                        shot={shot}
                        index={i}
                        isLast={i === rows.length - 1}
                        projectId={projectId}
                        characters={characters}
                        locations={locations}
                      />
                    </Fragment>
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>
      )}
    </div>
  );
}

function SceneHeader({ shot }: { shot: ShotView }) {
  const { run } = useAction();
  return (
    <tr className="bg-muted/40">
      <td colSpan={11} className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Escena {shot.sceneNumber}</span>
          <EditableText
            value={shot.sceneTitle}
            placeholder="Título de la escena"
            className="max-w-xl font-medium"
            onCommit={(v) => run(() => updateShot(shot.id, { scene_title: v || null }))}
          />
        </div>
      </td>
    </tr>
  );
}

function ShotRow({
  shot,
  index,
  isLast,
  projectId,
  characters,
  locations,
}: {
  shot: ShotView;
  index: number;
  isLast: boolean;
  projectId: string;
  characters: Option[];
  locations: Option[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  const { pending, run } = useAction();
  const save = (patch: Patch) => run(() => updateShot(shot.id, patch));
  const words = (shot.voLine ?? "").trim().split(/\s+/).filter(Boolean).length;

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("border-b align-top hover:bg-muted/20", isDragging && "relative z-20 bg-muted shadow-lg")}
    >
      <td className="px-1 py-1.5">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="cursor-grab rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label="Arrastrar para reordenar"
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 tabular-nums">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    shot.status === "draft" ? "bg-muted-foreground/50" : shot.status === "approved" ? "bg-emerald-500" : "bg-sky-500",
                  )}
                />
                {index + 1}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {shot.status === "draft" ? "Sin aprobar" : shot.status === "approved" ? "Aprobado" : "Frame elegido"}
            </TooltipContent>
          </Tooltip>
        </div>
      </td>
      <td className="px-1 py-1">
        <Select value={shot.framing} onValueChange={(v) => save({ framing: v as Framing })}>
          <SelectTrigger size="sm" className="h-7 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FRAMINGS.map((f) => (
              <SelectItem key={f} value={f}>
                {FRAMING_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-1 py-1">
        <CharacterPicker
          value={shot.characterIds}
          options={characters}
          onChange={(ids) => save({ character_ids: ids })}
        />
      </td>
      <td className="px-1 py-1">
        <Select value={shot.locationId ?? "none"} onValueChange={(v) => save({ location_id: v === "none" ? null : v })}>
          <SelectTrigger size="sm" className="h-7 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin locación</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-1 py-1">
        <EditableText value={shot.action} placeholder="Qué se ve" onCommit={(v) => save({ action: v || null })} />
      </td>
      <td className="px-1 py-1">
        <EditableText value={shot.voLine} placeholder="Sin locución" onCommit={(v) => save({ vo_line: v || null })} />
        {words > 0 && <div className="px-1.5 text-[10px] text-muted-foreground">{words} palabras</div>}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{shot.estDurationSec} s</td>
      <td className="px-1 py-1">
        <EditableText value={shot.onScreenText} placeholder="—" onCommit={(v) => save({ on_screen_text: v || null })} />
      </td>
      <td className="px-1 py-1">
        <EditableText value={shot.lighting} placeholder="—" onCommit={(v) => save({ lighting: v || null })} />
      </td>
      <td className="px-1 py-1">
        <EditableText value={shot.notes} placeholder="—" muted onCommit={(v) => save({ notes: v || null })} />
      </td>
      <td className="px-1 py-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="Acciones del plano" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => run(() => splitShot(shot.id), { success: "Plano dividido" })}>
              <ScissorsIcon />
              Dividir en dos
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onSelect={() => run(() => mergeWithNext(shot.id), { success: "Planos fusionados" })}>
              <MergeIcon />
              Fusionar con el siguiente
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => insertShotAfter(projectId, shot.id))}>
              <ListPlusIcon />
              Agregar plano debajo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => run(() => deleteShot(shot.id), { success: "Plano borrado" })}>
              <Trash2Icon />
              Borrar plano
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/** Texto editable en línea: guarda al salir del campo; mientras tiene foco no se pisa con datos del servidor. */
function EditableText({
  value,
  placeholder,
  onCommit,
  className,
  muted,
}: {
  value: string | null;
  placeholder?: string;
  onCommit: (value: string) => void;
  className?: string;
  muted?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  const [lastValue, setLastValue] = useState(value);
  if (!focused && lastValue !== value) {
    setLastValue(value);
    setDraft(value ?? "");
  }

  return (
    <Textarea
      value={draft}
      rows={1}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft.trim() !== (value ?? "").trim()) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "min-h-7 resize-none border-transparent bg-transparent px-1.5 py-1 text-xs shadow-none hover:border-input focus-visible:ring-1 md:text-xs dark:bg-transparent",
        muted && "text-muted-foreground",
        className,
      )}
    />
  );
}

function CharacterPicker({ value, options, onChange }: { value: string[]; options: Option[]; onChange: (ids: string[]) => void }) {
  const [selected, setSelected] = useState(value);
  const [open, setOpen] = useState(false);
  const names = value.map((id) => options.find((o) => o.id === id)?.name).filter(Boolean);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSelected(value);
        // Se guarda al cerrar, una sola vez, si hubo cambios.
        if (!next && (selected.length !== value.length || selected.some((id) => !value.includes(id)))) onChange(selected);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-7 w-full items-center justify-between gap-1 rounded-md border border-transparent px-1.5 py-1 text-left hover:border-input"
        >
          <span className={cn("line-clamp-2", names.length === 0 && "text-muted-foreground")}>
            {names.length ? names.join(", ") : "Nadie"}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
              <Checkbox
                checked={selected.includes(o.id)}
                onCheckedChange={(checked) =>
                  setSelected((s) => (checked ? [...s, o.id] : s.filter((x) => x !== o.id)))
                }
              />
              {o.name}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
