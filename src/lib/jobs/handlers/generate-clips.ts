import { z } from "zod";
import { defaultVideoEngineName } from "@/lib/engines/registry";
import { EngineError } from "@/lib/engines/types";
import { mapLimit } from "@/lib/pipeline/frames";
import { generateClipsForShot, loadVideoShotContext } from "@/lib/pipeline/video";
import type { JobHandler } from "../types";

const payloadSchema = z.object({
  shotIds: z.array(z.uuid()).min(1),
  engine: z.string().optional(),
  n: z.number().int().min(1).max(4).default(1),
});

/** Clips para uno o varios planos (lote) desde su frame aprobado. Un plano que falla no frena a los demás. */
export const generateClips: JobHandler = async (ctx) => {
  const { shotIds, engine = defaultVideoEngineName(), n } = payloadSchema.parse(ctx.job.payload);
  let done = 0;
  let clips = 0;
  const label = shotIds.length > 1 ? "Generando clips del lote" : `Generando ${n} clip${n > 1 ? "s" : ""}`;
  await ctx.progress(0, shotIds.length, label);

  const errors = await mapLimit(shotIds, 2, async (shotId) => {
    const shot = await loadVideoShotContext(ctx.db, shotId);
    clips += await generateClipsForShot(ctx, shot, engine, n);
    done++;
    await ctx.progress(done, shotIds.length, label);
  });

  if (errors.length) {
    const first = errors[0].error;
    const reason = first instanceof Error ? first.message : String(first);
    if (errors.length === shotIds.length) throw first instanceof EngineError ? first : new Error(reason);
    throw new Error(`${errors.length} de ${shotIds.length} planos fallaron (los demás se generaron). Primer error: ${reason}`);
  }
  return { shots: done, clips };
};
