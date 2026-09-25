-- Prompts por plano: huella de los datos con los que se generaron, para detectar prompts desactualizados.
alter table public.shots
  add column prompt_inputs_hash text,
  add column prompts_generated_at timestamptz;

-- Frames: negativo usado y trabajo que los generó (agrupa las variantes de una misma tanda).
alter table public.frames
  add column negative_used text,
  add column job_id uuid references public.jobs (id);

create index frames_job_idx on public.frames (job_id);
