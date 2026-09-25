"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ProjectJob } from "@/lib/projects/data";

const JOB_LABEL: Record<ProjectJob["type"], string> = {
  extract_source: "Extracción de fuente",
  generate_script: "Generación de guion",
  generate_shotlist: "Generación de shot list",
  generate_prompts: "Generación de prompts",
  generate_frames: "Generación de frames",
};

export function jobLabel(type: ProjectJob["type"]) {
  return JOB_LABEL[type];
}

export function isActive(job: Pick<ProjectJob, "status">) {
  return job.status === "queued" || job.status === "running";
}

type JobsContextValue = { jobs: ProjectJob[]; refresh: () => void };
const JobsContext = createContext<JobsContextValue>({ jobs: [], refresh: () => {} });

export function useProjectJobs() {
  return useContext(JobsContext);
}

function latestFinish(jobs: ProjectJob[]): string {
  return jobs.reduce((max, j) => (j.finished_at && j.finished_at > max ? j.finished_at : max), "");
}

/**
 * Polling de los trabajos del proyecto: cada 1,5 s mientras hay alguno activo, cada 8 s si no.
 * Cuando un trabajo termina refresca la página (para traer el resultado) y avisa si falló.
 */
export function ProjectJobsProvider({
  projectId,
  initialJobs,
  children,
}: {
  projectId: string;
  initialJobs: ProjectJob[];
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [serverJobs, setServerJobs] = useState(initialJobs);
  const router = useRouter();
  const known = useRef(new Map(initialJobs.map((j) => [j.id, j.status])));
  const lastFinish = useRef(latestFinish(initialJobs));
  const progressSeen = useRef(
    new Map(initialJobs.map((j) => [j.id, (j.progress as { done?: number } | null)?.done ?? 0])),
  );

  // Cuando el servidor re-renderiza (por ejemplo, después de encolar un trabajo) adoptamos su lista.
  if (serverJobs !== initialJobs) {
    setServerJobs(initialJobs);
    setJobs(initialJobs);
  }

  const poll = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/jobs`, { cache: "no-store" });
    if (!res.ok) return;
    const { jobs: next } = (await res.json()) as { jobs: ProjectJob[] };

    let finished = false;
    for (const job of next) {
      const before = known.current.get(job.id);
      const justFinished = !isActive(job) && (before ? isActive({ status: before }) : (job.finished_at ?? "") > lastFinish.current);
      if (justFinished) {
        finished = true;
        if (job.status === "error") toast.error(`${jobLabel(job.type)} falló`, { description: job.error ?? undefined });
      }
      // En los lotes, cada plano terminado también trae resultados nuevos.
      const done = (job.progress as { done?: number } | null)?.done ?? 0;
      if (isActive(job) && done > (progressSeen.current.get(job.id) ?? 0)) finished = true;
      progressSeen.current.set(job.id, done);
    }
    known.current = new Map(next.map((j) => [j.id, j.status]));
    lastFinish.current = latestFinish(next) || lastFinish.current;
    setJobs(next);
    if (finished) router.refresh();
  }, [projectId, router]);

  const anyActive = jobs.some(isActive);

  useEffect(() => {
    for (const j of initialJobs) if (!known.current.has(j.id)) known.current.set(j.id, j.status);
  }, [initialJobs]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        await poll();
      } catch {
        // Error de red transitorio: se reintenta en el próximo ciclo.
      }
      if (!cancelled) timer = setTimeout(loop, anyActive ? 1_500 : 8_000);
    };
    timer = setTimeout(loop, anyActive ? 1_500 : 8_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [poll, anyActive]);

  const refresh = useCallback(() => void poll().catch(() => {}), [poll]);

  return <JobsContext.Provider value={{ jobs, refresh }}>{children}</JobsContext.Provider>;
}
