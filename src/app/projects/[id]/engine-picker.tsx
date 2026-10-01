"use client";

import { useOptimistic } from "react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { modelName } from "@/lib/engines/model-names";
import type { EngineInfo } from "@/lib/engines/registry";
import { IMAGE_SIZES } from "@/lib/engines/types";
import { ASPECT_RATIOS } from "@/lib/projects/data";
import { setProjectEngines } from "../actions";

type Settings = { text: string; image: string; imageModel: string; imageSize: string; aspectRatio: string };

/** "Claude (Anthropic)" → "Claude", para el resumen del encabezado. */
function shortLabel(engines: EngineInfo[], name: string): string {
  return engines.find((e) => e.name === name)?.label.replace(/ \(.*?\)/, "") ?? name;
}

function EngineSelect({
  id,
  engines,
  value,
  disabled,
  onChange,
}: {
  id: string;
  engines: EngineInfo[];
  value: string;
  disabled: boolean;
  onChange: (name: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {engines.map((e) => (
          <SelectItem key={e.name} value={e.name} disabled={!e.configured && e.name !== value}>
            {e.label}
            <span className="text-muted-foreground">{e.configured ? ` · ${e.model}` : " · sin configurar"}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OptionSelect({
  id,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Motores del proyecto: texto (PDFs, guion, shot list, prompts) e imagen (motor, modelo, resolución, formato). */
export function EnginePicker({
  projectId,
  textEngines,
  imageEngines,
  settings: saved,
}: {
  projectId: string;
  textEngines: EngineInfo[];
  imageEngines: EngineInfo[];
  settings: Settings;
}) {
  const { pending, run } = useAction();
  const [settings, setOptimistic] = useOptimistic(saved);
  const imageEngine = imageEngines.find((e) => e.name === settings.image);
  const missing = [
    ...textEngines.filter((e) => e.name === settings.text && !e.configured),
    ...(imageEngine && !imageEngine.configured ? [imageEngine] : []),
  ];
  // El modelo guardado puede no estar ya en .env.local: se muestra igual para que se vea qué falta.
  const models = imageEngine?.models.includes(settings.imageModel)
    ? imageEngine.models
    : [...(imageEngine?.models ?? []), settings.imageModel].filter(Boolean);
  const sizeApplies = settings.image === "gemini";

  function save(next: Partial<Settings>, input: Omit<Parameters<typeof setProjectEngines>[0], "projectId">, success: string) {
    run(
      async () => {
        setOptimistic({ ...settings, ...next });
        return setProjectEngines({ projectId, ...input });
      },
      { success },
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-md px-2 py-1 text-right hover:bg-muted">
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            {pending ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              missing.length > 0 && <AlertTriangleIcon className="size-3 text-amber-500" />
            )}
            Motores
          </div>
          <div className="font-medium">
            {shortLabel(textEngines, settings.text)} · {settings.imageModel ? modelName(settings.imageModel) : shortLabel(imageEngines, settings.image)}
            {sizeApplies && ` · ${settings.imageSize}`}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="engine-text">Texto</FieldLabel>
            <EngineSelect
              id="engine-text"
              engines={textEngines}
              value={settings.text}
              disabled={pending}
              onChange={(name) => save({ text: name }, { textEngine: name }, `Motor de texto: ${shortLabel(textEngines, name)}`)}
            />
            <FieldDescription>Lee los PDFs y escribe el guion, el shot list y los prompts.</FieldDescription>
          </Field>
          <FieldSeparator />
          <Field>
            <FieldLabel htmlFor="engine-image">Imagen</FieldLabel>
            <EngineSelect
              id="engine-image"
              engines={imageEngines}
              value={settings.image}
              disabled={pending}
              onChange={(name) =>
                save(
                  { image: name, imageModel: imageEngines.find((e) => e.name === name)?.model ?? "" },
                  { imageEngine: name },
                  `Motor de imagen: ${shortLabel(imageEngines, name)}`,
                )
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="image-model">Modelo</FieldLabel>
            <OptionSelect
              id="image-model"
              value={settings.imageModel}
              options={models.map((m) => ({ value: m, label: modelName(m) === m ? m : `${modelName(m)} · ${m}` }))}
              disabled={pending || !imageEngine?.configured}
              onChange={(model) => save({ imageModel: model }, { imageModel: model }, `Modelo de imagen: ${modelName(model)}`)}
            />
            <FieldDescription>Los modelos disponibles se habilitan en .env.local.</FieldDescription>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="image-size">Resolución</FieldLabel>
              <OptionSelect
                id="image-size"
                value={settings.imageSize}
                options={IMAGE_SIZES.map((s) => ({ value: s, label: s }))}
                disabled={pending || !sizeApplies}
                onChange={(size) => save({ imageSize: size }, { imageSize: size }, `Resolución: ${size}`)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="image-ratio">Formato</FieldLabel>
              <OptionSelect
                id="image-ratio"
                value={settings.aspectRatio}
                options={ASPECT_RATIOS.map((r) => ({ value: r, label: r }))}
                disabled={pending}
                onChange={(ratio) => save({ aspectRatio: ratio }, { aspectRatio: ratio }, `Formato: ${ratio}`)}
              />
            </Field>
          </div>
          <FieldDescription>
            {sizeApplies
              ? "Más resolución, más costo por imagen. Aplica a los frames que se generen de acá en adelante."
              : "OpenAI usa un tamaño fijo por formato. Aplica a los frames que se generen de acá en adelante."}
          </FieldDescription>
          {missing.length > 0 && (
            <p className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
              {missing.map((e) => e.label).join(" y ")} sin configurar: completá su API key y modelo en .env.local.
            </p>
          )}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
