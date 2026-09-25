-- Desglose de costos por proyecto: operación, motor y modelo.
create view public.project_cost_breakdown
with (security_invoker = true)
as
select
  ec.project_id,
  ec.operation,
  ec.engine,
  ec.model,
  count(*)::integer as calls,
  count(*) filter (where ec.error is not null)::integer as errors,
  coalesce(sum(ec.cost_usd), 0)::numeric(12, 4) as cost_usd,
  coalesce(sum(ec.duration_ms), 0)::bigint as duration_ms,
  coalesce(sum(ec.image_count), 0)::integer as images,
  max(ec.created_at) as last_call_at
from public.engine_calls ec
where ec.deleted_at is null
group by ec.project_id, ec.operation, ec.engine, ec.model;

revoke all on public.project_cost_breakdown from anon, authenticated;
