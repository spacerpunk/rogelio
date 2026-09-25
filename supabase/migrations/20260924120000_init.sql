-- Roger That Studio — esquema inicial (fase 1 + tablas preparadas para fase 2)
--
-- Convenciones:
--   * Todas las tablas tienen id uuid, created_at, updated_at, deleted_at (soft delete).
--   * La app no tiene login: todo el acceso es desde el servidor con service role.
--     anon y authenticated no tienen permisos sobre el esquema (RLS activo y sin políticas).
--   * Nadie tiene DELETE ni TRUNCATE, tampoco el service role: el borrado es siempre lógico (deleted_at).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.asset_kind as enum (
  'style_bible',
  'image_system_prompt',
  'video_system_prompt',
  'negative_prompt',
  'ppe_sheet',
  'logo',
  'character_sheet',
  'location_plate',
  'reference_other'
);

create type public.project_status as enum ('draft', 'script', 'shotlist', 'frames', 'done');
create type public.script_status as enum ('draft', 'approved');
create type public.shot_framing as enum ('hero', 'wide', 'medium', 'closeup', 'insert', 'group');
create type public.shot_status as enum ('draft', 'approved', 'frame_selected');
create type public.job_type as enum (
  'extract_source',
  'generate_script',
  'generate_shotlist',
  'generate_prompts',
  'generate_frames'
);
create type public.job_status as enum ('queued', 'running', 'done', 'error');

-- ---------------------------------------------------------------------------
-- Biblioteca del cliente
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index clients_slug_key on public.clients (slug) where deleted_at is null;

create table public.library_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  kind public.asset_kind not null,
  title text not null,
  text_content text,
  storage_path text,
  mime_type text,
  -- Todas las versiones de un mismo asset comparten lineage_id; una versión nueva copia el de la anterior.
  lineage_id uuid not null default gen_random_uuid(),
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint library_assets_content_check check (text_content is not null or storage_path is not null)
);
create index library_assets_client_kind_idx on public.library_assets (client_id, kind) where deleted_at is null;
create unique index library_assets_lineage_version_key on public.library_assets (lineage_id, version);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  name text not null,
  role text,
  description text,
  visual_notes text,
  sheet_asset_ids uuid[] not null default '{}',
  based_on_real_person boolean not null default false,
  consent_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index characters_client_idx on public.characters (client_id) where deleted_at is null;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  name text not null,
  description text,
  plate_asset_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index locations_client_idx on public.locations (client_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  title text not null,
  status public.project_status not null default 'draft',
  target_duration_sec integer check (target_duration_sec is null or target_duration_sec > 0),
  aspect_ratio text not null default '16:9',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_client_idx on public.projects (client_id) where deleted_at is null;

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  order_index integer not null default 0,
  file_name text not null,
  mime_type text not null,
  storage_path text,
  extracted_text text,
  extracted_notes text,
  extracted_images text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index sources_project_idx on public.sources (project_id, order_index) where deleted_at is null;

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  version integer not null,
  content text not null default '',
  status public.script_status not null default 'draft',
  generation_params jsonb not null default '{}',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index scripts_project_version_key on public.scripts (project_id, version);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  script_version integer not null,
  order_index integer not null,
  scene_number integer not null,
  scene_title text,
  character_ids uuid[] not null default '{}',
  location_id uuid references public.locations (id),
  framing public.shot_framing not null default 'medium',
  lighting text,
  action text,
  vo_line text,
  on_screen_text text,
  est_duration_sec numeric(7, 2),
  image_prompt text,
  image_negative text,
  video_prompt text,
  status public.shot_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index shots_project_order_idx on public.shots (project_id, order_index) where deleted_at is null;

create table public.frames (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots (id),
  variant_index integer not null,
  storage_path text not null,
  engine text not null,
  model text not null,
  prompt_used text not null,
  reference_asset_ids uuid[] not null default '{}',
  selected boolean not null default false,
  rejected boolean not null default false,
  review_notes text,
  cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index frames_shot_idx on public.frames (shot_id) where deleted_at is null;
-- Un solo frame elegido por plano.
create unique index frames_one_selected_per_shot on public.frames (shot_id)
  where selected and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Trabajos asíncronos y registro de costos
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  shot_id uuid references public.shots (id),
  type public.job_type not null,
  status public.job_status not null default 'queued',
  payload jsonb not null default '{}',
  result jsonb,
  error text,
  -- Progreso para trabajos en lote: { "done": n, "total": m, "message": "..." }
  progress jsonb,
  cost_usd numeric(10, 4) not null default 0,
  attempts integer not null default 0,
  worker_id text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index jobs_project_idx on public.jobs (project_id, created_at desc) where deleted_at is null;
create index jobs_queue_idx on public.jobs (created_at) where status = 'queued' and deleted_at is null;

-- Una fila por llamada a un motor (texto, imagen, y en fase 2 voz y video).
create table public.engine_calls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id),
  job_id uuid references public.jobs (id),
  engine text not null,
  model text not null,
  operation text not null,
  duration_ms integer not null,
  input_tokens integer,
  output_tokens integer,
  image_count integer,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index engine_calls_project_idx on public.engine_calls (project_id, created_at desc);
create index engine_calls_job_idx on public.engine_calls (job_id);

create view public.project_costs
with (security_invoker = true)
as
select
  p.id as project_id,
  coalesce(sum(ec.cost_usd), 0)::numeric(12, 4) as cost_usd,
  count(ec.id)::integer as call_count
from public.projects p
left join public.engine_calls ec on ec.project_id = p.id and ec.deleted_at is null
group by p.id;

-- Toma atómicamente el próximo trabajo en cola. Solo lo usa el worker (service role).
create or replace function public.claim_next_job(p_worker_id text)
returns setof public.jobs
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.jobs j
     set status = 'running',
         worker_id = p_worker_id,
         attempts = j.attempts + 1,
         started_at = now(),
         heartbeat_at = now(),
         error = null
   where j.id = (
     select q.id
       from public.jobs q
      where q.status = 'queued' and q.deleted_at is null
      order by q.created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

revoke execute on function public.claim_next_job(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fase 2 (tablas vacías, preparadas)
-- ---------------------------------------------------------------------------

create table public.voiceovers (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots (id),
  voice_id text,
  audio_path text,
  duration_sec numeric(7, 2),
  timestamps jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index voiceovers_shot_idx on public.voiceovers (shot_id) where deleted_at is null;

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots (id),
  frame_id uuid references public.frames (id),
  engine text,
  video_path text,
  duration_sec numeric(7, 2),
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index clips_shot_idx on public.clips (shot_id) where deleted_at is null;

create table public.timelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  version integer not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index timelines_project_version_key on public.timelines (project_id, version);

-- ---------------------------------------------------------------------------
-- updated_at + permisos: esquema cerrado para anon/authenticated, sin borrado físico
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'library_assets', 'characters', 'locations', 'projects', 'sources',
    'scripts', 'shots', 'frames', 'jobs', 'engine_calls', 'voiceovers', 'clips', 'timelines'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('revoke delete, truncate on public.%I from service_role', t);
  end loop;
end;
$$;

revoke all on public.project_costs from anon, authenticated;

-- Las tablas y funciones de migraciones futuras también nacen cerradas para anon/authenticated.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage (buckets privados; solo el servidor accede, con service role)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('library', 'library', false, 52428800),    -- 50 MiB: sheets, plates, EPP, logos
  ('projects', 'projects', false, 209715200)  -- 200 MiB: fuentes, frames, luego audio y video
on conflict (id) do nothing;
