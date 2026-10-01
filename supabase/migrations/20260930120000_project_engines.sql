-- Motores elegidos por proyecto. Null = el default de .env.local (DEFAULT_TEXT_ENGINE / DEFAULT_IMAGE_ENGINE).
-- Los nombres se validan en la app contra el registro de motores (src/lib/engines/registry.ts).
alter table public.projects
  add column text_engine text,
  add column image_engine text;

comment on column public.projects.text_engine is 'Motor de texto: lectura de PDFs, guion, shot list y prompts (claude | openai | gemini).';
comment on column public.projects.image_engine is 'Motor de imagen para los frames (gemini | openai).';
