import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import type { AssetView } from "@/lib/library/data";
import { TEXT_KINDS } from "@/lib/library/kinds";
import { PIPELINE_STEPS } from "@/lib/settings/steps";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const db = await createClient();
  const { data: clients } = await db.from("clients").select("id, name").is("deleted_at", null).order("name");

  if (!clients?.length) {
    return (
      <>
        <PageHeader title="Settings" description="System prompts que usa cada paso del pipeline." />
        <p className="p-6 text-sm text-muted-foreground">
          Todavía no hay clientes. <Link href="/clients" className="underline">Creá uno</Link> o corré npm run seed.
        </p>
      </>
    );
  }

  const clientId = clients.find((c) => c.id === params.client)?.id ?? clients[0].id;
  const step = PIPELINE_STEPS.find((s) => s.key === params.step)?.key ?? PIPELINE_STEPS[0].key;

  const { data: rows, error } = await db
    .from("library_assets")
    .select("*")
    .eq("client_id", clientId)
    .in("kind", TEXT_KINDS)
    .not("text_content", "is", null)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw new Error(error.message);

  const assets: AssetView[] = (rows ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    textContent: a.text_content,
    storagePath: a.storage_path,
    mimeType: a.mime_type,
    lineageId: a.lineage_id,
    version: a.version,
    isActive: a.is_active,
    createdAt: a.created_at,
    image: null,
  }));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Qué system prompt usa cada paso del pipeline, por cliente. Los de la biblioteca se editan acá (cada cambio es una versión nueva); los internos son parte de la app."
      />
      <SettingsView clients={clients} clientId={clientId} steps={PIPELINE_STEPS} stepKey={step} assets={assets} />
    </>
  );
}
