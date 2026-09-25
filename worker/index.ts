// Worker de trabajos largos (extracción, guion, shot list, prompts, frames).
// Toma trabajos de la tabla jobs y los ejecuta fuera del servidor web. Uso: npm run worker

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  // Import dinámico: los módulos leen variables de entorno al usarse, después de cargar .env.local.
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { startWorker } = await import("../src/lib/jobs/runner");
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
  await startWorker(createAdminClient(), { concurrency });
}

main().catch((error: unknown) => {
  console.error("El worker se detuvo por un error:", error);
  process.exit(1);
});
