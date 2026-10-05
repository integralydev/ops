-- ============================================================================
-- Migración: varias personas de contacto y estado en cada cliente
--   · clients.contacts: lista de personas de contacto, cada una con nombre,
--     cargo, email y teléfono. Se rellena con el contacto que ya hubiera en
--     contact_name / email / phone (esas columnas quedan sin uso).
--   · clients.status: lead / prospect / client / former (ex cliente). A los
--     clientes que ya existen se les pone un estado según sus proyectos:
--     con alguno en desarrollo, testing o mantenimiento → client; con algún
--     otro proyecto → prospect; sin proyectos → lead.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table clients add column if not exists contacts jsonb not null default '[]'::jsonb;

update clients
set contacts = jsonb_build_array(jsonb_build_object(
  'name', coalesce(contact_name, ''),
  'role', '',
  'email', coalesce(email, ''),
  'phone', coalesce(phone, '')
))
where contacts = '[]'::jsonb
  and (coalesce(contact_name, '') <> '' or coalesce(email, '') <> '' or coalesce(phone, '') <> '');

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'clients' and column_name = 'status') then
    alter table clients add column status text not null default 'lead'
      check (status in ('lead', 'prospect', 'client', 'former'));
    update clients c set status = case
      when exists (select 1 from projects p where p.client_id = c.id and p.status in ('desarrollo', 'testing', 'mantenimiento')) then 'client'
      when exists (select 1 from projects p where p.client_id = c.id) then 'prospect'
      else 'lead'
    end;
  end if;
end $$;

commit;
