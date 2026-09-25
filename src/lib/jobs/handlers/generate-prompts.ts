import { z } from "zod";
import { defaultImageEngineName } from "@/lib/engines/registry";
import { EngineError } from "@/lib/engines/types";
import { generatePromptsForShot, loadShotContext, mapLimit } from "@/lib/pipeline/frames";
import type { JobHandler } from "../types";

const payloadSchema = z.object({
  shotIds: z.array(z.uuid()).min(1),
  engine: z.string().optional(),
});

/** Prompts de imagen (y borrador de video) para uno o varios planos. */
export const generatePrompts: JobHandler = async (ctx) => {
  const { shotIds, engine = defaultImageEngineName() } = payloadSchema.parse(ctx.job.payload);
  let done = 0;
  await ctx.progress(0, shotIds.length, "Escribiendo prompts");

  const errors = await mapLimit(shotIds, 3, async (shotId) => {
    const shot = await loadShotContext(ctx.db, shotId);
    await generatePromptsForShot(ctx, shot, engine);
    done++;
    await ctx.progress(done, shotIds.length, "Escribiendo prompts");
  });

  if (errors.length) {
    const first = errors[0].error;
    const reason = first instanceof Error ? first.message : String(first);
    if (errors.length === shotIds.length) throw first instanceof EngineError ? first : new Error(reason);
    throw new Error(`${errors.length} de ${shotIds.length} planos fallaron. Primer error: ${reason}`);
  }
  return { shots: done };
};
