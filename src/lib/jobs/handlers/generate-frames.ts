import { z } from "zod";
import { defaultImageEngineName } from "@/lib/engines/registry";
import { EngineError } from "@/lib/engines/types";
import { generateFramesForShot, loadShotContext, mapLimit } from "@/lib/pipeline/frames";
import type { JobHandler } from "../types";

const payloadSchema = z.object({
  shotIds: z.array(z.uuid()).min(1),
  engine: z.string().optional(),
  n: z.number().int().min(1).max(8).default(4),
});

/** Frames para uno o varios planos (lote). Un plano que falla no frena a los demás. */
export const generateFrames: JobHandler = async (ctx) => {
  const { shotIds, engine = defaultImageEngineName(), n } = payloadSchema.parse(ctx.job.payload);
  let done = 0;
  let images = 0;
  const label = shotIds.length > 1 ? "Generando frames del lote" : `Generando ${n} variantes`;
  await ctx.progress(0, shotIds.length, label);

  const errors = await mapLimit(shotIds, 2, async (shotId) => {
    const shot = await loadShotContext(ctx.db, shotId);
    images += await generateFramesForShot(ctx, shot, engine, n);
    done++;
    await ctx.progress(done, shotIds.length, label);
  });

  if (errors.length) {
    const first = errors[0].error;
    const reason = first instanceof Error ? first.message : String(first);
    if (errors.length === shotIds.length) throw first instanceof EngineError ? first : new Error(reason);
    throw new Error(`${errors.length} de ${shotIds.length} planos fallaron (los demás se generaron). Primer error: ${reason}`);
  }
  return { shots: done, images };
};
