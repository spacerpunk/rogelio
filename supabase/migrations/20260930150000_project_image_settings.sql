-- Ajustes de imagen por proyecto: modelo exacto y resolución (el formato ya está en aspect_ratio).
-- image_model null = el primer modelo de la lista de .env.local para el motor elegido.
alter table public.projects
  add column image_model text,
  add column image_size text not null default '2K' check (image_size in ('1K', '2K', '4K'));

comment on column public.projects.image_model is 'Modelo de imagen (ej. gemini-3.1-flash-image = Nano Banana 2). Debe estar en la lista de .env.local del motor.';
comment on column public.projects.image_size is 'Resolución de los frames: 1K, 2K o 4K (Gemini). OpenAI usa tamaños fijos por formato.';
