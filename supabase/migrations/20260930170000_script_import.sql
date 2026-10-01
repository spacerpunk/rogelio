-- Guion subido por el usuario: importarlo desde un archivo (DOCX, PDF, TXT, MD) y, opcionalmente,
-- adaptarlo al formato de escenas y tomas de la app.
alter type public.job_type add value if not exists 'import_script';
alter type public.job_type add value if not exists 'adapt_script';
