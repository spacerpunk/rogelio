"use client";

import { useActionState, useState } from "react";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ASPECT_RATIOS } from "@/lib/projects/data";
import { createProject } from "./actions";

export function NewProjectDialog({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createProject, null);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" disabled={clients.length === 0}>
          <PlusIcon />
          Nuevo proyecto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Nuevo proyecto</DialogTitle>
            <DialogDescription>Después subís las fuentes: PDF, PPTX, DOCX o texto.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel>Cliente</FieldLabel>
              <input type="hidden" name="clientId" value={clientId} />
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegí un cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="p-title">Título</FieldLabel>
              <Input id="p-title" name="title" required placeholder="Ej.: Carga y descarga de camiones cisterna" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="p-duration">Duración objetivo (min)</FieldLabel>
                <Input id="p-duration" name="targetMinutes" type="number" min={0.5} step={0.5} placeholder="Ej.: 5" />
              </Field>
              <Field>
                <FieldLabel>Formato</FieldLabel>
                <input type="hidden" name="aspectRatio" value={aspectRatio} />
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
              <FieldLabel htmlFor="p-notes">Notas</FieldLabel>
              <Textarea id="p-notes" name="notes" rows={2} />
            </Field>
            {state && !state.ok && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || !clientId}>
              {pending && <Loader2Icon className="animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
