import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PROJECT_STATUS_LABEL, formatDuration, formatUsd } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";
import { NewProjectDialog } from "./new-project-dialog";

export const metadata: Metadata = { title: "Proyectos" };

export default async function ProjectsPage() {
  const db = await createClient();
  const [projects, costs, clients] = await Promise.all([
    db
      .from("projects")
      .select("id, title, status, target_duration_sec, aspect_ratio, updated_at, clients(name)")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
    db.from("project_costs").select("project_id, cost_usd"),
    db.from("clients").select("id, name").is("deleted_at", null).order("name"),
  ]);
  if (projects.error) throw new Error(`No se pudieron cargar los proyectos: ${projects.error.message}`);
  const costById = new Map((costs.data ?? []).map((c) => [c.project_id, Number(c.cost_usd)]));

  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Videos en producción por cliente."
        actions={<NewProjectDialog clients={clients.data ?? []} />}
      />
      <div className="px-6 py-4">
        {projects.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay proyectos.{" "}
            {clients.data?.length ? "Creá el primero." : "Primero creá un cliente (o corré `npm run seed`)."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Duración objetivo</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">Actualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/projects/${p.id}`} className="hover:underline">
                      {p.title}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{p.aspect_ratio}</span>
                  </TableCell>
                  <TableCell>{p.clients?.name}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "done" ? "default" : "secondary"}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(p.target_duration_sec)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(costById.get(p.id) ?? 0)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {new Date(p.updated_at).toLocaleDateString("es-AR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
