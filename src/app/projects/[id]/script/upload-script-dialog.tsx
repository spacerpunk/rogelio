"use client";

import { useState } from "react";
import { Loader2Icon, UploadIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { ActionResult } from "@/lib/action-result";
import { SCRIPT_ACCEPT, scriptFileKind } from "@/lib/ingest/kinds";
import { uploadToSignedTarget } from "@/lib/supabase/browser";
import { createScriptUploadTarget, importScriptFile, importScriptText } from "./actions";

/** Subir un guion que ya existe (archivo o texto pegado): se guarda tal cual como versión nueva. */
export function UploadScriptDialog({
  projectId,
  disabled,
  onQueued,
}: {
  projectId: string;
  disabled: boolean;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const { pending, run } = useAction();
  const isPdf = file ? scriptFileKind(file.type, file.name) === "pdf" : false;

  function reset() {
    setOpen(false);
    setFile(null);
    setText("");
  }

  async function uploadFile(f: File): Promise<ActionResult> {
    const target = await createScriptUploadTarget({ projectId, fileName: f.name });
    if (!target.ok) return target;
    try {
      await uploadToSignedTarget("projects", target.data, f);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return importScriptFile({ projectId, fileName: f.name, path: target.data.path, mimeType: f.type });
  }

  function submit() {
    if (tab === "paste") {
      run(() => importScriptText({ projectId, content: text }), {
        success: "Guion guardado como versión nueva",
        onSuccess: reset,
      });
    } else if (file) {
      run(() => uploadFile(file), {
        success: isPdf ? "Guion en cola: el motor de texto está leyendo el PDF" : "Guion en cola",
        onSuccess: () => {
          reset();
          onQueued();
        },
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full" disabled={disabled}>
          <UploadIcon />
          Subir un guion que ya tengo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Subir guion</DialogTitle>
          <DialogDescription>
            Se guarda tal cual como una versión nueva, que podés editar y aprobar como cualquier otra. Si no sigue el
            formato de escenas y tomas de la app, después podés adaptarlo con un botón.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "file" | "paste")}>
          <TabsList>
            <TabsTrigger value="file">Archivo</TabsTrigger>
            <TabsTrigger value="paste">Pegar texto</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="space-y-2 pt-2">
            <Input type="file" accept={SCRIPT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">
              DOCX, TXT o MD se leen directo. Un PDF lo transcribe el motor de texto del proyecto (tarda un poco y
              suma una llamada al costo).
            </p>
          </TabsContent>
          <TabsContent value="paste" className="pt-2">
            <Textarea
              rows={12}
              value={text}
              placeholder="Pegá el guion completo acá"
              onChange={(e) => setText(e.target.value)}
              className="font-mono text-[13px]"
            />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button disabled={pending || (tab === "file" ? !file : !text.trim())} onClick={submit}>
            {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            Subir guion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
