-- ============================================================================
-- Migración: portal por proyecto (12 nov 2026)
--   portal_billing devuelve también a qué proyecto del OPS pertenece cada
--   factura y cada cuota (project_id, por su proyecto de Finanzas), para que el
--   portal enseñe en cada proyecto sus facturas. Mismo control de acceso.
-- ============================================================================

begin;

create or replace function portal_billing(p_client uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  cid uuid := portal_my_client();
begin
  if cid is null then
    if p_client is null or not can_see_finance() then
      return null;
    end if;
    cid := p_client;
  end if;
  if exists (select 1 from clients where id = cid and portal_off) then
    return null;
  end if;

  return jsonb_build_object(
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'number', i.number,
        'concept', coalesce(nullif(trim(i.portal_concept), ''), trim(split_part(i.concept, ' · ', 1))),
        'date', i.date,
        'kind', i.kind,
        'status', i.status,
        'eur', i.eur,
        'usd', i.usd,
        'project_id', fp.project_id,
        'pdf', exists (
          select 1 from storage.objects o
          where o.bucket_id = 'invoices' and o.name = cid::text || '/' || i.number || '.pdf'
        )
      ) order by i.date desc, i.number desc)
      from fin_invoices i
      left join fin_projects fp on fp.id = i.fin_project_id
      where i.client_id = cid
    ), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object('title', r.title, 'eur', r.client_eur_month, 'project_id', fp.project_id) order by fp.position)
      from (
        select distinct on (fin_project_id) * from fin_recurrences
        where active and client_eur_month > 0
        order by fin_project_id, slot
      ) r
      join fin_projects fp on fp.id = r.fin_project_id
      where fp.client_id = cid
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function portal_billing(uuid) from public, anon;
grant execute on function portal_billing(uuid) to authenticated;

commit;
