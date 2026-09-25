# Roger That Studio: hub de producción de videos con IA

## Qué es
Webapp interna de Roger That para convertir briefs y presentaciones (PDF, DOCX, PPTX) de clientes en videos de capacitación. El flujo completo es: fuente → guion → escenas y planos (shot list) → voz en off → frames → clips → timeline → video final.

Este repo implementa la **fase 1**: biblioteca del cliente, ingesta, guion, shot list, prompts de imagen y frames. Voz en off, clips, timeline y render son fases 2 y 3 (ver "Fuera de alcance"), pero el modelo de datos ya debe contemplarlos.

Usuario principal: productor/a de Roger That. Sin login: la app no tiene autenticación y todo el acceso a Supabase es desde el servidor con service role. La interfaz va en español (Argentina), el código y los nombres de tablas en inglés.

## Principios
1. **Humano en el loop.** El sistema avanza solo, pero cada etapa termina en un punto de aprobación: guion aprobado, shot list aprobado, frame elegido por plano. Nada pasa a la etapa siguiente sin aprobación.
2. **El shot list es la columna vertebral.** Cada plano es un registro estructurado; todo lo demás (prompts, frames, VO, clips, orden del timeline) se deriva de sus campos.
3. **La biblioteca del cliente se adjunta sola.** Si un plano tiene personajes y locación, el generador de imágenes recibe automáticamente las character sheets de esos personajes, la location plate y la hoja de EPP del cliente como imágenes de referencia, más el system prompt del cliente.
4. **Motores intercambiables.** Cada proveedor (Claude, Gemini, OpenAI, ElevenLabs, etc.) se usa detrás de un adaptador con interfaz común. Los nombres de modelo van en variables de entorno, nunca hardcodeados. Antes de implementar un adaptador, verificar en la documentación oficial vigente el nombre del modelo y el formato de la API.
5. **Regenerar sin romper.** Cambiar un plano regenera solo lo que depende de él. Todo se versiona; nada se borra de forma definitiva (soft delete).
6. **Costo visible.** Cada llamada a un motor registra modelo, duración y costo estimado, sumado por proyecto.

## Stack
- Next.js (App Router) + TypeScript estricto
- Tailwind + shadcn/ui
- Supabase: Postgres, Storage (archivos e imágenes). Sin Auth.
- Zod para validar toda salida estructurada de los modelos
- `@anthropic-ai/sdk` para texto (guion, shot list, prompts, lectura de documentos)
- Gemini API (Nano Banana) y OpenAI Images como motores de imagen, ambos con soporte de imágenes de referencia
- Trabajos largos: tabla `jobs` + ejecución asíncrona con polling desde la UI. En fase 2 migrar a una cola (Trigger.dev o similar) para video.

Claves solo del lado del servidor, en `.env.local` (nunca en el cliente ni en el repo). Crear `.env.example` con todas las variables:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=
DEFAULT_IMAGE_ENGINE=gemini
```

## Modelo de datos (Postgres)
Todas las tablas con `id uuid`, `created_at`, `updated_at`, `deleted_at` (soft delete).

- `clients`: name, slug, notes
- `library_assets`: client_id, kind (`style_bible` | `image_system_prompt` | `video_system_prompt` | `negative_prompt` | `ppe_sheet` | `logo` | `reference_other`), title, text_content (para prompts y textos), storage_path (para imágenes), version, is_active
- `characters`: client_id, name, role, description, visual_notes, sheet_asset_ids (uuid[] de library_assets), based_on_real_person (bool), consent_confirmed (bool)
- `locations`: client_id, name, description, plate_asset_ids (uuid[])
- `projects`: client_id, title, status (`draft` | `script` | `shotlist` | `frames` | `done`), target_duration_sec, aspect_ratio (default 16:9), notes
- `sources`: project_id, file_name, mime_type, storage_path, extracted_text, extracted_notes (notas del orador de PPTX), extracted_images (paths)
- `scripts`: project_id, version, content (markdown), status (`draft` | `approved`), generation_params (jsonb)
- `shots`: project_id, script_version, order_index, scene_number, scene_title, character_ids (uuid[]), location_id, framing (`hero` | `wide` | `medium` | `closeup` | `insert` | `group`), lighting, action, vo_line, on_screen_text, est_duration_sec, image_prompt, image_negative, video_prompt, status (`draft` | `approved` | `frame_selected`), notes
- `frames`: shot_id, variant_index, storage_path, engine, model, prompt_used, reference_asset_ids (uuid[]), selected (bool), rejected (bool), review_notes, cost_usd
- `jobs`: project_id, shot_id (nullable), type (`extract_source` | `generate_script` | `generate_shotlist` | `generate_prompts` | `generate_frames`), status (`queued` | `running` | `done` | `error`), payload (jsonb), result (jsonb), error, cost_usd, started_at, finished_at
- Preparados para fase 2 (crear tablas vacías): `voiceovers` (shot_id, voice_id, audio_path, duration_sec, timestamps jsonb), `clips` (shot_id, frame_id, engine, video_path, duration_sec, selected), `timelines` (project_id, version, data jsonb)

Storage: bucket `library` (por cliente), bucket `projects` (por proyecto: sources, frames, luego audio y video).

## Pipeline de la fase 1

### 1. Biblioteca del cliente
CRUD de clientes, assets, personajes y locaciones. Subida de imágenes (character sheets, plates, EPP, logo) y edición de textos (style bible, system prompts, negativos).
**Seed:** la carpeta `/seed/clear/` contiene los documentos de prompts del cliente Clear Petroleum (style bible, system prompts de imagen y video, prompts de personajes, likeness, turnarounds y location plates). Crear un script `npm run seed` que cree el cliente "Clear Petroleum", cargue esos textos como `library_assets` y cree los personajes y locaciones que se mencionan. Las imágenes de las sheets las subo yo desde la UI.

### 2. Ingesta
Subir uno o varios archivos al proyecto.
- PDF: enviarlo a Claude como documento y pedir extracción ordenada del contenido.
- PPTX: descomprimir (JSZip) y extraer texto de cada slide y sus notas en orden; guardar las imágenes embebidas.
- DOCX: extraer texto (mammoth).
- Texto pegado: también válido como fuente.
Mostrar el texto extraído, editable, antes de seguir.

### 3. Guion
Claude genera el guion a partir de las fuentes + style bible + parámetros (duración objetivo, tono, público, personajes disponibles del cliente). Formato: escenas numeradas, con descripción visual y líneas de voz en off. Editor markdown con versiones, botón "Regenerar con indicaciones" y botón "Aprobar guion".

### 4. Shot list
Desde el guion aprobado, Claude devuelve el shot list como JSON (tool use con schema, validado con Zod) usando solo personajes y locaciones existentes del cliente (se le pasan con sus ids). Vista de tabla editable: reordenar (drag), dividir y fusionar planos, cambiar personajes, locación y encuadre, editar la línea de VO. Duración estimada por plano a partir de la línea de VO (~2,5 palabras por segundo en español) y total del video visible arriba. Botón "Aprobar shot list".

### 5. Prompts de imagen
Por cada plano, Claude escribe `image_prompt` e `image_negative` usando el image system prompt activo del cliente como system prompt y los campos del plano como input. Editables a mano en la UI. Generar también un borrador de `video_prompt` con el video system prompt (se usa en fase 2).

### 6. Frames
Por plano: generar N variantes (default 4) con el motor elegido. Referencias adjuntas automáticamente: sheets de los personajes del plano + plate de la locación + hoja de EPP. Vista en grilla por plano: elegir una, rechazar, regenerar con prompt editado, cambiar de motor, agregar nota de revisión (ej. revisión de HSE). Generación en lote para todo el proyecto con progreso visible.

## Adaptadores
```ts
interface TextEngine { complete(opts): Promise<{ text; usage; costUsd }>; structured<T>(opts, schema): Promise<{ data: T; usage; costUsd }> }
interface ImageEngine { generate(opts: { prompt; negative?; references: Buffer[]; aspectRatio; n }): Promise<{ images: Buffer[]; model; costUsd }> }
```
Implementar `ClaudeTextEngine`, `GeminiImageEngine`, `OpenAIImageEngine`. Registro central de motores; la UI elige por nombre. Manejar reintentos con backoff y errores de rate limit y de contenido bloqueado mostrando el motivo en la UI.

## Pantallas
- `/clients` y `/clients/[id]`: biblioteca (pestañas: Textos, Personajes, Locaciones, Referencias)
- `/projects`: lista con cliente, estado y costo acumulado
- `/projects/[id]`: stepper horizontal Fuentes → Guion → Shot list → Frames, con indicador de aprobación en cada paso y costo del proyecto
- Diseño limpio y denso, pensado para trabajar muchas horas; modo oscuro.

## Fuera de alcance (fases 2 y 3)
Voz en off con ElevenLabs (por plano, con timestamps que fijan la duración de cada clip), clips con Veo/Seedance vía adaptadores, timeline con Remotion, render y export a Premiere/DaVinci (XML u OTIO). No implementar ahora; solo dejar tablas y la interfaz de adaptadores lista para sumarlos.

## Forma de trabajo
Trabajar por hitos, en este orden. Al terminar cada uno: correr lint y typecheck, probarlo, resumir qué quedó hecho y qué falta, y **esperar mi revisión antes de seguir**.
- M0: scaffold Next.js + Tailwind + shadcn, Supabase local o remoto, migraciones, `.env.example`
- M1: biblioteca del cliente + `npm run seed` con Clear
- M2: proyectos + ingesta de fuentes
- M3: guion
- M4: shot list
- M5: prompts de imagen + frames con un motor (Gemini)
- M6: segundo motor (OpenAI), generación en lote, contador de costos, pulido

Si algo de este documento es ambiguo o hay una decisión técnica con tradeoffs importantes, preguntar antes de implementar.
