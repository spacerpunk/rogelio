import { z } from "zod";
import { getTextEngine } from "@/lib/engines/registry";
import { insertScriptVersion, loadProjectContext } from "@/lib/pipeline/context";
import { buildAdaptScriptPrompt, scriptStats } from "@/lib/pipeline/script";
import type { JobHandler } from "../types";

const payloadSchema = z.object({ baseVersion: z.number().int().positive() });

/** Pasa un guion subido al formato de escenas y tomas de la app, en una versión nueva. */
export const adaptScript: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const { baseVersion } = payloadSchema.parse(job.payload);
  const context = await loadProjectContext(db, job.project_id);
  const { data: base } = await db
    .from("scripts")
    .select("content")
    .eq("project_id", job.project_id)
    .eq("version", baseVersion)
    .is("deleted_at", null)
    .single();
  if (!base) throw new Error(`No encontré la versión ${baseVersion} del guion.`);

  const { system, user } = buildAdaptScriptPrompt({
    script: base.content,
    client: context.clientName,
    projectTitle: context.project.title,
    aspectRatio: context.project.aspect_ratio,
    characters: context.characters.map((c) => ({ name: c.name, role: c.role, description: c.description })),
    locations: context.locations.map((l) => ({ name: l.name, description: l.description })),
  });

  const engine = getTextEngine(context.project.text_engine);
  await ctx.progress(0, 1, `${engine.label} está adaptando la versión ${baseVersion} al formato de la app`);
  const result = await ctx.track(engine, "adapt_script", () =>
    engine.complete({ system, content: user, maxTokens: 96_000, effort: "medium" }),
  );

  const version = await insertScriptVersion(db, job.project_id, result.text, {
    adaptedFrom: baseVersion,
    model: result.model,
    jobId: job.id,
  });
  const stats = scriptStats(result.text);
  await ctx.progress(1, 1, "Listo");
  return { version, shots: stats.shots, seconds: stats.seconds };
};
