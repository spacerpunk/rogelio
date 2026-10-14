import { z } from "zod";
import { defaultVideoEngineName } from "@/lib/engines/registry";
import { EngineError } from "@/lib/engines/types";
import { mapLimit } from "@/lib/pipeline/frames";
import { generateVideoPromptForShot, loadVideoShotContext } from "@/lib/pipeline/video";
import type { JobHandler } from "../types";

const payloadSchema = z.object({
  shotIds: z.array(z.uuid()).min(1),
  engine: z.string().optional(),
});

/** Prompts de video para uno o varios planos, escritos mirando el frame aprobado de cada uno. */
export const generateVideoPrompts: JobHandler = async (ctx) => {
  const { shotIds, engine = defaultVideoEngineName() } = payloadSchema.parse(ctx.job.payload);
  let done = 0;
  await ctx.progress(0, shotIds.length, "Escribiendo prompts de video");

  const errors = await mapLimit(shotIds, 3, async (shotId) => {
    const shot = await loadVideoShotContext(ctx.db, shotId);
    await generateVideoPromptForShot(ctx, shot, engine);
    done++;
    await ctx.progress(done, shotIds.length, "Escribiendo prompts de video");
  });

  if (errors.length) {
    const first = errors[0].error;
    const reason = first instanceof Error ? first.message : String(first);
    if (errors.length === shotIds.length) throw first instanceof EngineError ? first : new Error(reason);
    throw new Error(`${errors.length} de ${shotIds.length} planos fallaron. Primer error: ${reason}`);
  }
  return { shots: done };
};
