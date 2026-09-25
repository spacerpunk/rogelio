"use client";

import { useState } from "react";
import { Loader2Icon, PlusIcon, ShieldAlertIcon, ShieldCheckIcon, Trash2Icon, UserIcon } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { AssetView, CharacterView } from "@/lib/library/data";
import { deleteCharacter, saveCharacter } from "../actions";
import { AssetPicker } from "./asset-picker";

const EMPTY: CharacterView = {
  id: "",
  name: "",
  role: null,
  description: null,
  visualNotes: null,
  sheetAssetIds: [],
  basedOnRealPerson: false,
  consentConfirmed: false,
};

export function CharactersTab({
  clientId,
  characters,
  assets,
}: {
  clientId: string;
  characters: CharacterView[];
  assets: AssetView[];
}) {
  const [editing, setEditing] = useState<CharacterView | null>(null);
  const byId = new Map(assets.map((a) => [a.id, a]));

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          El descriptor visual y las sheets de cada personaje se adjuntan solos a los planos donde aparece.
        </p>
        <Button size="sm" onClick={() => setEditing(EMPTY)}>
          <PlusIcon />
          Nuevo personaje
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {characters.map((c) => {
          const sheet = c.sheetAssetIds.map((id) => byId.get(id)).find((a) => a?.image);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c)}
              className="overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-foreground/30"
            >
              <div className="flex aspect-[3/2] items-center justify-center bg-muted/40">
                {sheet?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
                  <img src={sheet.image.thumbUrl} alt={c.name} loading="lazy" className="h-full w-full object-contain" />
                ) : (
                  <UserIcon className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-1 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.sheetAssetIds.length > 1 && (
                    <Badge variant="secondary">{c.sheetAssetIds.length} sheets</Badge>
                  )}
                  <LikenessBadge character={c} />
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {c.role ? `${c.role} · ` : ""}
                  {c.description ?? "Sin descripción"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl">
          {editing && (
            <CharacterEditor
              key={editing.id || "new"}
              clientId={clientId}
              character={editing}
              assets={assets}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LikenessBadge({ character }: { character: CharacterView }) {
  if (!character.basedOnRealPerson) return null;
  return character.consentConfirmed ? (
    <ShieldCheckIcon className="size-3.5 text-emerald-500" aria-label="Persona real, consentimiento confirmado" />
  ) : (
    <ShieldAlertIcon className="size-3.5 text-amber-500" aria-label="Persona real, falta consentimiento" />
  );
}

function CharacterEditor({
  clientId,
  character,
  assets,
  onDone,
}: {
  clientId: string;
  character: CharacterView;
  assets: AssetView[];
  onDone: () => void;
}) {
  const [form, setForm] = useState(character);
  const { pending, run } = useAction();
  const set = <K extends keyof CharacterView>(key: K, value: CharacterView[K]) => setForm((f) => ({ ...f, [key]: value }));

  function save() {
    run(
      () =>
        saveCharacter({
          id: form.id || undefined,
          clientId,
          name: form.name,
          role: form.role ?? "",
          description: form.description ?? "",
          visualNotes: form.visualNotes ?? "",
          sheetAssetIds: form.sheetAssetIds,
          basedOnRealPerson: form.basedOnRealPerson,
          consentConfirmed: form.consentConfirmed,
        }),
      { success: "Personaje guardado", onSuccess: onDone },
    );
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{character.id ? character.name : "Nuevo personaje"}</SheetTitle>
        <SheetDescription>Los datos se usan en el guion, el shot list y los prompts de imagen.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4">
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="c-name">Nombre</FieldLabel>
              <Input id="c-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-role">Rol</FieldLabel>
              <Input
                id="c-role"
                value={form.role ?? ""}
                placeholder="Ej.: operador de campo"
                onChange={(e) => set("role", e.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="c-desc">Descripción</FieldLabel>
            <Textarea id="c-desc" rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-visual">Descriptor visual</FieldLabel>
            <FieldDescription>En inglés. Va textual en cada prompt de imagen donde aparece el personaje.</FieldDescription>
            <Textarea
              id="c-visual"
              rows={6}
              value={form.visualNotes ?? ""}
              onChange={(e) => set("visualNotes", e.target.value)}
              className="font-mono text-[13px]"
            />
          </Field>
          <div className="space-y-3 rounded-md border p-3">
            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={form.basedOnRealPerson}
                onCheckedChange={(v) => setForm((f) => ({ ...f, basedOnRealPerson: v, consentConfirmed: v && f.consentConfirmed }))}
              />
              Basado en una persona real (likeness)
            </label>
            {form.basedOnRealPerson && (
              <label className="flex items-center gap-3 text-sm">
                <Checkbox checked={form.consentConfirmed} onCheckedChange={(v) => set("consentConfirmed", v === true)} />
                Consentimiento firmado y confirmado
              </label>
            )}
            {form.basedOnRealPerson && !form.consentConfirmed && (
              <p className="text-xs text-amber-500">Sin consentimiento confirmado no se generan frames con este personaje.</p>
            )}
          </div>
          <Field>
            <FieldLabel>Character sheets</FieldLabel>
            <AssetPicker
              clientId={clientId}
              kind="character_sheet"
              assets={assets}
              selectedIds={form.sheetAssetIds}
              onChange={(ids) => set("sheetAssetIds", ids)}
              uploadLabel="Subir sheet"
            />
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="flex-row justify-between">
        {character.id ? (
          <ConfirmButton
            title={`¿Borrar a ${character.name}?`}
            description="Borrado lógico: deja de aparecer en la biblioteca y en los planos nuevos."
            confirmLabel="Borrar"
            destructive
            onConfirm={() => run(() => deleteCharacter(character.id), { success: "Personaje borrado", onSuccess: onDone })}
          >
            <Button variant="ghost" size="sm">
              <Trash2Icon />
              Borrar
            </Button>
          </ConfirmButton>
        ) : (
          <span />
        )}
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          Guardar
        </Button>
      </SheetFooter>
    </>
  );
}
