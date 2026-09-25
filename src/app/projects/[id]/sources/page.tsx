import type { Metadata } from "next";
import { sourceKind } from "@/lib/ingest/kinds";
import { signImages } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { SourcesStep, type SourceView } from "./sources-step";

export const metadata: Metadata = { title: "Fuentes" };

export default async function SourcesPage({ params }: PageProps<"/projects/[id]/sources">) {
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db
    .from("sources")
    .select("*")
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("order_index");
  if (error) throw new Error(`No se pudieron cargar las fuentes: ${error.message}`);

  const signed = await signImages(db, "projects", data.flatMap((s) => s.extracted_images));
  const sources: SourceView[] = data.map((s) => ({
    id: s.id,
    fileName: s.file_name,
    kind: sourceKind(s.mime_type, s.file_name) ?? "text",
    hasFile: Boolean(s.storage_path),
    extractedText: s.extracted_text,
    extractedNotes: s.extracted_notes,
    images: s.extracted_images.flatMap((path) => {
      const image = signed.get(path);
      return image ? [{ path, ...image }] : [];
    }),
  }));

  return <SourcesStep projectId={id} sources={sources} />;
}
