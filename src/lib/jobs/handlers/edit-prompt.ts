import { editPrompt, promptEditPayloadSchema } from "@/lib/pipeline/prompt-edit";
import type { Json } from "@/lib/supabase/database.types";
import type { JobHandler } from "../types";

/** Reescribe el prompt de imagen o de video de un plano según un pedido del productor. Deja una propuesta. */
export const editPromptJob: JobHandler = async (ctx) => {
  const result = await editPrompt(ctx, promptEditPayloadSchema.parse(ctx.job.payload));
  await ctx.progress(1, 1);
  return result as unknown as Json;
};
