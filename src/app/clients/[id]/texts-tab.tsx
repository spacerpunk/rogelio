"use client";

import { useMemo, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { AssetView } from "@/lib/library/data";
import { ASSET_KINDS, TEXT_KINDS, kindLabel, type AssetKind } from "@/lib/library/kinds";
import { cn } from "@/lib/utils";
import { activateAsset, createTextAsset, deactivateAsset, deleteAsset, saveTextVersion } from "../actions";

type Lineage = { lineageId: string; kind: AssetKind; versions: AssetView[]; latest: AssetView; active: AssetView | null };

function groupLineages(assets: AssetView[]): Lineage[] {
  const map = new Map<string, AssetView[]>();
  for (const a of assets) {
    if (a.textContent === null) continue;
    map.set(a.lineageId, [...(map.get(a.lineageId) ?? []), a]);
  }
  return [...map.entries()].map(([lineageId, versions]) => {
    const sorted = versions.sort((a, b) => b.version - a.version);
    return {
      lineageId,
      kind: sorted[0].kind,
      versions: sorted,
      latest: sorted[0],
      active: sorted.find((v) => v.isActive) ?? null,
    };
  });
}

export function TextsTab({ clientId, assets }: { clientId: string; assets: AssetView[] }) {
  const lineages = useMemo(() => groupLineages(assets), [assets]);
  const [selectedId, setSelectedId] = useState<string | null>(lineages[0]?.lineageId ?? null);
  const selected = lineages.find((l) => l.lineageId === selectedId) ?? lineages[0] ?? null;

  return (
    <div className="grid min-h-[calc(100svh-9rem)] grid-cols-[18rem_1fr]">
      <aside className="border-r">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Textos</span>
          <NewTextDialog clientId={clientId} onCreated={setSelectedId} />
        </div>
        <nav className="pb-4">
          {TEXT_KINDS.map((kind) => {
            const items = lineages.filter((l) => l.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="mb-2">
                <div className="px-4 py-1 text-xs text-muted-foreground">{kindLabel(kind)}</div>
                {items.map((l) => (
                  <button
                    key={l.lineageId}
                    type="button"
                    onClick={() => setSelectedId(l.lineageId)}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-muted/60",
                      selected?.lineageId === l.lineageId && "bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{l.latest.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">v{l.latest.version}</span>
                    {l.active && <CheckCircle2Icon className="size-3.5 text-emerald-500" aria-label="Activo" />}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      {selected ? (
        <TextEditor key={selected.lineageId} lineage={selected} />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">No hay textos cargados.</p>
      )}
    </div>
  );
}

function TextEditor({ lineage }: { lineage: Lineage }) {
  const [versionId, setVersionId] = useState(lineage.latest.id);
  const version = lineage.versions.find((v) => v.id === versionId) ?? lineage.latest;
  const [title, setTitle] = useState(version.title);
  const [content, setContent] = useState(version.textContent ?? "");
  const { pending, run } = useAction();
  const dirty = title !== version.title || content !== (version.textContent ?? "");
  const singular = ASSET_KINDS[lineage.kind].singular;

  function selectVersion(id: string) {
    const v = lineage.versions.find((x) => x.id === id);
    if (!v) return;
    setVersionId(id);
    setTitle(v.title);
    setContent(v.textContent ?? "");
  }

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 max-w-md font-medium" />
        <Badge variant="outline">{kindLabel(lineage.kind)}</Badge>
        {version.isActive ? (
          <Badge className="bg-emerald-500/15 text-emerald-500">En uso</Badge>
        ) : (
          <Badge variant="secondary">Inactiva</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Select value={version.id} onValueChange={selectVersion}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lineage.versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  Versión {v.version}
                  {v.isActive ? " · en uso" : ""} · {new Date(v.createdAt).toLocaleDateString("es-AR")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!version.isActive && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => activateAsset(version.id), { success: "Versión en uso" })}
            >
              Usar esta versión
            </Button>
          )}
          {version.isActive && !singular && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => deactivateAsset(version.id))}>
              Desactivar
            </Button>
          )}
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() =>
              run(() => saveTextVersion({ assetId: version.id, title, content }), {
                success: "Guardado como versión nueva",
                onSuccess: (id) => setVersionId(id),
              })
            }
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Guardar versión {lineage.latest.version + 1}
          </Button>
          <ConfirmButton
            title="¿Borrar este texto?"
            description="Se borran todas sus versiones (borrado lógico, se puede recuperar desde la base)."
            confirmLabel="Borrar"
            destructive
            onConfirm={() => run(() => deleteAsset(version.id), { success: "Texto borrado" })}
          >
            <Button size="icon-sm" variant="ghost" aria-label="Borrar">
              <Trash2Icon />
            </Button>
          </ConfirmButton>
        </div>
      </div>
      {version.id !== lineage.latest.id && (
        <p className="border-b bg-amber-500/10 px-4 py-1.5 text-xs text-amber-500">
          Estás viendo la versión {version.version}. Si guardás, se crea la versión {lineage.latest.version + 1} con este
          contenido.
        </p>
      )}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none rounded-none border-0 px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0"
      />
    </section>
  );
}

function NewTextDialog({ clientId, onCreated }: { clientId: string; onCreated: (lineageId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssetKind>("reference_other");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Nuevo texto">
          <PlusIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo texto</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Tipo</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as AssetKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEXT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="text-title">Título</FieldLabel>
              <Input id="text-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="text-content">Contenido</FieldLabel>
            <Textarea
              id="text-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              className="font-mono text-[13px]"
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => createTextAsset({ clientId, kind, title, content }), {
                success: "Texto creado",
                onSuccess: (lineageId) => {
                  onCreated(lineageId);
                  setOpen(false);
                  setTitle("");
                  setContent("");
                },
              })
            }
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
