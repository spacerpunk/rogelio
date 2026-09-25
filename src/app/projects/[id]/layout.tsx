import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProjectSummary } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";
import { CostPopover } from "./cost-popover";
import { JobsIndicator } from "./jobs-indicator";
import { ProjectJobsProvider } from "./jobs-provider";
import { ProjectSettings } from "./project-settings";
import { ProjectStepper } from "./project-stepper";

export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[id]">) {
  const { id } = await params;
  const db = await createClient();
  const summary = await loadProjectSummary(db, id);
  if (!summary) notFound();
  const { project, client, costUsd, steps } = summary;

  return (
    <ProjectJobsProvider projectId={project.id} initialJobs={summary.jobs}>
      <div className="border-b">
        <div className="flex items-center gap-4 px-6 pt-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link href="/projects" className="hover:text-foreground">
                Proyectos
              </Link>
              <span>/</span>
              <Link href={`/clients/${client.id}`} className="hover:text-foreground">
                {client.name}
              </Link>
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight">{project.title}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <JobsIndicator />
            <CostPopover total={costUsd} lines={summary.costBreakdown} />
            <ProjectSettings project={project} />
          </div>
        </div>
        <ProjectStepper projectId={project.id} steps={steps} />
      </div>
      {children}
    </ProjectJobsProvider>
  );
}
