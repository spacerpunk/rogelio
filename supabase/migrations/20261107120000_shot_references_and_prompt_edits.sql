-- Referencias editables por plano y edición de prompts con el motor de texto.
--
-- Las referencias automáticas (sheets de los personajes, plates de la locación, hojas de EPP) se siguen
-- calculando desde la biblioteca; por plano se pueden quitar algunas (excluded_*_reference_ids) y sumar
-- otras (shot_references): una imagen subida solo para ese plano, cualquier imagen de la biblioteca del
-- cliente o un frame del proyecto (por continuidad).

alter type public.job_type add value if not exists 'edit_prompt';

-- ---------------------------------------------------------------------------
-- Referencias manuales por plano
-- ---------------------------------------------------------------------------

create table public.shot_references (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots (id),
  -- Para qué generación cuenta: los frames (image) o los clips (video).
  target text not null check (target in ('image', 'video')),
  source text not null check (source in ('upload', 'library', 'frame')),
  asset_id uuid references public.library_assets (id),
  frame_id uuid references public.frames (id),
  -- Solo para source = upload: ruta en el bucket projects.
  storage_path text,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (source = 'upload' and storage_path is not null)
    or (source = 'library' and asset_id is not null)
    or (source = 'frame' and frame_id is not null)
  )
);

comment on table public.shot_references is 'Referencias que se suman a mano a un plano, además de las automáticas de la biblioteca.';
comment on column public.shot_references.label is 'Cómo se le nombra la imagen al motor (y en la UI).';

create index shot_references_shot_idx on public.shot_references (shot_id) where deleted_at is null;

create trigger shot_references_set_updated_at before update on public.shot_references
  for each row execute function public.set_updated_at();
alter table public.shot_references enable row level security;
revoke all on public.shot_references from anon, authenticated;
revoke delete, truncate on public.shot_references from service_role;

-- Referencias automáticas que se quitaron de un plano (ids de library_assets).
alter table public.shots
  add column excluded_image_reference_ids uuid[] not null default '{}',
  add column excluded_video_reference_ids uuid[] not null default '{}',
  -- Qué referencias había cuando se escribió el prompt: si cambian, el prompt puede nombrarlas mal.
  add column image_prompt_references_key text,
  add column video_prompt_references_key text;

-- Qué se adjuntó de verdad en cada generación (automáticas y manuales): [{ label, bucket, path }].
alter table public.frames add column references_used jsonb;
alter table public.clips add column references_used jsonb;
