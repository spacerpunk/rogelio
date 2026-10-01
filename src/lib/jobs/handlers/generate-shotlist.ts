import { getTextEngine } from "@/lib/engines/registry";
import { activeTextContent, loadProjectContext } from "@/lib/pipeline/context";
import { SHOTLIST_SYSTEM, buildShotlistPrompt, estimateDuration, shotlistOutputSchema } from "@/lib/pipeline/shotlist";
import type { JobHandler } from "../types";

export const generateShotlist: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const context = await loadProjectContext(db, job.project_id);

  const { data: script } = await db
    .from("scripts")
    .select("version, content")
    .eq("project_id", job.project_id)
    .eq("status", "approved")
    .is("deleted_at", null)
    .maybeSingle();
  if (!script) throw new Error("No hay un guion aprobado: aprobá una versión antes de generar el shot list.");

  const styleBible = await activeTextContent(db, context.project.client_id, "style_bible");
  const engine = getTextEngine(context.project.text_engine);
  await ctx.progress(0, 1, `${engine.label} está armando el shot list (guion v${script.version})`);
  const result = await ctx.track(engine, "generate_shotlist", () =>
    engine.structured(
      {
        system: SHOTLIST_SYSTEM,
        content: buildShotlistPrompt({
          scriptVersion: script.version,
          script: script.content,
          styleBible,
          characters: context.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description })),
          locations: context.locations.map((l) => ({ id: l.id, name: l.name, description: l.description })),
        }),
        maxTokens: 64_000,
        effort: "medium",
      },
      shotlistOutputSchema,
    ),
  );

  const shots = result.data.shots;
  if (shots.length === 0) throw new Error(`${engine.label} no devolvió planos. Revisá que el guion tenga tomas.`);

  // Solo ids que existen en la biblioteca del cliente.
  const characterIds = new Set(context.characters.map((c) => c.id));
  const locationIds = new Set(context.locations.map((l) => l.id));
  let droppedIds = 0;

  // El shot list anterior no se borra: queda como historial (borrado lógico).
  await db
    .from("shots")
    .update({ deleted_at: new Date().toISOString() })
    .eq("project_id", job.project_id)
    .is("deleted_at", null);

  const rows = shots.map((s, i) => {
    const validCharacters = s.character_ids.filter((id) => characterIds.has(id));
    droppedIds += s.character_ids.length - validCharacters.length;
    const validLocation = s.location_id && locationIds.has(s.location_id) ? s.location_id : null;
    if (s.location_id && !validLocation) droppedIds++;
    return {
      project_id: job.project_id,
      script_version: script.version,
      order_index: i,
      scene_number: s.scene_number,
      scene_title: s.scene_title || null,
      character_ids: [...new Set(validCharacters)],
      location_id: validLocation,
      framing: s.framing,
      lighting: s.lighting || null,
      action: s.action || null,
      vo_line: s.vo_line || null,
      on_screen_text: s.on_screen_text || null,
      est_duration_sec: estimateDuration(s.vo_line),
      notes: s.notes || null,
    };
  });
  const { error } = await db.from("shots").insert(rows);
  if (error) throw new Error(`No se pudo guardar el shot list: ${error.message}`);

  await ctx.progress(1, 1, "Listo");
  return { shots: rows.length, scriptVersion: script.version, droppedIds };
};
