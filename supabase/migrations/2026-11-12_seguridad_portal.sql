-- ============================================================================
-- Migración: seguridad del portal y de los devs (12 nov 2026)
--   1. Facturas y cuotas del portal: el cliente se decide por un client_id
--      guardado (factura y proyecto de Finanzas), NUNCA por el nombre.
--   2. Archivos: un dev solo sube archivos a su proyecto, a nombre suyo, en la
--      carpeta de ese proyecto y sin poder hacerlos visibles al cliente.
--   3. Clientes: un dev solo ve los clientes de sus proyectos.
--   4. Facturas de cualquier cliente (vista previa del portal, PDFs): exigen
--      propietario + verificación en dos pasos (can_see_finance), no solo
--      propietario.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) client_id en Finanzas
-- ---------------------------------------------------------------------------
alter table fin_projects add column if not exists client_id uuid references clients (id) on delete set null;
alter table fin_invoices add column if not exists client_id uuid references clients (id) on delete set null;
create index if not exists fin_invoices_client_id_idx on fin_invoices (client_id);

-- Cliente "inequívoco" a partir de un nombre: solo si el nombre normalizado
-- coincide EXACTO con un único cliente (y tiene al menos 3 letras).
create or replace function fin_client_by_exact_name(p_name text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case when count(*) = 1 then (array_agg(c.id))[1] end
  from clients c
  where length(portal_slug(p_name)) >= 3
    and portal_slug(c.name) = portal_slug(p_name);
$$;
revoke all on function fin_client_by_exact_name(text) from public, anon, authenticated;

-- Relleno inicial (una sola vez). Proyectos de Finanzas: por el proyecto del
-- OPS; si no tiene, por el nombre (aquí sí por prefijo, el más largo, porque
-- "Steknos F2" o "Saher — ROMA" son de Steknos y Saher). Revisar el resultado:
--   select fp.name, c.name from fin_projects fp left join clients c on c.id = fp.client_id;
update fin_projects fp set client_id = p.client_id
from projects p
where p.id = fp.project_id and fp.client_id is null and p.client_id is not null;

update fin_projects fp set client_id = (
  select c.id from clients c
  where length(portal_slug(c.name)) >= 3
    and portal_slug(fp.name) like portal_slug(c.name) || '%'
  order by length(portal_slug(c.name)) desc
  limit 1)
where fp.client_id is null;

-- Facturas: por su proyecto de Finanzas; si no tiene, por el nombre (igual).
update fin_invoices i set client_id = fp.client_id
from fin_projects fp
where fp.id = i.fin_project_id and i.client_id is null and fp.client_id is not null;

update fin_invoices i set client_id = (
  select c.id from clients c
  where length(portal_slug(c.name)) >= 3
    and portal_slug(i.client) like portal_slug(c.name) || '%'
  order by length(portal_slug(c.name)) desc
  limit 1)
where i.client_id is null;

-- A partir de ahora, automático y sin prefijos:
--   proyecto de Finanzas → cliente de su proyecto del OPS, o nombre exacto
--   factura → cliente de su proyecto de Finanzas, o nombre exacto
-- (se puede poner a mano en cualquier momento; si ya tiene, no se toca)
create or replace function trg_fin_projects_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null and new.project_id is not null then
    select client_id into new.client_id from projects where id = new.project_id;
  end if;
  if new.client_id is null then
    new.client_id := fin_client_by_exact_name(new.name);
  end if;
  return new;
end;
$$;
drop trigger if exists fin_projects_client on fin_projects;
create trigger fin_projects_client before insert or update of project_id, name, client_id on fin_projects
  for each row execute function trg_fin_projects_client();

create or replace function trg_fin_invoices_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null and new.fin_project_id is not null then
    select client_id into new.client_id from fin_projects where id = new.fin_project_id;
  end if;
  if new.client_id is null then
    new.client_id := fin_client_by_exact_name(new.client);
  end if;
  return new;
end;
$$;
drop trigger if exists fin_invoices_client on fin_invoices;
create trigger fin_invoices_client before insert or update of fin_project_id, client, client_id on fin_invoices
  for each row execute function trg_fin_invoices_client();

-- ¿Es esta factura de este cliente? Solo por client_id.
create or replace function portal_invoice_of(i fin_invoices, cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select cid is not null and i.client_id = cid;
$$;
revoke all on function portal_invoice_of(fin_invoices, uuid) from public, anon, authenticated;

-- PDF de una factura de Stripe: a la carpeta de SU cliente (por client_id)
create or replace function stripe_invoice_client(p_stripe_id text)
returns table (client_id uuid, number text)
language sql
security definer
set search_path = public
stable
as $$
  select i.client_id, i.number from fin_invoices i
  where i.stripe_invoice_id = p_stripe_id and i.client_id is not null
  limit 1;
$$;
revoke all on function stripe_invoice_client(text) from public, anon, authenticated;
grant execute on function stripe_invoice_client(text) to service_role;

-- Facturas y cuotas del cliente. p_client: vista previa (propietario + 2 pasos)
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
        'pdf', exists (
          select 1 from storage.objects o
          where o.bucket_id = 'invoices' and o.name = cid::text || '/' || i.number || '.pdf'
        )
      ) order by i.date desc, i.number desc)
      from fin_invoices i
      where i.client_id = cid
    ), '[]'::jsonb),
    'fees', coalesce((
      -- Solo el tramo en curso de cada proyecto (el primero activo)
      select jsonb_agg(jsonb_build_object('title', r.title, 'eur', r.client_eur_month) order by fp.position)
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

-- Ruta del PDF de una factura: el cliente, la suya; vista previa, propietario + 2 pasos
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
begin
  select * into i from fin_invoices where id = iid;
  if i.id is null or i.client_id is null then return null; end if;
  if cid is null and not can_see_finance() then return null; end if;
  if cid is not null and i.client_id <> cid then return null; end if;
  if exists (select 1 from clients where id = i.client_id and portal_off) then return null; end if;
  return i.client_id::text || '/' || i.number || '.pdf';
end;
$$;
revoke all on function portal_invoice_path(uuid) from public, anon;
grant execute on function portal_invoice_path(uuid) to authenticated;

-- Subir PDFs de facturas: propietario + 2 pasos (el webhook usa service_role)
drop policy if exists "invoices_insert_owner" on storage.objects;
create policy "invoices_insert_owner" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and can_see_finance());

-- ---------------------------------------------------------------------------
-- 2) Archivos
-- ---------------------------------------------------------------------------
-- Dev: solo en su proyecto, a su nombre (staff puede subir por otro), en la carpeta del proyecto y nunca
-- visible al cliente (eso lo decide el staff con files_update_staff).
drop policy if exists "files_insert_member" on files;
create policy "files_insert_member" on files for insert to authenticated with check (
  is_project_member(project_id)
  and (uploaded_by = auth.uid() or is_staff())
  and storage_path like project_id::text || '/%'
  and (coalesce(client_visible, false) = false or is_staff())
);

-- El portal solo sirve archivos que están en la carpeta de su propio proyecto
create or replace function portal_file_path(fid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select f.storage_path
  from files f join projects p on p.id = f.project_id
  where f.id = fid and f.client_visible and p.kind = 'cliente'
    and portal_visible_status(p.status)
    and f.storage_path like p.id::text || '/%'
    and (p.client_id = portal_my_client() or is_staff());
$$;
revoke all on function portal_file_path(uuid) from public, anon;
grant execute on function portal_file_path(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Clientes: staff todos; dev solo los de sus proyectos
-- ---------------------------------------------------------------------------
drop policy if exists "clients_select" on clients;
create policy "clients_select" on clients for select to authenticated using (
  is_staff()
  or (is_team() and exists (
    select 1 from projects p where p.client_id = clients.id and is_project_member(p.id)))
);

commit;

-- Comprobación después de ejecutar (debe salir cada proyecto/factura con su cliente):
--   select fp.name, c.name as cliente from fin_projects fp left join clients c on c.id = fp.client_id order by 1;
--   select i.number, i.client, c.name as cliente from fin_invoices i left join clients c on c.id = i.client_id order by i.date desc;
