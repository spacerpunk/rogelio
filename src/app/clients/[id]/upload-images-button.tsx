"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AssetKind } from "@/lib/library/kinds";
import { uploadToSignedTarget } from "@/lib/supabase/browser";
import { createLibraryUploadTarget, registerImageAsset } from "../actions";

function titleFromFile(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

/** Sube una o varias imágenes a la biblioteca del cliente y devuelve los ids de los assets creados. */
export function UploadImagesButton({
  clientId,
  kind,
  label = "Subir imágenes",
  multiple = true,
  onUploaded,
  variant = "outline",
}: {
  clientId: string;
  kind: AssetKind;
  label?: string;
  multiple?: boolean;
  onUploaded?: (assetIds: string[]) => void;
  variant?: "outline" | "default" | "secondary";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const created: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name} no es una imagen`);
          continue;
        }
        const target = await createLibraryUploadTarget({ clientId, kind, fileName: file.name });
        if (!target.ok) throw new Error(target.error);
        await uploadToSignedTarget("library", target.data, file);
        const registered = await registerImageAsset({
          clientId,
          kind,
          title: titleFromFile(file.name),
          path: target.data.path,
          mimeType: file.type,
        });
        if (!registered.ok) throw new Error(registered.error);
        created.push(registered.data);
      }
      if (created.length) {
        toast.success(created.length === 1 ? "Imagen subida" : `${created.length} imágenes subidas`);
        onUploaded?.(created);
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button type="button" size="sm" variant={variant} disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        {label}
      </Button>
    </>
  );
}
