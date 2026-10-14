"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenIcon, CodeIcon, ExternalLinkIcon, Loader2Icon, PuzzleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { AssetView } from "@/lib/library/data";
import { kindLabel, type AssetKind } from "@/lib/library/kinds";
import type { PipelineStep, PromptPiece } from "@/lib/settings/steps";
import { cn } from "@/lib/utils";
import { createTextAsset } from "../clients/actions";
import { TextEditor, groupLineages, type Lineage } from "../clients/[id]/texts-tab";

/** El linaje que usa el pipeline: el que tiene la versión activa (o, si no hay, el último creado). */
function lineageFor(lineages: Lineage[], kind: AssetKind): Lineage | null {
  const ofKind = lineages.filter((l) => l.kind === kind);
  return ofKind.find((l) => l.active) ?? ofKind.at(-1) ?? null;
}

function hrefFor(clientId: string, step: string) {
  return `/settings?client=${clientId}&step=${step}`;
}

export function SettingsView({
  clients,
  clientId,
  steps,
  stepKey,
  assets,
}: {
  clients: { id: string; name: string }[];
  clientId: string;
  steps: PipelineStep[];
  stepKey: string;
  assets: AssetView[];
}) {
  const router = useRouter();
  const lineages = groupLineages(assets);
  const step = steps.find((s) => s.key === stepKey) ?? steps[0];

  return (
    <div className="grid min-h-[calc(100svh-7.5rem)] grid-cols-[19rem_1fr]">
      <aside className="border-r">
        <div className="space-y-1 px-4 py-3">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Cliente</div>
          <Select value={clientId} onValueChange={(id) => router.push(hrefFor(id, step.key))}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="px-4 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Pasos del pipeline</div>
        <nav className="pb-4">
          {steps.map((s, i) => (
            <Link
              key={s.key}
              href={hrefFor(clientId, s.key)}
              className={cn("block px-4 py-2 hover:bg-muted/60", s.key === step.key && "bg-muted")}
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="font-medium">{s.label}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 pl-4">
                {s.pieces
                  .filter((p) => p.role.startsWith("System"))
                  .map((p, j) => (
                    <PieceChip key={j} piece={p} lineages={lineages} />
                  ))}
              </div>
            </Link>
          ))}
        </nav>
      </aside>

      <section className="min-w-0">
        <div className="border-b px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{step.label}</h2>
            <Badge variant="outline">Pantalla: {step.where}</Badge>
            <Badge variant="outline">{step.engine}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{step.description}</p>
        </div>
        <ol className="space-y-4 px-6 py-4">
          {step.pieces.map((piece, i) => (
            <li key={`${step.key}-${i}`} className="overflow-hidden rounded-lg border">
              <PieceView index={i + 1} piece={piece} clientId={clientId} lineages={lineages} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function PieceChip({ piece, lineages }: { piece: PromptPiece; lineages: Lineage[] }) {
  if (piece.type === "library") {
    const lineage = lineageFor(lineages, piece.kind);
    const active = lineage?.active;
    return (
      <span
        className={cn(
          "max-w-full truncate rounded px-1.5 py-0.5 text-[11px]",
          active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        )}
      >
        {active ? `${active.title} · v${active.version}` : `Sin ${kindLabel(piece.kind).toLowerCase()}`}
      </span>
    );
  }
  return <span className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{piece.title} · interno</span>;
}

function PieceHeader({ index, role, icon, title, badge }: { index: number; role: string; icon: React.ReactNode; title: string; badge: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground tabular-nums">{index}</span>
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{role}</span>
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-sm font-medium">{title}</span>
      {badge}
    </div>
  );
}

function PieceView({ index, piece, clientId, lineages }: { index: number; piece: PromptPiece; clientId: string; lineages: Lineage[] }) {
  if (piece.type === "internal") {
    return (
      <>
        <PieceHeader
          index={index}
          role={piece.role}
          icon={<CodeIcon className="size-3.5" />}
          title={piece.title}
          badge={<Badge variant="secondary">Interno de la app · {piece.source}</Badge>}
        />
        {piece.note && <p className="px-3 pt-2 text-xs text-muted-foreground">{piece.note}</p>}
        <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{piece.content}</pre>
      </>
    );
  }

  if (piece.type === "assembled") {
    return (
      <>
        <PieceHeader
          index={index}
          role={piece.role}
          icon={<PuzzleIcon className="size-3.5" />}
          title={piece.title}
          badge={<Badge variant="secondary">Lo arma la app en cada llamada</Badge>}
        />
        <p className="px-3 py-2 text-xs text-muted-foreground">{piece.note}</p>
      </>
    );
  }

  const lineage = lineageFor(lineages, piece.kind);
  return (
    <>
      <PieceHeader
        index={index}
        role={piece.role}
        icon={<BookOpenIcon className="size-3.5" />}
        title={kindLabel(piece.kind)}
        badge={
          <>
            <Badge variant="outline">Biblioteca del cliente</Badge>
            <Link
              href={`/clients/${clientId}?tab=texts`}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Ver en biblioteca
              <ExternalLinkIcon className="size-3" />
            </Link>
          </>
        }
      />
      {piece.note && <p className="px-3 pt-2 text-xs text-muted-foreground">{piece.note}</p>}
      {lineage ? (
        <>
          {!lineage.active && (
            <p className="mx-3 mt-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
              Ninguna versión está en uso: el paso corre sin este texto. Elegí una versión y tocá «Usar esta versión».
            </p>
          )}
          <div className="mt-2 flex h-[30rem] border-t">
            <TextEditor key={lineage.lineageId} lineage={lineage} />
          </div>
        </>
      ) : (
        <NewLibraryText clientId={clientId} kind={piece.kind} />
      )}
    </>
  );
}

function NewLibraryText({ clientId, kind }: { clientId: string; kind: AssetKind }) {
  const [title, setTitle] = useState(kindLabel(kind));
  const [content, setContent] = useState("");
  const { pending, run } = useAction();
  return (
    <div className="space-y-2 p-3">
      <p className="text-xs text-amber-600 dark:text-amber-400">El cliente no tiene este texto: el paso corre sin él (o falla si es obligatorio).</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 max-w-md" />
      <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} className="font-mono text-[13px]" placeholder="Pegá el texto acá" />
      <Button
        size="sm"
        disabled={pending || !content.trim()}
        onClick={() => run(() => createTextAsset({ clientId, kind, title, content }), { success: "Texto creado y en uso" })}
      >
        {pending && <Loader2Icon className="animate-spin" />}
        Crear
      </Button>
    </div>
  );
}
