import { hostname } from "node:os";
import { ZodError } from "zod";
import { roundUsd } from "@/lib/engines/pricing";
import { EngineError } from "@/lib/engines/types";
import type { Database, Json } from "@/lib/supabase/database.types";
import { adaptScript } from "./handlers/adapt-script";
import { extractSource } from "./handlers/extract-source";
import { generateScript } from "./handlers/generate-script";
import { generateFrames } from "./handlers/generate-frames";
import { generatePrompts } from "./handlers/generate-prompts";
import { generateShotlist } from "./handlers/generate-shotlist";
import { importScript } from "./handlers/import-script";
import type { Db, JobContext, JobHandler, JobRow, JobType } from "./types";

const HANDLERS: Partial<Record<JobType, JobHandler>> = {
  extract_source: extractSource,
  generate_script: generateScript,
  import_script: importScript,
  adapt_script: adaptScript,
  generate_shotlist: generateShotlist,
  generate_prompts: generatePrompts,
  generate_frames: generateFrames,
};

const HEARTBEAT_MS = 15_000;
const STALE_AFTER_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

function log(message: string) {
  console.log(`[worker ${new Date().toLocaleTimeString("es-AR", { hour12: false })}] ${message}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof EngineError) return error.message;
  if (error instanceof ZodError) return `Datos inválidos: ${error.issues.map((i) => i.message).join(", ")}`;
  return error instanceof Error ? error.message : String(error);
}

export async function runJob(db: Db, job: JobRow): Promise<void> {
  let costUsd = 0;

  const ctx: JobContext = {
    db,
    job,
    async progress(done, total, message) {
      await db
        .from("jobs")
        .update({ progress: { done, total, ...(message ? { message } : {}) }, heartbeat_at: now() })
        .eq("id", job.id);
    },
    async track(engine, operation, fn) {
      const started = Date.now();
      const int = (v: number | undefined) => (v === undefined ? null : Math.round(v));
      const record = async (row: Omit<Database["public"]["Tables"]["engine_calls"]["Insert"], "project_id" | "job_id" | "engine" | "operation">) => {
        const { error } = await db
          .from("engine_calls")
          .insert({ project_id: job.project_id, job_id: job.id, engine: engine.name, operation, ...row });
        // Un fallo al registrar no debe tirar abajo el trabajo, pero tiene que verse.
        if (error) log(`No se pudo registrar la llamada ${operation}: ${error.message}`);
      };
      try {
        const result = await fn();
        costUsd += result.costUsd;
        await record({
          model: result.model,
          duration_ms: Math.round(result.durationMs),
          input_tokens: int(result.usage.inputTokens),
          output_tokens: int(result.usage.outputTokens),
          image_count: int(result.usage.images),
          cost_usd: result.costUsd,
        });
        return result;
      } catch (error) {
        await record({ model: engine.model, duration_ms: Date.now() - started, error: errorMessage(error) });
        throw error;
      }
    },
  };

  const heartbeat = setInterval(() => {
    void db.from("jobs").update({ heartbeat_at: now() }).eq("id", job.id);
  }, HEARTBEAT_MS);

  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Todavía no está implementado el trabajo "${job.type}".`);
    log(`▶ ${job.type} ${job.id} (intento ${job.attempts})`);
    const result: Json | null = await handler(ctx);
    await db
      .from("jobs")
      .update({ status: "done", result, cost_usd: roundUsd(costUsd), finished_at: now(), error: null })
      .eq("id", job.id);
    log(`✓ ${job.type} ${job.id} · US$ ${roundUsd(costUsd)}`);
  } catch (error) {
    const message = errorMessage(error);
    await db
      .from("jobs")
      .update({
        status: "error",
        error: message,
        result: error instanceof EngineError ? { kind: error.kind, engine: error.engine } : null,
        cost_usd: roundUsd(costUsd),
        finished_at: now(),
      })
      .eq("id", job.id);
    log(`✗ ${job.type} ${job.id}: ${message}`);
  } finally {
    clearInterval(heartbeat);
  }
}

/** Trabajos que quedaron "corriendo" sin heartbeat (el worker se cayó): se reencolan o se marcan con error. */
export async function recoverStaleJobs(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data: stale } = await db
    .from("jobs")
    .select("id, attempts, type")
    .eq("status", "running")
    .lt("heartbeat_at", cutoff);
  for (const job of stale ?? []) {
    if (job.attempts < MAX_ATTEMPTS) {
      await db.from("jobs").update({ status: "queued", worker_id: null }).eq("id", job.id);
      log(`↺ reencolado ${job.type} ${job.id} (se cortó el worker)`);
    } else {
      await db
        .from("jobs")
        .update({ status: "error", error: "El trabajo se cortó varias veces; reintentalo a mano.", finished_at: now() })
        .eq("id", job.id);
    }
  }
}

export async function startWorker(db: Db, { concurrency = 3, pollMs = 1_000 } = {}) {
  const workerId = `${hostname()}-${process.pid}`;
  const running = new Set<Promise<void>>();
  let stopping = false;

  const stop = () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`Deteniendo… esperando ${running.size} trabajo(s) en curso (Ctrl+C otra vez para forzar)`);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  log(`Worker ${workerId} listo · concurrencia ${concurrency}`);
  let lastRecovery = 0;

  while (!stopping) {
    if (Date.now() - lastRecovery > STALE_AFTER_MS / 2) {
      await recoverStaleJobs(db).catch((e: unknown) => log(`No se pudieron recuperar trabajos: ${errorMessage(e)}`));
      lastRecovery = Date.now();
    }
    if (running.size >= concurrency) {
      await Promise.race(running);
      continue;
    }
    const { data, error } = await db.rpc("claim_next_job", { p_worker_id: workerId });
    if (error) {
      log(`Error al tomar trabajos: ${error.message}`);
      await sleep(pollMs * 5);
      continue;
    }
    const job = data?.[0];
    if (!job) {
      await sleep(pollMs);
      continue;
    }
    const task = runJob(db, job).finally(() => running.delete(task));
    running.add(task);
  }

  await Promise.allSettled(running);
  log("Worker detenido.");
}
