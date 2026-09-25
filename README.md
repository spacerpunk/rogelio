# Roger That Studio

Hub interno para convertir briefs y presentaciones de clientes en videos de capacitación con IA.
La especificación completa está en [CLAUDE.md](CLAUDE.md). Este repo implementa la fase 1: biblioteca del
cliente, ingesta, guion, shot list, prompts de imagen y frames.

## Requisitos

- Node.js 24+
- Docker Desktop corriendo (para Supabase local)

## Puesta en marcha

```bash
npm install
npm run db:start          # levanta Supabase local y aplica las migraciones
cp .env.example .env.local # completar con los valores de `npm run db:status` y las API keys
npm run seed              # carga Clear Petroleum desde seed/clear/
npm run dev               # web (http://localhost:3000) + worker de trabajos
```

La app **no tiene login**: cualquiera que llegue al puerto puede usarla (y gastar créditos de los
motores). Correrla solo en la máquina local o en una red privada/VPN.

### Variables de entorno

| Variable | Para qué |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase. La clave anónima solo sirve para subir archivos con URLs firmadas. |
| `SUPABASE_SERVICE_ROLE_KEY` | Todo el acceso a la base (solo servidor y worker). |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude: lectura de PDFs, guion, shot list y prompts. Recomendado `claude-opus-5`. |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL` | Gemini "Nano Banana". Recomendado `gemini-3.1-flash-image`. |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` | OpenAI Images. Por ejemplo `gpt-image-2.5-sunburst` (precisión) o `gpt-image-2.5-flare` (rápido). |
| `DEFAULT_IMAGE_ENGINE` | `gemini` u `openai`. |
| `WORKER_CONCURRENCY` | Trabajos en paralelo del worker (por defecto 3). |
| `ENGINE_MOCK` | `1` = motores simulados, sin claves ni costo (para probar la UI). |

### Puertos

Supabase local usa el rango **443xx** (API 44321, DB 44322, Studio 44323, Mailpit 44324) en vez del
54321–54329 por defecto, porque Windows (Hyper-V/WinNAT) reserva ese rango en esta máquina.
Se configura en `supabase/config.toml`. Si Docker Desktop se reinicia y la API deja de responder,
`npm run db:stop` + `npm run db:start` rehace los puertos (los datos se conservan).

## Flujo

1. **Biblioteca** (`/clients/[id]`): textos versionados (style bible, system prompts de guion, imagen y
   video, negativo), personajes con descriptor visual y sheets, locaciones con plates, y referencias
   (hoja de EPP, logo). Cada texto guarda versiones; una por tipo está "en uso".
2. **Fuentes**: PDF (lo lee Claude), PPTX (texto, notas del orador e imágenes con JSZip), DOCX (mammoth),
   TXT/MD o texto pegado. El texto extraído se revisa y edita antes de seguir.
3. **Guion**: Claude usa el master prompt del cliente + un formato fijo de escenas y tomas numeradas.
   Editor Markdown con versiones, "Regenerar con indicaciones" y "Aprobar guion".
4. **Shot list**: salida estructurada de Claude validada con Zod, solo con personajes y locaciones de la
   biblioteca. Tabla editable: reordenar arrastrando, dividir, fusionar, agregar y borrar planos. La
   duración sale de la locución (~2,5 palabras/s). Editar un plano aprobado lo vuelve a borrador.
5. **Frames**: Claude escribe `image_prompt`/`image_negative` (image system prompt) y un borrador de
   `video_prompt` (video system prompt). Cada plano adjunta solo sus sheets, la plate de la locación y la
   hoja de EPP. Variantes por plano o en lote, elegir, rechazar, notas de revisión y cambio de motor.
   Si el plano cambia después de generar el prompt, se marca como desactualizado.

Cada llamada a un motor queda en `engine_calls` (modelo, duración, tokens y costo estimado); el costo
del proyecto y su desglose están en el encabezado del proyecto.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Web + worker (el worker se reinicia al cambiar código) |
| `npm run dev:web` / `npm run worker` | Solo la web / solo el worker |
| `npm run check` | Lint + typecheck |
| `npm run seed` | Carga Clear Petroleum (idempotente: no pisa lo que ya existe) |
| `npm run db:start` / `db:stop` / `db:status` | Supabase local |
| `npm run db:reset` | Recrea la base local desde las migraciones (borra los datos locales) |
| `npm run db:types` | Regenera `src/lib/supabase/database.types.ts` |

## Estructura

```
supabase/migrations/     esquema, permisos, buckets y vistas de costos
seed/clear/              documentos, sheets y JSON de personajes/locaciones de Clear Petroleum
scripts/                 seed y generación de tipos
worker/                  proceso que ejecuta la tabla jobs
src/lib/engines/         adaptadores: Claude (texto), Gemini y OpenAI (imagen), simulados, precios y reintentos
src/lib/jobs/            cola, runner y handlers (extracción, guion, shot list, prompts, frames)
src/lib/pipeline/        prompts y reglas de cada etapa
src/lib/ingest/          extractores de PPTX y DOCX
src/app/                 pantallas (App Router) y server actions
```

## Trabajos largos

Las acciones de la UI no llaman a los motores: encolan una fila en `jobs`. El worker las toma con
`claim_next_job()` (`FOR UPDATE SKIP LOCKED`), manda heartbeats, registra costos y marca el resultado. Si
el worker se corta, los trabajos colgados se reencolan (hasta 3 intentos). La UI hace polling y se
refresca al terminar cada trabajo o cada plano de un lote. En la fase 2 alcanza con reemplazar el worker
por una cola (Trigger.dev o similar).

## Seguridad y datos

- Todo el acceso a la base es desde el servidor con service role (`src/lib/supabase/server.ts`, marcado
  `server-only`). RLS está activo sin políticas y `anon` / `authenticated` no tienen permisos.
- **No hay DELETE ni TRUNCATE para nadie**, tampoco para el service role: el borrado es lógico (`deleted_at`).
- Buckets privados `library` y `projects`; el navegador ve imágenes por URLs firmadas de 1 hora.
- Los personajes basados en personas reales sin consentimiento confirmado no generan frames.
