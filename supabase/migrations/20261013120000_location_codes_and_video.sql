-- Locaciones con código de plate (P1, P7…) para citarlas en guiones, y generación de video (clips)
-- a partir del frame aprobado de cada plano.

-- ---------------------------------------------------------------------------
-- Locaciones: código corto de plate
-- ---------------------------------------------------------------------------

alter table public.locations add column code text;
comment on column public.locations.code is 'Código de la plate (ej. P7). El guion y el shot list citan la locación como "P7 · Campamento".';
create unique index locations_client_code_key on public.locations (client_id, lower(code))
  where deleted_at is null and code is not null;

-- ---------------------------------------------------------------------------
-- Video
-- ---------------------------------------------------------------------------

alter type public.job_type add value if not exists 'generate_video_prompts';
alter type public.job_type add value if not exists 'generate_clips';
alter type public.project_status add value if not exists 'clips' after 'frames';

-- Motor, modelo y ajustes de video por proyecto. Null = el default de .env.local.
alter table public.projects
  add column video_engine text,
  add column video_model text,
  add column video_resolution text not null default '720p' check (video_resolution in ('360p', '720p', '1080p', '4k')),
  add column video_logo boolean not null default false;

comment on column public.projects.video_engine is 'Motor de video para los clips (gemini = Gemini Omni).';
comment on column public.projects.video_logo is 'Modo logo del system prompt de video: true = el parche del logo del cliente se mantiene en el pecho.';

-- Prompt de video por plano: se escribe mirando el frame aprobado (video_prompt_frame_id).
-- Si el frame aprobado cambia, el prompt quedó desactualizado.
alter table public.shots
  add column video_negative text,
  add column video_prompt_frame_id uuid references public.frames (id),
  add column video_duration_sec numeric(5, 2),
  add column video_qa_notes text,
  add column video_prompt_generated_at timestamptz;

comment on column public.shots.video_negative is 'Línea Avoid del clip. Los motores sin campo negativo la reciben al final del prompt.';
comment on column public.shots.video_duration_sec is 'Segundos a generar (incluye un margen para recortar en la edición).';
comment on column public.shots.video_qa_notes is 'Correcciones antes de animar: lo que el motor de texto vio mal en el frame aprobado.';

alter table public.clips
  add column variant_index integer not null default 1,
  add column model text,
  add column prompt_used text,
  add column negative_used text,
  add column resolution text,
  add column aspect_ratio text,
  add column rejected boolean not null default false,
  add column review_notes text,
  add column cost_usd numeric(10, 4) not null default 0,
  add column job_id uuid references public.jobs (id);

-- Un solo clip aprobado por plano.
create unique index clips_one_selected_per_shot on public.clips (shot_id)
  where selected and deleted_at is null;
create index clips_job_idx on public.clips (job_id);
