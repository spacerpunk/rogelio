import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const STEP_BY_STATUS = { draft: "sources", script: "script", shotlist: "shots", frames: "frames", done: "frames" } as const;

/** Entrar al proyecto lleva a la etapa en la que está. */
export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const db = await createClient();
  const { data } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  redirect(`/projects/${id}/${STEP_BY_STATUS[data?.status ?? "draft"]}`);
}
