"use client";

import { CheckIcon } from "lucide-react";
import type { AssetView } from "@/lib/library/data";
import type { AssetKind } from "@/lib/library/kinds";
import { cn } from "@/lib/utils";
import { UploadImagesButton } from "./upload-images-button";

/** Grilla de imágenes de un tipo para asignar a un personaje o locación, con subida directa. */
export function AssetPicker({
  clientId,
  kind,
  assets,
  selectedIds,
  onChange,
  uploadLabel,
}: {
  clientId: string;
  kind: AssetKind;
  assets: AssetView[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  uploadLabel: string;
}) {
  const options = assets.filter((a) => a.kind === kind && a.image);
  // Primero las asignadas (en su orden), después el resto.
  const ordered = [
    ...selectedIds.flatMap((id) => options.filter((a) => a.id === id)),
    ...options.filter((a) => !selectedIds.includes(a.id)),
  ];

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selectedIds.length} asignada{selectedIds.length === 1 ? "" : "s"} · click para asignar o quitar
        </span>
        <UploadImagesButton
          clientId={clientId}
          kind={kind}
          label={uploadLabel}
          onUploaded={(ids) => onChange([...selectedIds, ...ids])}
        />
      </div>
      {ordered.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          Todavía no hay imágenes de este tipo.
        </p>
      ) : (
        <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {ordered.map((a) => {
            const selected = selectedIds.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className={cn(
                  "group relative overflow-hidden rounded-md border bg-muted/40 text-left",
                  selected ? "border-primary ring-2 ring-primary/40" : "opacity-60 hover:opacity-100",
                )}
                title={a.title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage */}
                <img src={a.image!.thumbUrl} alt={a.title} loading="lazy" className="aspect-[3/2] w-full object-contain" />
                <span className="block truncate px-1.5 py-1 text-[11px]">{a.title}</span>
                {selected && (
                  <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <CheckIcon className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
