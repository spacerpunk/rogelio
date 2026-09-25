import { z } from "zod";
import { getTextEngine } from "@/lib/engines/registry";
import { activeTextContent, advanceProjectStatus, loadProjectContext } from "@/lib/pipeline/context";
import { buildScriptPrompt, scriptParamsSchema, scriptStats } from "@/lib/pipeline/script";
import type { JobHandler } from "../types";

const payloadSchema = z.object({
  params: scriptParamsSchema,
  /** Regenerar con indicaciones: se parte de esta versión. */
  baseVersion: z.number().int().positive().optional(),
  instructions: z.string().trim().optional(),
});

export const generateScript: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const payload = payloadSchema.parse(job.payload);
  const context = await loadProjectContext(db, job.project_id);
  const clientId = context.project.client_id;

  const [masterPrompt, styleBible, sources, previous] = await Promise.all([
    activeTextContent(db, clientId, "script_system_prompt"),
    activeTextContent(db, clientId, "style_bible"),
    db
      .from("sources")
      .select("file_name, extracted_text, extracted_notes")
      .eq("project_id", job.project_id)
      .is("deleted_at", null)
      .order("order_index"),
    payload.baseVersion
      ? db
          .from("scripts")
          .select("version, content")
          .eq("project_id", job.project_id)
          .eq("version", payload.baseVersion)
          .single()
      : Promise.resolve(null),
  ]);

  const material = (sources.data ?? []).filter((s) => s.extracted_text?.trim());
  if (material.length === 0) throw new Error("No hay fuentes con texto: subí o pegá el material primero.");

  const selected = new Set(payload.params.characterIds);
  const { system, user } = buildScriptPrompt({
    masterPrompt,
    styleBible,
    client: context.clientName,
    projectTitle: context.project.title,
    aspectRatio: context.project.aspect_ratio,
    params: payload.params,
    sources: material.map((s) => ({ name: s.file_name, text: s.extracted_text!, notes: s.extracted_notes })),
    characters: context.characters
      .filter((c) => selected.has(c.id))
      .map((c) => ({ name: c.name, role: c.role, description: c.description })),
    locations: context.locations.map((l) => ({ name: l.name, description: l.description })),
    previous:
      previous?.data && payload.instructions
        ? { version: previous.data.version, content: previous.data.content, instructions: payload.instructions }
        : undefined,
  });

  const engine = getTextEngine();
  await ctx.progress(0, 1, payload.baseVersion ? `Claude está reescribiendo la versión ${payload.baseVersion}` : "Claude está escribiendo el guion");
  const result = await ctx.track(engine, "generate_script", () =>
    engine.complete({ system, content: user, maxTokens: 96_000, effort: "high" }),
  );

  const { data: last } = await db
    .from("scripts")
    .select("version")
    .eq("project_id", job.project_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const { error } = await db.from("scripts").insert({
    project_id: job.project_id,
    version,
    content: result.text,
    generation_params: {
      ...payload.params,
      ...(payload.baseVersion ? { baseVersion: payload.baseVersion, instructions: payload.instructions ?? "" } : {}),
      model: result.model,
      jobId: job.id,
    },
  });
  if (error) throw new Error(`No se pudo guardar el guion: ${error.message}`);
  await advanceProjectStatus(db, job.project_id, "script");

  const stats = scriptStats(result.text);
  await ctx.progress(1, 1, "Listo");
  return { version, shots: stats.shots, seconds: stats.seconds };
};
