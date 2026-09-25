"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import type { StepState } from "@/lib/projects/data";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "sources", label: "Fuentes", path: "sources" },
  { key: "script", label: "Guion", path: "script" },
  { key: "shots", label: "Shot list", path: "shots" },
  { key: "frames", label: "Frames", path: "frames" },
] as const;

export function ProjectStepper({
  projectId,
  steps,
}: {
  projectId: string;
  steps: Record<(typeof STEPS)[number]["key"], StepState>;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex items-stretch gap-1 px-4 pt-2" aria-label="Etapas del proyecto">
      {STEPS.map((step, i) => {
        const href = `/projects/${projectId}/${step.path}`;
        const active = pathname.startsWith(href);
        const state = steps[step.key];
        return (
          <Link
            key={step.key}
            href={href}
            className={cn(
              "group flex min-w-40 items-center gap-2 border-b-2 px-3 pb-2 text-sm transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            {state.done ? (
              <CheckCircle2Icon className="size-4 text-emerald-500" aria-label="Aprobado" />
            ) : (
              <CircleIcon className="size-4 text-muted-foreground/60" aria-label="Pendiente" />
            )}
            <span className="flex flex-col leading-tight">
              <span className="font-medium">{step.label}</span>
              <span className="text-[11px] text-muted-foreground">{state.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
