"use client";

import { ExternalLinkIcon, Trash2Icon } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import type { AssetView } from "@/lib/library/data";
import { IMAGE_KINDS, kindLabel, type AssetKind } from "@/lib/library/kinds";
import { activateAsset, deactivateAsset, deleteAsset } from "../actions";
import { UploadImagesButton } from "./upload-images-button";

const HINTS: Partial<Record<AssetKind, string>> = {
  ppe_sheet: "Las hojas de EPP activas se adjuntan a todos los frames.",
  logo: "Queda en la biblioteca como referencia; no se adjunta automáticamente a los frames.",
  character_sheet: "Se asignan a cada personaje desde la pestaña Personajes.",
  location_plate: "Se asignan a cada locación desde la pestaña Locaciones.",
};

export function ReferencesTab({ clientId, assets }: { clientId: string; assets: AssetView[] }) {
  const images = assets.filter((a) => a.storagePath);

  return (
    <div className="space-y-8 p-6">
      {IMAGE_KINDS.map((kind) => {
        const items = images.filter((a) => a.kind === kind);
        return (
          <section key={kind}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">
                  {kindLabel(kind)} <span className="text-muted-foreground">· {items.length}</span>
                </h2>
                {HINTS[kind] && <p className="text-xs text-muted-foreground">{HINTS[kind]}</p>}
              </div>
              <UploadImagesButton clientId={clientId} kind={kind} label="Subir" />
            </div>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                Sin imágenes.
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
                {items.map((a) => (
                  <ImageCard key={a.id} asset={a} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ImageCard({ asset }: { asset: AssetView }) {
  const { pending, run } = useAction();

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <a href={asset.image?.url} target="_blank" rel="noreferrer" className="block bg-muted/40">
        {asset.image && (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
          <img src={asset.image.thumbUrl} alt={asset.title} loading="lazy" className="aspect-[3/2] w-full object-contain" />
        )}
      </a>
      <div className="flex items-center gap-2 p-2">
        <span className="min-w-0 flex-1 truncate text-xs" title={asset.title}>
          {asset.title}
        </span>
        <Switch
          size="sm"
          checked={asset.isActive}
          disabled={pending}
          aria-label="Activa"
          onCheckedChange={(v) => run(() => (v ? activateAsset(asset.id) : deactivateAsset(asset.id)))}
        />
        <Button asChild size="icon-xs" variant="ghost" aria-label="Abrir original">
          <a href={asset.image?.url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon />
          </a>
        </Button>
        <ConfirmButton
          title="¿Borrar esta imagen?"
          description="Borrado lógico. También se quita de los personajes o locaciones que la usan."
          confirmLabel="Borrar"
          destructive
          onConfirm={() => run(() => deleteAsset(asset.id), { success: "Imagen borrada" })}
        >
          <Button size="icon-xs" variant="ghost" aria-label="Borrar">
            <Trash2Icon />
          </Button>
        </ConfirmButton>
      </div>
    </div>
  );
}
