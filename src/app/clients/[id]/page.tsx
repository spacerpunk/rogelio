import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { loadClientLibrary } from "@/lib/library/data";
import { createClient } from "@/lib/supabase/server";
import { ClientSettings } from "./client-settings";
import { LibraryTabs } from "./library-tabs";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const db = await createClient();
  const { data } = await db.from("clients").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Cliente" };
}

export default async function ClientPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const db = await createClient();
  const library = await loadClientLibrary(db, id);
  if (!library) notFound();

  return (
    <>
      <PageHeader
        title={library.client.name}
        description={library.client.notes ?? undefined}
        actions={
          <>
            <ClientSettings client={library.client} />
            <Link href="/clients" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeftIcon className="size-4" />
              Clientes
            </Link>
          </>
        }
      />
      <LibraryTabs library={library} initialTab={typeof tab === "string" ? tab : "texts"} />
    </>
  );
}
