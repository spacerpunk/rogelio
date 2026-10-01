// Worker de trabajos largos (extracción, guion, shot list, prompts, frames).
// Toma trabajos de la tabla jobs y los ejecuta fuera del servidor web. Uso: npm run worker

import { config } from "dotenv";
import tls from "node:tls";

config({ path: ".env.local", quiet: true });

// Antivirus con análisis HTTPS (Avast, por ejemplo) y proxies corporativos re-firman las conexiones con
// un certificado raíz propio que instalan en el almacén del sistema. Node no usa ese almacén por defecto,
// y sin esto las llamadas a los motores fallan con UNABLE_TO_VERIFY_LEAF_SIGNATURE. Se suman los
// certificados del sistema a los de Node (que ya incluyen NODE_EXTRA_CA_CERTS, si está definida).
// Las funciones existen desde Node 22.19; @types/node 20 todavía no las declara.
const caStore = tls as typeof tls & {
  getCACertificates?: (type: "default" | "system") => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};
if (caStore.getCACertificates && caStore.setDefaultCACertificates) {
  caStore.setDefaultCACertificates([
    ...new Set([...caStore.getCACertificates("default"), ...caStore.getCACertificates("system")]),
  ]);
} else {
  console.warn("Node < 22.19: no se suman los certificados del sistema. Si hay un antivirus con análisis HTTPS, definí NODE_EXTRA_CA_CERTS.");
}

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
