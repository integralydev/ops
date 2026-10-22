-- ============================================================================
-- Migración: finanzas (parte económica del panel de la agencia)
--
-- ACCESO: solo los propietarios (tabla owners), y con la sesión verificada en
-- dos pasos (aal2). Sin excepciones para admin ni director.
--   · owners: RLS activado y SIN políticas → nadie la lee ni la escribe desde
--     la app ni con la API; solo desde el SQL Editor.
--   · is_owner(): devuelve si la persona actual es propietaria.
--   · Todas las tablas fin_*: select/insert/update/delete solo si is_owner()
--     y la sesión es aal2. Sin acceso para anon.
--   · Las tablas fin_* NO se añaden a Realtime, no tienen triggers de
--     actividad y no disparan correos.
--
-- La lista de propietarios NO va en este archivo: se rellena aparte en el
-- SQL Editor (ver el mensaje de despliegue).
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa (no afecta a la
-- versión actual). Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Red de seguridad sobre profiles: nadie que no sea admin puede cambiar un
--    rol (incluido el suyo). Ya existía; se reinstala para garantizarlo.
-- ---------------------------------------------------------------------------
create or replace function validate_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if not is_admin() then
      raise exception 'Solo un administrador puede cambiar roles';
    end if;
    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from profiles where role = 'admin') <= 1 then
      raise exception 'No puedes quitar al único administrador';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_role_change on profiles;
create trigger trg_validate_role_change
  before update on profiles
  for each row execute function validate_role_change();

-- ---------------------------------------------------------------------------
-- 1) Propietarios
-- ---------------------------------------------------------------------------
create table if not exists owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table owners enable row level security;
-- Sin políticas a propósito. Y sin permisos para los roles de la API.
revoke all on owners from anon, authenticated;

create or replace function is_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from owners where user_id = auth.uid());
$$;
revoke execute on function is_owner() from public, anon;
grant execute on function is_owner() to authenticated;

-- Propietario y con la sesión verificada en dos pasos
create or replace function can_see_finance()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_owner() and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke execute on function can_see_finance() from public, anon;
grant execute on function can_see_finance() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Tablas
-- ---------------------------------------------------------------------------
create table if not exists fin_settings (
  id smallint primary key default 1 check (id = 1),
  fx_usd_eur numeric(8, 4) not null default 0.92 check (fx_usd_eur > 0),
  updated_at timestamptz not null default now()
);

create table if not exists fin_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  status text not null default 'activo' check (status in ('activo', 'cerrado')),
  -- enlace opcional a un proyecto del OPS
  project_id uuid references projects (id) on delete set null,
  -- implementación (precio acordado en €)
  agreed_eur numeric(12, 2) not null default 0,
  collected_eur numeric(12, 2) not null default 0,
  impl_note text not null default '',
  -- coste dev: en USD o en € (uno de los dos)
  dev_usd numeric(12, 2),
  dev_eur numeric(12, 2),
  dev_who text not null default '',
  dev_paid boolean not null default false,
  dev_note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_projects_dev_one check (dev_usd is null or dev_eur is null)
);

-- Recurrencia: 0, 1 o 2 tramos por proyecto (p. ej. "meses 1-6" y "mes 7+")
create table if not exists fin_recurrences (
  id uuid primary key default gen_random_uuid(),
  fin_project_id uuid not null references fin_projects (id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  title text not null default '',
  client_eur_month numeric(12, 2) not null default 0,
  dev_usd_month numeric(12, 2) not null default 0,
  dev_txt text not null default '',
  infra_eur_month numeric(12, 2) not null default 0,
  active boolean not null default false,
  unique (fin_project_id, slot)
);

create table if not exists fin_invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null default '', -- puede repetirse entre series
  client text not null default '',
  concept text not null default '',
  date date not null,
  eur numeric(12, 2) not null default 0,
  usd numeric(12, 2),
  usd_received numeric(12, 2),
  aprox text, -- importe aproximado (p. ej. "≈ al cambio del día")
  kind text not null default 'implementacion' check (kind in ('implementacion', 'mensualidad')),
  status text not null default 'pendiente' check (status in ('cobrada', 'pendiente', 'parcial', 'abono')),
  date_txt text, -- fecha mostrada en texto, si hace falta
  created_at timestamptz not null default now()
);
create index if not exists fin_invoices_date_idx on fin_invoices (date desc);

create table if not exists fin_receivables (
  id uuid primary key default gen_random_uuid(),
  project text not null default '',
  concept text not null default '',
  eur numeric(12, 2) not null default 0,
  invoiced boolean not null default false,
  in_kpi boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) Permisos: solo propietarios con sesión aal2. Nada para anon.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fin_settings', 'fin_projects', 'fin_recurrences', 'fin_invoices', 'fin_receivables'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (can_see_finance()) with check (can_see_finance())',
      t || '_owner_all', t);
  end loop;
end $$;

-- Fuera de Realtime (por si alguna se hubiera añadido)
do $$
declare
  t text;
begin
  foreach t in array array['fin_settings', 'fin_projects', 'fin_recurrences', 'fin_invoices', 'fin_receivables'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime drop table %I', t);
    end if;
  end loop;
end $$;

insert into fin_settings (id) values (1) on conflict (id) do nothing;

commit;
