"use client";

import { useState } from "react";
import { Loader2Icon, MapPinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { AssetView, LocationView } from "@/lib/library/data";
import { deleteLocation, saveLocation } from "../actions";
import { AssetPicker } from "./asset-picker";

const EMPTY: LocationView = { id: "", name: "", description: null, plateAssetIds: [] };

export function LocationsTab({
  clientId,
  locations,
  assets,
}: {
  clientId: string;
  locations: LocationView[];
  assets: AssetView[];
}) {
  const [editing, setEditing] = useState<LocationView | null>(null);
  const byId = new Map(assets.map((a) => [a.id, a]));

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          La descripción y las plates de la locación se adjuntan solas a los planos que ocurren ahí.
        </p>
        <Button size="sm" onClick={() => setEditing(EMPTY)}>
          <PlusIcon />
          Nueva locación
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
        {locations.map((l) => {
          const plate = l.plateAssetIds.map((id) => byId.get(id)).find((a) => a?.image);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setEditing(l)}
              className="overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-foreground/30"
            >
              <div className="flex aspect-video items-center justify-center bg-muted/40">
                {plate?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
                  <img src={plate.image.thumbUrl} alt={l.name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                    <MapPinIcon className="size-6" />
                    Sin plate
                  </div>
                )}
              </div>
              <div className="space-y-1 p-3">
                <span className="font-medium">{l.name}</span>
                <p className="line-clamp-2 text-xs text-muted-foreground">{l.description ?? "Sin descripción"}</p>
              </div>
            </button>
          );
        })}
      </div>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl">
          {editing && (
            <LocationEditor
              key={editing.id || "new"}
              clientId={clientId}
              location={editing}
              assets={assets}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LocationEditor({
  clientId,
  location,
  assets,
  onDone,
}: {
  clientId: string;
  location: LocationView;
  assets: AssetView[];
  onDone: () => void;
}) {
  const [form, setForm] = useState(location);
  const { pending, run } = useAction();

  return (
    <>
      <SheetHeader>
        <SheetTitle>{location.id ? location.name : "Nueva locación"}</SheetTitle>
        <SheetDescription>Se usa en el shot list y como referencia en los frames.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="l-name">Nombre</FieldLabel>
            <Input id="l-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="l-desc">Descripción visual</FieldLabel>
            <FieldDescription>En inglés, lista para el prompt de imagen.</FieldDescription>
            <Textarea
              id="l-desc"
              rows={6}
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="font-mono text-[13px]"
            />
          </Field>
          <Field>
            <FieldLabel>Location plates</FieldLabel>
            <AssetPicker
              clientId={clientId}
              kind="location_plate"
              assets={assets}
              selectedIds={form.plateAssetIds}
              onChange={(ids) => setForm({ ...form, plateAssetIds: ids })}
              uploadLabel="Subir plate"
            />
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="flex-row justify-between">
        {location.id ? (
          <ConfirmButton
            title={`¿Borrar ${location.name}?`}
            description="Borrado lógico: deja de aparecer en la biblioteca y en los planos nuevos."
            confirmLabel="Borrar"
            destructive
            onConfirm={() => run(() => deleteLocation(location.id), { success: "Locación borrada", onSuccess: onDone })}
          >
            <Button variant="ghost" size="sm">
              <Trash2Icon />
              Borrar
            </Button>
          </ConfirmButton>
        ) : (
          <span />
        )}
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () =>
                saveLocation({
                  id: form.id || undefined,
                  clientId,
                  name: form.name,
                  description: form.description ?? "",
                  plateAssetIds: form.plateAssetIds,
                }),
              { success: "Locación guardada", onSuccess: onDone },
            )
          }
        >
          {pending && <Loader2Icon className="animate-spin" />}
          Guardar
        </Button>
      </SheetFooter>
    </>
  );
}
