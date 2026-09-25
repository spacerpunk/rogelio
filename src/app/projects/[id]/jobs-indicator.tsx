"use client";

import { Loader2Icon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { JobProgress } from "@/lib/jobs/types";
import { isActive, jobLabel, useProjectJobs } from "./jobs-provider";

function progressText(progress: unknown): string | null {
  const p = progress as JobProgress | null;
  if (!p) return null;
  const counter = p.total > 1 ? ` (${p.done}/${p.total})` : "";
  return `${p.message ?? ""}${counter}`.trim() || null;
}

export function JobsIndicator() {
  const { jobs } = useProjectJobs();
  const active = jobs.filter(isActive);
  if (active.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Loader2Icon className="size-3.5 animate-spin" />
          {active.length} trabajo{active.length > 1 ? "s" : ""} en curso
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <ul className="space-y-1">
          {active.map((job) => (
            <li key={job.id} className="rounded-md px-2 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{jobLabel(job.type)}</span>
                <span className="text-muted-foreground">{job.status === "queued" ? "En cola" : "Corriendo"}</span>
              </div>
              {progressText(job.progress) && <div className="text-muted-foreground">{progressText(job.progress)}</div>}
            </li>
          ))}
        </ul>
        <p className="border-t px-2 pt-2 text-[11px] text-muted-foreground">
          Los trabajos los ejecuta el worker (`npm run dev` lo levanta junto con la web).
        </p>
      </PopoverContent>
    </Popover>
  );
}
