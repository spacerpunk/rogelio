"use client";

import { useActionState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { createClientAction } from "./actions";

export function NewClientDialog() {
  const [state, formAction, pending] = useActionState(createClientAction, null);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          Nuevo cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>Después cargás su biblioteca: textos, personajes, locaciones y referencias.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="client-name">Nombre</FieldLabel>
              <Input id="client-name" name="name" required autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="client-notes">Notas</FieldLabel>
              <Textarea id="client-notes" name="notes" rows={3} />
            </Field>
            {state && !state.ok && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
