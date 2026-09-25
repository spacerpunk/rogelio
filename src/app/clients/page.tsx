import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { NewClientDialog } from "./new-client-dialog";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, slug, characters(count), locations(count), projects(count)")
    .is("deleted_at", null)
    .is("characters.deleted_at", null)
    .is("locations.deleted_at", null)
    .is("projects.deleted_at", null)
    .order("name");

  if (error) throw new Error(`No se pudieron cargar los clientes: ${error.message}`);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Biblioteca de estilo, personajes y locaciones por cliente."
        actions={<NewClientDialog />}
      />
      <div className="px-6 py-4">
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay clientes. Creá uno o corré `npm run seed`.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Personajes</TableHead>
                <TableHead className="text-right">Locaciones</TableHead>
                <TableHead className="text-right">Proyectos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/clients/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.characters[0]?.count ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.locations[0]?.count ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.projects[0]?.count ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
