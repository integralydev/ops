-- ============================================================================
-- Migración: "Facturas y pagos" en el portal del cliente (6 nov 2026)
--
--   El cliente ve SUS facturas (número, concepto, fecha, importe emitido,
--   estado y el PDF), lo que tiene pendiente de pago y su cuota mensual activa.
--   Nunca ve: lo recibido real por el banco, comisiones, costes de dev,
--   márgenes, notas internas ni nada del resto de Finanzas.
--
--   - fin_invoices.portal_concept: concepto limpio para el cliente. El
--     concepto interno lleva a veces notas ("· recibido $… (wire, comisión…)").
--     Si está vacío, el portal usa el concepto interno cortado en " · ".
--   - Bucket privado "invoices": PDF de cada factura en "<client_id>/<número>.pdf".
--     Subir: propietarios. Leer: solo Finanzas (aal2). El cliente lo abre con
--     una URL temporal que firma el servidor tras comprobar que es suya.
--   - Cómo se sabe de quién es una factura: por el proyecto de Finanzas
--     enlazado a un proyecto del OPS de ese cliente o por el nombre
--     del cliente escrito en la factura.
--   - En "Ver como cliente", la parte de facturas solo la ven los propietarios.
--
-- Ejecutar ANTES de publicar el código. Es idempotente.
-- ============================================================================

begin;

alter table fin_invoices add column if not exists portal_concept text;

-- Conceptos limpios de las facturas que ya existen (las que llevan notas)
update fin_invoices
set portal_concept = trim(regexp_replace(split_part(concept, ' · ', 1), '\s*\(Stripe\)\s*$', ''))
where portal_concept is null
  and (concept like '% · %' or concept like '%(Stripe)%');

-- Bucket de PDFs de facturas
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoices_insert_owner" on storage.objects;
create policy "invoices_insert_owner" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and is_owner());
drop policy if exists "invoices_select_finance" on storage.objects;
create policy "invoices_select_finance" on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and can_see_finance());
drop policy if exists "invoices_delete_finance" on storage.objects;
create policy "invoices_delete_finance" on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and can_see_finance());

-- ¿Es esta factura de este cliente?
create or replace function portal_invoice_of(i fin_invoices, cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
      select 1 from fin_projects fp join projects p on p.id = fp.project_id
      where fp.id = i.fin_project_id and p.client_id = cid
    )
    or portal_slug(i.client) = (select portal_slug(c.name) from clients c where c.id = cid);
$$;
revoke all on function portal_invoice_of(fin_invoices, uuid) from public, anon, authenticated;

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
      select jsonb_agg(jsonb_build_object('title', r.title, 'eur', r.client_eur_month) order by fp.position, r.slot)
      from fin_recurrences r
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

-- Ruta del PDF de una factura, solo si es del cliente que la pide (o propietario)
create or replace function portal_invoice_path(iid uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  cid uuid := portal_my_client();
  i fin_invoices;
  c record;
begin
  select * into i from fin_invoices where id = iid;
  if i.id is null then return null; end if;
  for c in select id from clients where not portal_off and (id = cid or (cid is null and is_owner())) loop
    if portal_invoice_of(i, c.id) then
      return c.id::text || '/' || i.number || '.pdf';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function portal_invoice_path(uuid) from public, anon;
grant execute on function portal_invoice_path(uuid) to authenticated;

commit;

-- Comprobación (después de ejecutar): cuántas facturas y cuotas ve cada cliente
select c.name,
       jsonb_array_length(portal_billing_check.b -> 'invoices') as facturas,
       portal_billing_check.b -> 'fees' as cuotas
from clients c
cross join lateral (
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(i.id) from fin_invoices i where portal_invoice_of(i, c.id)), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(r.title || ' ' || r.client_eur_month)
      from fin_recurrences r join fin_projects fp on fp.id = r.fin_project_id
      left join projects p on p.id = fp.project_id
      where r.active and r.client_eur_month > 0
        and (p.client_id = c.id or (fp.project_id is null and portal_slug(fp.name) like portal_slug(c.name) || '%'))
    ), '[]'::jsonb)) as b
) as portal_billing_check
where not c.portal_off
order by c.name;
