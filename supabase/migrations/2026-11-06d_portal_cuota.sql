-- ============================================================================
-- Migración: portal del cliente, cuota mensual = solo el tramo en curso (6 nov)
--   dPagès tiene activos los dos tramos (350 meses 1-6 y 150 desde el 7) y el
--   portal enseñaba los dos. Ahora sale solo el primero activo de cada proyecto.
--   OJO: en abril 2027 hay que desactivar el tramo 1 de dPagès en Finanzas.
-- ============================================================================

begin;

-- Facturas y pagos del cliente. p_client: vista previa (solo propietarios).
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
    if p_client is null or not is_owner() then
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
        'pdf', exists (
          select 1 from storage.objects o
          where o.bucket_id = 'invoices' and o.name = cid::text || '/' || i.number || '.pdf'
        )
      ) order by i.date desc, i.number desc)
      from fin_invoices i
      where portal_invoice_of(i, cid)
    ), '[]'::jsonb),
    'fees', coalesce((
      -- Solo el tramo en curso de cada proyecto (el primero activo): dPagès
      -- tiene activos los dos (meses 1-6 y mes 7+) y no se deben sumar.
      select jsonb_agg(jsonb_build_object('title', r.title, 'eur', r.client_eur_month) order by fp.position)
      from (
        select distinct on (fin_project_id) * from fin_recurrences
        where active and client_eur_month > 0
        order by fin_project_id, slot
      ) r
      join fin_projects fp on fp.id = r.fin_project_id
      left join projects p on p.id = fp.project_id
      where r.active and r.client_eur_month > 0
        and (p.client_id = cid
             or (fp.project_id is null
                 and portal_slug(fp.name) like (select portal_slug(c.name) from clients c where c.id = cid) || '%'))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function portal_billing(uuid) from public, anon;
grant execute on function portal_billing(uuid) to authenticated;

commit;

