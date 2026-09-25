// Carga el cliente Clear Petroleum con su biblioteca desde seed/clear/.
// Idempotente: solo completa lo que falta; nunca pisa textos, personajes ni locaciones existentes.
// Uso: npm run seed

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { AssetKind } from "../src/lib/library/kinds";
import { ensureThumbnail, safeFileName } from "../src/lib/storage";

config({ path: ".env.local", quiet: true });

const SEED_DIR = path.join(process.cwd(), "seed", "clear");
const CLIENT = { name: "Clear Petroleum", slug: "clear-petroleum" };

type TextVersion = { title: string; content: string; active: boolean };
type SeedCharacter = {
  name: string;
  sheets: { file: string; title: string }[];
  description: string;
  visual_notes: string;
};
type SeedLocation = { name: string; description: string };

const db = createAdminClient();

function read(file: string): string {
  return readFileSync(path.join(SEED_DIR, file), "utf8").replace(/\r\n/g, "\n");
}

/** Desde la línea del encabezado hasta el próximo separador "---" (o el final). */
function section(md: string, headingPrefix: string): string {
  const start = md.split("\n").findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) throw new Error(`No encontré la sección "${headingPrefix}"`);
  const lines = md.split("\n").slice(start);
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  return lines.slice(0, end === -1 ? undefined : end).join("\n").trim();
}

function codeBlock(text: string): string {
  const match = text.match(/```[a-z]*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("No encontré el bloque de código");
  return match[1].trim();
}

function between(md: string, open: string, close: string): string {
  const start = md.indexOf(open);
  const end = md.indexOf(close);
  if (start === -1 || end === -1) throw new Error(`No encontré ${open}`);
  return md.slice(start + open.length, end).trim();
}

function lineAfter(text: string, marker: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(marker));
  if (i === -1 || !lines[i + 1]) throw new Error(`No encontré "${marker}"`);
  return lines[i + 1].trim();
}

async function getOrCreateClient(): Promise<string> {
  const { data: existing } = await db
    .from("clients")
    .select("id")
    .eq("slug", CLIENT.slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    console.log(`· Cliente ${CLIENT.name} ya existe`);
    return existing.id;
  }
  const { data, error } = await db
    .from("clients")
    .insert({ ...CLIENT, notes: "Cargado por npm run seed desde seed/clear/." })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`+ Cliente ${CLIENT.name}`);
  return data.id;
}

/** Crea un linaje de versiones de texto si el cliente todavía no tiene ninguno de ese tipo. */
async function seedTextLineage(clientId: string, kind: AssetKind, versions: TextVersion[]) {
  const { count } = await db
    .from("library_assets")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("kind", kind)
    .is("deleted_at", null);
  if (count) {
    console.log(`· ${kind}: ya tiene contenido, no se toca`);
    return;
  }
  const lineageId = crypto.randomUUID();
  const { error } = await db.from("library_assets").insert(
    versions.map((v, i) => ({
      client_id: clientId,
      kind,
      title: v.title,
      text_content: v.content,
      lineage_id: lineageId,
      version: i + 1,
      is_active: v.active,
    })),
  );
  if (error) throw error;
  console.log(`+ ${kind}: ${versions.map((v, i) => `v${i + 1}${v.active ? " (activa)" : ""}`).join(", ")}`);
}

async function seedTexts(clientId: string) {
  const generic = read("roger-that-system-prompts.md");
  const clear = read("roger-that-clear-image-system-prompt.md");
  const master = read("master-prompt-ppt-to-script.md");
  const clearImagePrompt = codeBlock(section(clear, "## B."));

  await seedTextLineage(clientId, "style_bible", [
    { title: "Style bible Roger That (genérica)", content: section(generic, "## 0."), active: false },
    { title: "Style bible Clear Petroleum", content: section(clear, "## A."), active: true },
  ]);
  await seedTextLineage(clientId, "script_system_prompt", [
    { title: "Master prompt PPT → guion", content: between(master, "<!-- v1 -->", "<!-- /v1 -->"), active: false },
    { title: "Master prompt PPT → guion", content: between(master, "<!-- v2 -->", "<!-- /v2 -->"), active: true },
  ]);
  await seedTextLineage(clientId, "image_system_prompt", [
    { title: "Image system prompt Roger That", content: codeBlock(section(generic, "## 1.")), active: false },
    { title: "Image system prompt Clear Petroleum", content: clearImagePrompt, active: true },
  ]);
  await seedTextLineage(clientId, "video_system_prompt", [
    { title: "Video system prompt Roger That", content: codeBlock(section(generic, "## 2.")), active: true },
  ]);
  await seedTextLineage(clientId, "negative_prompt", [
    {
      title: "Negativo estándar Clear Petroleum",
      content: lineAfter(clearImagePrompt, "STANDARD NEGATIVE LINE"),
      active: true,
    },
  ]);
  // reference_other admite varios textos e imágenes: se chequea por título.
  await ensureReferenceText(clientId, "Checklists de QA (imagen y video)", section(generic, "## 3."));
  await ensureReferenceText(clientId, "Calibración y pipeline Clear", section(clear, "## C."));
}

async function ensureReferenceText(clientId: string, title: string, content: string) {
  const { data } = await db
    .from("library_assets")
    .select("id")
    .eq("client_id", clientId)
    .eq("kind", "reference_other")
    .eq("title", title)
    .is("deleted_at", null)
    .maybeSingle();
  if (data) return;
  const { error } = await db
    .from("library_assets")
    .insert({ client_id: clientId, kind: "reference_other", title, text_content: content });
  if (error) throw error;
  console.log(`+ reference_other: ${title}`);
}

async function uploadSheet(clientId: string, file: string, title: string): Promise<string> {
  const storagePath = `${clientId}/character_sheet/seed-${safeFileName(file)}`;
  const { data: existing } = await db
    .from("library_assets")
    .select("id")
    .eq("client_id", clientId)
    .eq("storage_path", storagePath)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return existing.id;

  const image = readFileSync(path.join(SEED_DIR, "Character Sheets", file));
  const { error: uploadError } = await db.storage
    .from("library")
    .upload(storagePath, image, { contentType: "image/png", upsert: true });
  if (uploadError) throw new Error(`Subiendo ${file}: ${uploadError.message}`);
  await ensureThumbnail(db, "library", storagePath, image);

  const { data, error } = await db
    .from("library_assets")
    .insert({
      client_id: clientId,
      kind: "character_sheet",
      title: `Sheet ${title}`,
      storage_path: storagePath,
      mime_type: "image/png",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function seedCharacters(clientId: string) {
  const characters = JSON.parse(read("personajes.json")) as SeedCharacter[];
  for (const character of characters) {
    const { data: existing } = await db
      .from("characters")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", character.name)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      console.log(`· Personaje ${character.name} ya existe`);
      continue;
    }
    const sheetIds: string[] = [];
    for (const sheet of character.sheets) sheetIds.push(await uploadSheet(clientId, sheet.file, sheet.title));

    const { error } = await db.from("characters").insert({
      client_id: clientId,
      name: character.name,
      description: character.description,
      visual_notes: character.visual_notes,
      sheet_asset_ids: sheetIds,
      // Basados en empleados reales de Clear, con consentimiento firmado (confirmado por producción).
      based_on_real_person: true,
      consent_confirmed: true,
    });
    if (error) throw error;
    console.log(`+ Personaje ${character.name} (${sheetIds.length} sheet${sheetIds.length > 1 ? "s" : ""})`);
  }
}

async function seedLocations(clientId: string) {
  const locations = JSON.parse(read("locaciones.json")) as SeedLocation[];
  for (const location of locations) {
    const { data: existing } = await db
      .from("locations")
      .select("id")
      .eq("client_id", clientId)
      .eq("name", location.name)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      console.log(`· Locación ${location.name} ya existe`);
      continue;
    }
    const { error } = await db.from("locations").insert({ client_id: clientId, ...location });
    if (error) throw error;
    console.log(`+ Locación ${location.name}`);
  }
}

async function main() {
  const clientId = await getOrCreateClient();
  await seedTexts(clientId);
  await seedCharacters(clientId);
  await seedLocations(clientId);
  console.log("Seed completo.");
}

main().catch((error: unknown) => {
  console.error("El seed falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
