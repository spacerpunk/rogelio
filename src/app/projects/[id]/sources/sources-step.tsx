"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  ClipboardPasteIcon,
  FileTextIcon,
  Loader2Icon,
  PresentationIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { SOURCE_ACCEPT, SOURCE_KIND_LABEL, type SourceKind } from "@/lib/ingest/kinds";
import type { JobProgress } from "@/lib/jobs/types";
import type { ProjectJob } from "@/lib/projects/data";
import { uploadToSignedTarget } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import {
  createSourceUploadTarget,
  createTextSource,
  deleteSource,
  reextractSource,
  registerSource,
  retryJob,
  updateSourceText,
} from "../../actions";
import { isActive, useProjectJobs } from "../jobs-provider";

export type SourceView = {
  id: string;
  fileName: string;
  kind: SourceKind;
  hasFile: boolean;
  extractedText: string | null;
  extractedNotes: string | null;
  images: { path: string; url: string; thumbUrl: string }[];
};

type SourceStatus =
  | { state: "ready" }
  | { state: "working"; message: string }
  | { state: "error"; message: string; jobId: string }
  | { state: "pending" };

function sourceStatus(source: SourceView, jobs: ProjectJob[]): SourceStatus {
  const job = jobs.find(
    (j) => j.type === "extract_source" && (j.payload as { sourceId?: string } | null)?.sourceId === source.id,
  );
  if (job && isActive(job)) {
    const progress = job.progress as JobProgress | null;
    return { state: "working", message: job.status === "queued" ? "En cola" : (progress?.message ?? "Extrayendo") };
  }
  if (source.extractedText?.trim()) return { state: "ready" };
  if (job?.status === "error") return { state: "error", message: job.error ?? "Error desconocido", jobId: job.id };
  return { state: "pending" };
}

function KindIcon({ kind }: { kind: SourceKind }) {
  return kind === "pptx" ? <PresentationIcon className="size-4 shrink-0" /> : <FileTextIcon className="size-4 shrink-0" />;
}

export function SourcesStep({ projectId, sources }: { projectId: string; sources: SourceView[] }) {
  const { jobs } = useProjectJobs();
  const [selectedId, setSelectedId] = useState<string | null>(sources[0]?.id ?? null);
  const selected = sources.find((s) => s.id === selectedId) ?? sources[0] ?? null;
  const readyCount = sources.filter((s) => s.extractedText?.trim()).length;

  return (
    <div className="flex min-h-[calc(100svh-9.5rem)] flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-2">
        <UploadSourcesButton projectId={projectId} onUploaded={(id) => setSelectedId(id)} />
        <PasteTextDialog projectId={projectId} onCreated={(id) => setSelectedId(id)} />
        <span className="ml-2 text-xs text-muted-foreground">PDF, PPTX, DOCX, TXT o MD. Podés subir varios a la vez.</span>
        <div className="ml-auto">
          <Button asChild size="sm" variant={readyCount ? "default" : "outline"} disabled={!readyCount}>
            <Link href={`/projects/${projectId}/script`} aria-disabled={!readyCount}>
              Seguir al guion
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </div>
      {sources.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <UploadIcon className="size-8" />
          Subí el brief o la presentación del cliente para empezar.
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[20rem_1fr]">
          <ul className="border-r py-2">
            {sources.map((s) => {
              const status = sourceStatus(s, jobs);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      "flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-muted/60",
                      selected?.id === s.id && "bg-muted",
                    )}
                  >
                    <KindIcon kind={s.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{s.fileName}</span>
                      <StatusLine status={status} source={s} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <SourceEditor key={selected.id} source={selected} status={sourceStatus(selected, jobs)} />}
        </div>
      )}
    </div>
  );
}

function StatusLine({ status, source }: { status: SourceStatus; source: SourceView }) {
  switch (status.state) {
    case "ready":
      return (
        <span className="text-xs text-muted-foreground">
          {SOURCE_KIND_LABEL[source.kind]} · {(source.extractedText?.length ?? 0).toLocaleString("es-AR")} caracteres
          {source.images.length ? ` · ${source.images.length} imágenes` : ""}
        </span>
      );
    case "working":
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          {status.message}
        </span>
      );
    case "error":
      return <span className="line-clamp-2 text-xs text-destructive">{status.message}</span>;
    case "pending":
      return <span className="text-xs text-muted-foreground">Pendiente de extracción</span>;
  }
}

function SourceEditor({ source, status }: { source: SourceView; status: SourceStatus }) {
  const [fileName, setFileName] = useState(source.fileName);
  const [text, setText] = useState(source.extractedText ?? "");
  const [notes, setNotes] = useState(source.extractedNotes ?? "");
  const { pending, run } = useAction();
  const { refresh } = useProjectJobs();
  const dirty =
    fileName !== source.fileName || text !== (source.extractedText ?? "") || notes !== (source.extractedNotes ?? "");

  // Si llega texto nuevo del servidor (terminó una extracción) y no hay cambios locales, se adopta.
  const [serverText, setServerText] = useState(source.extractedText);
  if (serverText !== source.extractedText) {
    setServerText(source.extractedText);
    if (!dirty) {
      setText(source.extractedText ?? "");
      setNotes(source.extractedNotes ?? "");
    }
  }

  const showNotes = source.kind === "pptx" || Boolean(source.extractedNotes);

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Input value={fileName} onChange={(e) => setFileName(e.target.value)} className="h-8 max-w-md font-medium" />
        <Badge variant="outline">{SOURCE_KIND_LABEL[source.kind]}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {source.hasFile && (
            <ConfirmButton
              title="¿Volver a extraer?"
              description="Se reemplaza el texto extraído (y tus ediciones) por una extracción nueva del archivo original."
              confirmLabel="Reextraer"
              onConfirm={() => run(() => reextractSource(source.id), { success: "Extracción encolada", onSuccess: refresh })}
            >
              <Button size="sm" variant="outline" disabled={pending || status.state === "working"}>
                <RefreshCwIcon />
                Reextraer
              </Button>
            </ConfirmButton>
          )}
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() => run(() => updateSourceText({ sourceId: source.id, fileName, text, notes }), { success: "Guardado" })}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Guardar
          </Button>
          <ConfirmButton
            title="¿Quitar esta fuente?"
            description="Deja de usarse para el guion. Borrado lógico: el archivo se conserva."
            confirmLabel="Quitar"
            destructive
            onConfirm={() => run(() => deleteSource(source.id), { success: "Fuente quitada" })}
          >
            <Button size="icon-sm" variant="ghost" aria-label="Quitar fuente">
              <Trash2Icon />
            </Button>
          </ConfirmButton>
        </div>
      </div>
      {status.state === "error" && (
        <Alert variant="destructive" className="m-4 w-auto">
          <AlertCircleIcon />
          <AlertTitle>No se pudo extraer el contenido</AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={pending}
              onClick={() => run(() => retryJob(status.jobId), { success: "Reintentando", onSuccess: refresh })}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {status.state === "working" && !source.extractedText ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {status.message}…
        </div>
      ) : (
        <Tabs defaultValue="text" className="flex flex-1 flex-col gap-0">
          <TabsList variant="line" className="px-4">
            <TabsTrigger value="text">Texto extraído</TabsTrigger>
            {showNotes && <TabsTrigger value="notes">Notas del orador</TabsTrigger>}
            {source.images.length > 0 && <TabsTrigger value="images">Imágenes · {source.images.length}</TabsTrigger>}
          </TabsList>
          <TabsContent value="text" className="flex flex-1">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Todavía no hay texto."
              className="min-h-0 flex-1 resize-none rounded-none border-0 border-t px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
            />
          </TabsContent>
          {showNotes && (
            <TabsContent value="notes" className="flex flex-1">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="La presentación no tiene notas del orador."
                className="min-h-0 flex-1 resize-none rounded-none border-0 border-t px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
              />
            </TabsContent>
          )}
          {source.images.length > 0 && (
            <TabsContent value="images" className="border-t p-4">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
                {source.images.map((img) => (
                  <a key={img.path} href={img.url} target="_blank" rel="noreferrer" className="block rounded-md border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
                    <img src={img.thumbUrl} alt="" loading="lazy" className="aspect-video w-full object-contain" />
                    <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">
                      {img.path.split("/").pop()}
                    </span>
                  </a>
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </section>
  );
}

function UploadSourcesButton({ projectId, onUploaded }: { projectId: string; onUploaded: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const { refresh } = useProjectJobs();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const file of Array.from(files)) {
        setBusy(file.name);
        const target = await createSourceUploadTarget({ projectId, fileName: file.name });
        if (!target.ok) {
          toast.error(target.error);
          continue;
        }
        await uploadToSignedTarget("projects", target.data, file);
        const registered = await registerSource({
          projectId,
          fileName: file.name,
          path: target.data.path,
          mimeType: file.type,
        });
        if (!registered.ok) {
          toast.error(registered.error);
          continue;
        }
        onUploaded(registered.data);
      }
      router.refresh();
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={SOURCE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button size="sm" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        {busy ? `Subiendo ${busy}` : "Subir archivos"}
      </Button>
    </>
  );
}

function PasteTextDialog({ projectId, onCreated }: { projectId: string; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ClipboardPasteIcon />
          Pegar texto
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pegar texto como fuente</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="paste-title">Nombre</FieldLabel>
            <Input id="paste-title" value={title} placeholder="Ej.: Brief por mail" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="paste-text">Texto</FieldLabel>
            <Textarea id="paste-text" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => createTextSource({ projectId, title, text }), {
                success: "Texto agregado",
                onSuccess: (id) => {
                  onCreated(id);
                  setOpen(false);
                  setTitle("");
                  setText("");
                },
              })
            }
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
