"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  EyeIcon,
  Loader2Icon,
  PencilIcon,
  SaveIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  EXPERIENCE_LEVELS,
  INCLUDE_OPTIONS,
  TONES,
  scriptStats,
  targetShotCount,
  type ScriptParams,
} from "@/lib/pipeline/script";
import { formatDuration } from "@/lib/projects/data";
import { cn } from "@/lib/utils";
import { isActive, useProjectJobs } from "../jobs-provider";
import { approveScript, generateScript, regenerateScript, saveScriptVersion } from "./actions";

export type ScriptVersion = {
  id: string;
  version: number;
  content: string;
  approved: boolean;
  createdAt: string;
  params: Record<string, unknown>;
};

type CharacterOption = { id: string; name: string; role: string | null };

export function ScriptStep({
  projectId,
  versions,
  characters,
  initialParams,
  hasSources,
  shotListVersion,
}: {
  projectId: string;
  versions: ScriptVersion[];
  characters: CharacterOption[];
  initialParams: ScriptParams;
  hasSources: boolean;
  shotListVersion: number | null;
}) {
  const { jobs, refresh } = useProjectJobs();
  const generating = jobs.find((j) => j.type === "generate_script" && isActive(j));
  const [params, setParams] = useState(initialParams);
  const [versionNumber, setVersionNumber] = useState(versions[0]?.version ?? null);
  const current = versions.find((v) => v.version === versionNumber) ?? versions[0] ?? null;

  // Cuando llega una versión nueva (generada o guardada) se muestra.
  const [latestSeen, setLatestSeen] = useState(versions[0]?.version ?? null);
  if ((versions[0]?.version ?? null) !== latestSeen) {
    setLatestSeen(versions[0]?.version ?? null);
    setVersionNumber(versions[0]?.version ?? null);
  }

  return (
    <div className="grid min-h-[calc(100svh-9.5rem)] grid-cols-[22rem_1fr]">
      <ParamsPanel
        projectId={projectId}
        params={params}
        onChange={setParams}
        characters={characters}
        disabled={Boolean(generating) || !hasSources}
        hasVersions={versions.length > 0}
        hasSources={hasSources}
        onQueued={refresh}
      />
      <section className="flex min-w-0 flex-col">
        {generating && <GeneratingBanner startedAt={generating.created_at} message={(generating.progress as { message?: string } | null)?.message} />}
        {current ? (
          <ScriptEditor
            key={current.id}
            projectId={projectId}
            script={current}
            versions={versions}
            onSelectVersion={setVersionNumber}
            params={params}
            busy={Boolean(generating)}
            shotListVersion={shotListVersion}
            onQueued={refresh}
          />
        ) : (
          !generating && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <SparklesIcon className="size-8" />
              <p>Todavía no hay guion.</p>
              <p className="max-w-sm">
                Completá los parámetros de la izquierda y generalo: Claude usa las fuentes, la style bible y el master
                prompt del cliente.
              </p>
            </div>
          )
        )}
      </section>
    </div>
  );
}

function GeneratingBanner({ startedAt, message }: { startedAt: string; message?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  return (
    <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm">
      <Loader2Icon className="size-4 animate-spin" />
      {message ?? "En cola"}… <span className="text-muted-foreground tabular-nums">{formatDuration(elapsed)}</span>
      <span className="text-xs text-muted-foreground">Un guion largo puede tardar varios minutos.</span>
    </div>
  );
}

function ParamsPanel({
  projectId,
  params,
  onChange,
  characters,
  disabled,
  hasVersions,
  hasSources,
  onQueued,
}: {
  projectId: string;
  params: ScriptParams;
  onChange: (p: ScriptParams) => void;
  characters: CharacterOption[];
  disabled: boolean;
  hasVersions: boolean;
  hasSources: boolean;
  onQueued: () => void;
}) {
  const { pending, run } = useAction();
  const set = <K extends keyof ScriptParams>(key: K, value: ScriptParams[K]) => onChange({ ...params, [key]: value });
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <aside className="flex flex-col border-r">
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup className="gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="sp-min">Duración (min)</FieldLabel>
              <Input
                id="sp-min"
                type="number"
                min={0.5}
                step={0.5}
                value={params.targetMinutes}
                onChange={(e) => set("targetMinutes", Number(e.target.value))}
              />
            </Field>
            <Field>
              <FieldLabel>Tono</FieldLabel>
              <Select value={params.tone} onValueChange={(v) => set("tone", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">≈ {targetShotCount(params.targetMinutes || 1)} tomas de 3 a 6 s</p>
          <Field>
            <FieldLabel htmlFor="sp-aud">Público</FieldLabel>
            <Input
              id="sp-aud"
              value={params.audience}
              placeholder="Ej.: choferes de cisterna y operarios de campo"
              onChange={(e) => set("audience", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Experiencia previa</FieldLabel>
            <Select value={params.experience} onValueChange={(v) => set("experience", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPERIENCE_LEVELS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="sp-obj">Objetivo del curso</FieldLabel>
            <Textarea
              id="sp-obj"
              rows={2}
              value={params.objective}
              placeholder="Qué comportamiento queremos lograr"
              onChange={(e) => set("objective", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sp-lang">Idioma de la locución</FieldLabel>
            <Input id="sp-lang" value={params.language} onChange={(e) => set("language", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Incluir</FieldLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {INCLUDE_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-xs">
                  <Checkbox checked={params.include.includes(opt)} onCheckedChange={() => set("include", toggle(params.include, opt))} />
                  {opt}
                </label>
              ))}
            </div>
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel>Personajes disponibles</FieldLabel>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  set("characterIds", params.characterIds.length === characters.length ? [] : characters.map((c) => c.id))
                }
              >
                {params.characterIds.length === characters.length ? "Ninguno" : "Todos"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {characters.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs" title={c.role ?? undefined}>
                  <Checkbox
                    checked={params.characterIds.includes(c.id)}
                    onCheckedChange={() => set("characterIds", toggle(params.characterIds, c.id))}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="sp-extra">Indicaciones adicionales</FieldLabel>
            <Textarea
              id="sp-extra"
              rows={3}
              value={params.extra}
              placeholder="Ej.: arrancar con un casi-accidente; protagonista Tomás"
              onChange={(e) => set("extra", e.target.value)}
            />
          </Field>
        </FieldGroup>
      </div>
      <div className="border-t p-4">
        {!hasSources && <p className="mb-2 text-xs text-amber-500">Primero cargá una fuente con texto.</p>}
        <Button
          className="w-full"
          disabled={disabled || pending}
          onClick={() => run(() => generateScript({ projectId, params }), { success: "Guion en cola", onSuccess: onQueued })}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {hasVersions ? "Generar versión nueva desde cero" : "Generar guion"}
        </Button>
      </div>
    </aside>
  );
}

function ScriptEditor({
  projectId,
  script,
  versions,
  onSelectVersion,
  params,
  busy,
  shotListVersion,
  onQueued,
}: {
  projectId: string;
  script: ScriptVersion;
  versions: ScriptVersion[];
  onSelectVersion: (v: number) => void;
  params: ScriptParams;
  busy: boolean;
  shotListVersion: number | null;
  onQueued: () => void;
}) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [content, setContent] = useState(script.content);
  const { pending, run } = useAction();
  const dirty = content !== script.content;
  const stats = useMemo(() => scriptStats(content), [content]);
  const latest = versions[0].version;
  const approvedVersion = versions.find((v) => v.approved)?.version ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Select value={String(script.version)} onValueChange={(v) => onSelectVersion(Number(v))}>
          <SelectTrigger size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.id} value={String(v.version)}>
                Versión {v.version}
                {v.approved ? " · aprobada" : ""}
                {v.params.manual ? " · edición manual" : ""} · {new Date(v.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {script.approved ? (
          <Badge className="bg-emerald-500/15 text-emerald-500">
            <CheckCircle2Icon />
            Aprobada
          </Badge>
        ) : (
          <Badge variant="secondary">Borrador</Badge>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {stats.shots} tomas · {formatDuration(stats.seconds)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button size="xs" variant={mode === "preview" ? "secondary" : "ghost"} onClick={() => setMode("preview")}>
              <EyeIcon />
              Vista
            </Button>
            <Button size="xs" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}>
              <PencilIcon />
              Editar
            </Button>
          </div>
          {dirty && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => saveScriptVersion({ projectId, baseVersion: script.version, content }), {
                  success: `Guardado como versión ${latest + 1}`,
                })
              }
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              Guardar versión {latest + 1}
            </Button>
          )}
          <RegenerateDialog
            projectId={projectId}
            baseVersion={script.version}
            params={params}
            disabled={busy || dirty}
            onQueued={onQueued}
          />
          {!script.approved && (
            <ConfirmButton
              title={`¿Aprobar la versión ${script.version}?`}
              description="El shot list se genera a partir del guion aprobado. Podés aprobar otra versión más adelante."
              confirmLabel="Aprobar guion"
              onConfirm={() => run(() => approveScript({ projectId, version: script.version }), { success: "Guion aprobado" })}
            >
              <Button size="sm" variant="outline" disabled={pending || dirty}>
                <CheckCircle2Icon />
                Aprobar guion
              </Button>
            </ConfirmButton>
          )}
          {approvedVersion && (
            <Button asChild size="sm">
              <Link href={`/projects/${projectId}/shots`}>
                Shot list
                <ArrowRightIcon />
              </Link>
            </Button>
          )}
        </div>
      </div>
      {script.version !== latest && !dirty && (
        <p className="border-b bg-amber-500/10 px-4 py-1.5 text-xs text-amber-500">
          Estás viendo la versión {script.version}; la última es la {latest}.
        </p>
      )}
      {shotListVersion !== null && approvedVersion !== null && shotListVersion !== approvedVersion && (
        <Alert className="m-4 w-auto">
          <AlertDescription>
            El shot list actual se generó con la versión {shotListVersion} y la aprobada es la {approvedVersion}.
            Regeneralo desde la etapa Shot list si querés que siga al guion nuevo.
          </AlertDescription>
        </Alert>
      )}
      {mode === "edit" ? (
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-none border-0 px-6 py-4 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
        />
      ) : (
        <div className={cn("markdown max-w-4xl flex-1 overflow-y-auto px-8 py-6")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </>
  );
}

function RegenerateDialog({
  projectId,
  baseVersion,
  params,
  disabled,
  onQueued,
}: {
  projectId: string;
  baseVersion: number;
  params: ScriptParams;
  disabled: boolean;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <WandSparklesIcon />
          Regenerar con indicaciones
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Regenerar desde la versión {baseVersion}</DialogTitle>
          <DialogDescription>Claude reescribe el guion aplicando tus indicaciones. Se crea una versión nueva.</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={6}
          autoFocus
          value={instructions}
          placeholder="Ej.: acortá la escena 2, sumá un error frecuente con la puesta a tierra y usá a Norma en vez de Beatriz"
          onChange={(e) => setInstructions(e.target.value)}
        />
        <DialogFooter>
          <Button
            disabled={pending || !instructions.trim()}
            onClick={() =>
              run(() => regenerateScript({ projectId, baseVersion, instructions, params }), {
                success: "Regeneración en cola",
                onSuccess: () => {
                  setOpen(false);
                  setInstructions("");
                  onQueued();
                },
              })
            }
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Regenerar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
