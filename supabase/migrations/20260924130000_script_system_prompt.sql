-- System prompt para generar el guion (el "master prompt" de PPT a guion).
alter type public.asset_kind add value if not exists 'script_system_prompt' after 'style_bible';
