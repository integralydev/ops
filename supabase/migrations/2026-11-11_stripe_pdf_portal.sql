-- ============================================================================
-- Migración: facturas de Stripe en el portal del cliente (11 nov)
--   1. Una factura es del cliente también si su nombre EMPIEZA por el del cliente
--      ("Steknos F2" → Steknos), igual que ya pasaba con las cuotas.
--   2. stripe_invoice_client: a qué cliente va el PDF de una factura de Stripe.
--      Solo lo usa el webhook (con service_role) para guardar el PDF en
--      invoices/<cliente>/<número>.pdf.
-- ============================================================================

begin;

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
    or portal_slug(i.client) like (select portal_slug(c.name) from clients c where c.id = cid) || '%';
$$;
revoke all on function portal_invoice_of(fin_invoices, uuid) from public, anon, authenticated;

create or replace function stripe_invoice_client(p_stripe_id text)
returns table (client_id uuid, number text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  i fin_invoices;
begin
  select * into i from fin_invoices where stripe_invoice_id = p_stripe_id;
  if i.id is null then return; end if;
  return query
    select c.id, i.number from clients c
    where portal_invoice_of(i, c.id)
    order by length(c.name) desc
    limit 1;
end;
$$;
revoke all on function stripe_invoice_client(text) from public, anon, authenticated;
grant execute on function stripe_invoice_client(text) to service_role;

commit;
