import { NextResponse } from "next/server";
import { z } from "zod";
import { JOB_COLUMNS } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";

/** Trabajos recientes del proyecto, para el polling de la UI. */
export async function GET(_request: Request, { params }: RouteContext<"/api/projects/[id]/jobs">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const db = await createClient();
  const { data, error } = await db
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ jobs: data }, { headers: { "Cache-Control": "no-store" } });
}
