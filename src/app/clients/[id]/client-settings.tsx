"use client";

import { useState } from "react";
import { ArchiveIcon, Loader2Icon, Settings2Icon } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { archiveClient, updateClient } from "../actions";

export function ClientSettings({ client }: { client: { id: string; name: string; notes: string | null } }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client.name);
  const [notes, setNotes] = useState(client.notes ?? "");
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Settings2Icon />
          Ajustes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustes del cliente</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="cs-name">Nombre</FieldLabel>
            <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="cs-notes">Notas</FieldLabel>
            <Textarea id="cs-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter className="sm:justify-between">
          <ConfirmButton
            title={`¿Archivar ${client.name}?`}
            description="Deja de aparecer en la lista. La biblioteca se conserva."
            confirmLabel="Archivar"
            destructive
            onConfirm={() => run(() => archiveClient(client.id))}
          >
            <Button variant="ghost" size="sm">
              <ArchiveIcon />
              Archivar
            </Button>
          </ConfirmButton>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => updateClient({ clientId: client.id, name, notes }), {
                success: "Cliente actualizado",
                onSuccess: () => setOpen(false),
              })
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
