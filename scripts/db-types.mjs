// Regenera los tipos de la base. Valida la salida antes de escribir: si Supabase falla,
// `supabase gen types` imprime el error por stdout y una redirección directa pisaría el archivo.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const TARGET = "src/lib/supabase/database.types.ts";

const output = execSync("npx supabase gen types typescript --local", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

if (!output.startsWith("export type Json")) {
  console.error(`La generación de tipos falló; ${TARGET} no se modificó.\n${output.slice(0, 500)}`);
  process.exit(1);
}

writeFileSync(TARGET, output);
console.log(`Tipos actualizados en ${TARGET}`);
