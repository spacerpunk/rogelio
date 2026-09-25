"use client";

import { useState } from "react";
import { ArchiveIcon, Loader2Icon, Settings2Icon } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { ASPECT_RATIOS } from "@/lib/projects/data";
import { archiveProject, updateProject } from "../actions";

export function ProjectSettings({
  project,
}: {
  project: { id: string; title: string; target_duration_sec: number | null; aspect_ratio: string; notes: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [minutes, setMinutes] = useState(project.target_duration_sec ? String(project.target_duration_sec / 60) : "");
  const [aspectRatio, setAspectRatio] = useState(project.aspect_ratio);
  const [notes, setNotes] = useState(project.notes ?? "");
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Ajustes del proyecto">
          <Settings2Icon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustes del proyecto</DialogTitle>
          <DialogDescription>El formato se usa en los frames que se generen de acá en adelante.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ps-title">Título</FieldLabel>
            <Input id="ps-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="ps-min">Duración objetivo (min)</FieldLabel>
              <Input id="ps-min" type="number" min={0.5} step={0.5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Formato</FieldLabel>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ps-notes">Notas</FieldLabel>
            <Textarea id="ps-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field>
            <FieldDescription>Archivar lo saca de la lista de proyectos. No se borra nada.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter className="sm:justify-between">
          <ConfirmButton
            title="¿Archivar el proyecto?"
            description="Deja de aparecer en la lista. Fuentes, guiones, planos y frames se conservan."
            confirmLabel="Archivar"
            destructive
            onConfirm={() => run(() => archiveProject(project.id))}
          >
            <Button variant="ghost" size="sm">
              <ArchiveIcon />
              Archivar
            </Button>
          </ConfirmButton>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateProject({
                    projectId: project.id,
                    title,
                    targetMinutes: minutes ? Number(minutes) : null,
                    aspectRatio,
                    notes,
                  }),
                { success: "Proyecto actualizado", onSuccess: () => setOpen(false) },
              )
            }
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
