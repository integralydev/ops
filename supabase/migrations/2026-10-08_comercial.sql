-- ============================================================================
-- Migración: sección Comercial (embudo de empresas antes de ser proyecto)
--
--   · Rol nuevo "comercial": SOLO accede a la sección Comercial. No ve
--     proyectos, tareas, archivos, notas, actividad, scope ni clientes, ni
--     siquiera si por error se le asignara a un proyecto.
--   · Comercial la ven y editan admin y comercial. Directores y developers no
--     (son datos de clientes de un tercero).
--   · Tabla prospects: cada empresa del embudo. Sin datos económicos.
--   · Tabla prospect_events: historial de cada empresa (notas escritas a mano y
--     cambios de estado / responsable / próxima acción, que se apuntan solos).
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Rol nuevo
-- ---------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'director', 'developer', 'comercial'));

-- Equipo de proyectos: todos menos comercial
create or replace function is_team()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'director', 'developer')
  );
$$;

-- Acceso a la sección Comercial
create or replace function has_sales_access()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'comercial')
  );
$$;

grant execute on function is_team() to authenticated;
grant execute on function has_sales_access() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Cerrar el resto del OPS al rol comercial
-- ---------------------------------------------------------------------------

-- Ser miembro de un proyecto exige ser del equipo. Con esto quedan cerradas
-- tareas, archivos, notas, actividad, scope, Storage y update_next_step, que
-- dependen de esta función.
create or replace function is_project_member(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_team() and exists (
    select 1 from projects p
    where p.id = pid
      and (is_staff() or p.owner_id = auth.uid() or auth.uid() = any(p.developer_ids))
  );
$$;

drop policy if exists "projects_select_member" on projects;
create policy "projects_select_member" on projects for select to authenticated
  using (is_team() and (is_staff() or owner_id = auth.uid() or auth.uid() = any(developer_ids)));

-- Clientes: antes los veía cualquiera que entrase; ahora solo el equipo
drop policy if exists "clients_select" on clients;
create policy "clients_select" on clients for select to authenticated using (is_team());

-- ---------------------------------------------------------------------------
-- 3) Empresas del embudo
-- ---------------------------------------------------------------------------
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  zone text check (zone in ('rodalies', 'alejados')),
  city text not null default '',
  province text not null default '',
  phone text not null default '',
  mobile text not null default '',
  email text not null default '',
  -- código en el sistema de Ana (App Informàtica Gavà)
  app_code text,
  source text not null default 'propio' check (source in ('ana', 'silleda', 'pipeline', 'propio')),
  status text not null default 'sin_contactar'
    check (status in ('sin_contactar', 'contactada', 'reunion_hecha', 'propuesta_enviada', 'cerrada', 'descartada')),
  owner_id uuid references profiles (id) on delete set null,
  next_action text not null default '',
  next_action_date date,
  -- al cerrarse: cliente y proyecto creados en el OPS a partir de esta empresa
  client_id uuid references clients (id) on delete set null,
  project_id uuid references projects (id) on delete set null,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- último movimiento (cambio o nota): para ver lo que lleva días sin tocar
  last_touched_at timestamptz not null default now()
);
create index if not exists prospects_status_idx on prospects (status);
create index if not exists prospects_last_touched_idx on prospects (last_touched_at);
create unique index if not exists prospects_app_code_uniq on prospects (app_code) where app_code is not null and app_code <> '';

create table if not exists prospect_events (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null default auth.uid(),
  -- note: escrita a mano · created / status / owner / next_action: automáticas
  kind text not null check (kind in ('note', 'created', 'status', 'owner', 'next_action')),
  text text not null default '',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists prospect_events_prospect_idx on prospect_events (prospect_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) Historial automático y "último movimiento"
-- ---------------------------------------------------------------------------
create or replace function trg_prospects_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Enlazar con cliente/proyecto es cosa de admin/director (crean el proyecto)
  if (new.client_id is distinct from old.client_id or new.project_id is distinct from old.project_id)
     and not is_staff() then
    raise exception 'Solo admin puede enlazar la empresa con un cliente o proyecto';
  end if;
  new.updated_at := now();
  new.last_touched_at := now();
  return new;
end;
$$;

drop trigger if exists trg_prospects_before_update on prospects;
create trigger trg_prospects_before_update
  before update on prospects
  for each row execute function trg_prospects_before_update();

create or replace function trg_prospects_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into prospect_events (prospect_id, actor_id, kind, data)
    values (new.id, auth.uid(), 'created', jsonb_build_object('source', new.source));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into prospect_events (prospect_id, actor_id, kind, data)
    values (new.id, auth.uid(), 'status', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into prospect_events (prospect_id, actor_id, kind, data)
    values (new.id, auth.uid(), 'owner', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if new.next_action is distinct from old.next_action or new.next_action_date is distinct from old.next_action_date then
    insert into prospect_events (prospect_id, actor_id, kind, text, data)
    values (new.id, auth.uid(), 'next_action', new.next_action, jsonb_build_object('date', new.next_action_date));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prospects_log on prospects;
create trigger trg_prospects_log
  after insert or update on prospects
  for each row execute function trg_prospects_log();

-- Una nota nueva también cuenta como movimiento
create or replace function trg_prospect_note_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'note' then
    update prospects set last_touched_at = now() where id = new.prospect_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prospect_note_touch on prospect_events;
create trigger trg_prospect_note_touch
  after insert on prospect_events
  for each row execute function trg_prospect_note_touch();

-- Las funciones de los triggers no se llaman a mano
revoke execute on function trg_prospects_before_update() from public, authenticated, anon;
revoke execute on function trg_prospects_log() from public, authenticated, anon;
revoke execute on function trg_prospect_note_touch() from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5) Permisos (RLS): solo admin y comercial
-- ---------------------------------------------------------------------------
alter table prospects enable row level security;
alter table prospect_events enable row level security;

drop policy if exists "prospects_select_sales" on prospects;
drop policy if exists "prospects_insert_sales" on prospects;
drop policy if exists "prospects_update_sales" on prospects;
drop policy if exists "prospects_delete_admin" on prospects;
create policy "prospects_select_sales" on prospects for select to authenticated using (has_sales_access());
create policy "prospects_insert_sales" on prospects for insert to authenticated with check (has_sales_access());
create policy "prospects_update_sales" on prospects for update to authenticated
  using (has_sales_access()) with check (has_sales_access());
create policy "prospects_delete_admin" on prospects for delete to authenticated using (is_admin());

-- Historial: se lee entero; a mano solo se escriben notas propias (lo demás
-- lo apuntan los triggers); cada uno edita/borra sus notas, admin cualquiera.
drop policy if exists "prospect_events_select_sales" on prospect_events;
drop policy if exists "prospect_events_insert_note" on prospect_events;
drop policy if exists "prospect_events_update_note" on prospect_events;
drop policy if exists "prospect_events_delete_note" on prospect_events;
create policy "prospect_events_select_sales" on prospect_events for select to authenticated
  using (has_sales_access());
create policy "prospect_events_insert_note" on prospect_events for insert to authenticated
  with check (has_sales_access() and kind = 'note' and actor_id = auth.uid());
create policy "prospect_events_update_note" on prospect_events for update to authenticated
  using (has_sales_access() and kind = 'note' and (actor_id = auth.uid() or is_admin()))
  with check (has_sales_access() and kind = 'note' and (actor_id = auth.uid() or is_admin()));
create policy "prospect_events_delete_note" on prospect_events for delete to authenticated
  using (has_sales_access() and kind = 'note' and (actor_id = auth.uid() or is_admin()));

-- ---------------------------------------------------------------------------
-- 6) Realtime (respeta RLS: cada uno solo recibe lo que puede ver)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prospects') then
    alter publication supabase_realtime add table prospects;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prospect_events') then
    alter publication supabase_realtime add table prospect_events;
  end if;
end $$;

commit;
