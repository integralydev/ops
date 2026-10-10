-- ============================================================================
-- Integraly Ops — esquema de base de datos para Supabase (Postgres)
-- Ejecuta esto entero en el SQL Editor de tu proyecto Supabase (una sola vez).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tabla: profiles (una fila por persona con acceso a la herramienta)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'developer' check (role in ('admin', 'director', 'developer', 'comercial')),
  full_name text,
  -- color del avatar (#RRGGBB); vacío = automático
  color text constraint profiles_color_hex check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  added_by uuid references auth.users (id)
);

-- ---------------------------------------------------------------------------
-- Tabla: clients
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- contact_name / email / phone: sin uso desde que hay varios contactos (contacts)
  contact_name text default '',
  email text default '',
  phone text default '',
  -- [{ name, role, email, phone }]
  contacts jsonb not null default '[]'::jsonb,
  status text not null default 'lead' check (status in ('lead', 'prospect', 'client', 'former')),
  notes text default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tabla: projects
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references clients (id) on delete set null,
  status text not null default 'descubrimiento' check (status in ('descubrimiento', 'propuesta', 'presupuesto', 'desarrollo', 'testing', 'mantenimiento', 'pausado', 'cerrado')),
  owner_id uuid references auth.users (id),
  developer_ids uuid[] not null default '{}',
  next_step text default '',
  description text default '',
  notes_doc text default '',
  notes_updated_at timestamptz,
  notes_updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create index if not exists projects_developer_ids_idx on projects using gin (developer_ids);

-- ---------------------------------------------------------------------------
-- Tabla: tasks
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  assignee_id uuid references auth.users (id),
  assigned_to_client boolean not null default false,
  done boolean not null default false,
  done_at timestamptz,
  -- columna "En curso" del tablero ("Hecha" es done)
  in_progress boolean not null default false,
  due_date date,
  description text not null default '',
  -- orden manual (arrastrar): menor = más arriba
  position double precision not null default -extract(epoch from now()),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create index if not exists tasks_project_id_idx on tasks (project_id);

-- ---------------------------------------------------------------------------
-- Tabla: files (metadatos; el binario vive en Supabase Storage)
-- ---------------------------------------------------------------------------
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid references auth.users (id),
  uploaded_at timestamptz not null default now()
);
create index if not exists files_project_id_idx on files (project_id);
alter table files add column if not exists task_id uuid references tasks (id) on delete set null;
create index if not exists files_task_id_idx on files (task_id);

-- ---------------------------------------------------------------------------
-- Tabla: notes (comentarios/actividad por proyecto)
-- ---------------------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  author_id uuid references auth.users (id),
  text text not null,
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists notes_project_id_idx on notes (project_id);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (SECURITY DEFINER: evitan recursión de RLS)
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Admin o director de proyecto: acceso completo a los datos (no al equipo)
create or replace function is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'director')
  );
$$;

-- Equipo de proyectos: todos menos el rol comercial
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

-- Acceso a la sección Comercial: admin y comercial
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

-- Actualiza SOLO el "próximo paso" de un proyecto; permitido a cualquier
-- miembro del proyecto (no hace falta ser admin para esto).
create or replace function update_next_step(pid uuid, val text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_project_member(pid) then
    raise exception 'No tienes acceso a este proyecto';
  end if;
  update projects set next_step = val, updated_at = now() where id = pid;
end;
$$;

grant execute on function is_admin() to authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function is_team() to authenticated;
grant execute on function has_sales_access() to authenticated;
grant execute on function is_project_member(uuid) to authenticated;
grant execute on function update_next_step(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Salvaguardas sobre cambios de rol (evita que alguien se auto-promocione
-- a admin, y evita quedarse sin ningún admin)
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

create or replace function protect_last_admin_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (select count(*) from profiles where role = 'admin') <= 1 then
    raise exception 'No puedes quitar al único administrador';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_last_admin_delete on profiles;
create trigger trg_protect_last_admin_delete
  before delete on profiles
  for each row execute function protect_last_admin_delete();

-- Red de seguridad: si alguna vez un usuario autenticado no tiene fila en
-- profiles todavía (por ejemplo, invitado fuera de la app), se le crea una
-- con rol "developer" al iniciar sesión por primera vez.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, role) values (new.id, 'developer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_auth_user on auth.users;
create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table files enable row level security;
alter table notes enable row level security;

-- profiles
create policy "profiles_select" on profiles for select to authenticated using (true);
create policy "profiles_insert_admin" on profiles for insert to authenticated with check (is_admin());
create policy "profiles_update_admin" on profiles for update to authenticated using (is_admin()) with check (is_admin());
create policy "profiles_update_self_name" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_admin" on profiles for delete to authenticated using (is_admin());

-- clients — visibles para todo el equipo; solo admins escriben
create policy "clients_select" on clients for select to authenticated using (is_team());
create policy "clients_write_admin" on clients for insert to authenticated with check (is_staff());
create policy "clients_update_admin" on clients for update to authenticated using (is_staff()) with check (is_staff());
create policy "clients_delete_admin" on clients for delete to authenticated using (is_staff());

-- projects — solo ven/editan quienes son miembros (o admins); crear/editar
-- metadatos completos es solo de admins (el "próximo paso" se actualiza
-- aparte vía la función update_next_step, abierta a cualquier miembro).
create policy "projects_select_member" on projects for select to authenticated
  using (is_team() and (is_staff() or owner_id = auth.uid() or auth.uid() = any(developer_ids)));
create policy "projects_insert_admin" on projects for insert to authenticated with check (is_staff());
create policy "projects_update_admin" on projects for update to authenticated using (is_staff()) with check (is_staff());
create policy "projects_delete_admin" on projects for delete to authenticated using (is_staff());

-- tasks
create policy "tasks_select_member" on tasks for select to authenticated using (is_project_member(project_id));
create policy "tasks_insert_member" on tasks for insert to authenticated with check (is_project_member(project_id));
create policy "tasks_update_member" on tasks for update to authenticated
  using (is_project_member(project_id) and (is_staff() or assignee_id = auth.uid() or created_by = auth.uid()))
  with check (is_project_member(project_id));
create policy "tasks_delete_owner" on tasks for delete to authenticated
  using (is_staff() or created_by = auth.uid());

-- files
create policy "files_select_member" on files for select to authenticated using (is_project_member(project_id));
create policy "files_insert_member" on files for insert to authenticated with check (is_project_member(project_id));
create policy "files_delete_owner" on files for delete to authenticated
  using (is_staff() or uploaded_by = auth.uid());

-- notes
create policy "notes_select_member" on notes for select to authenticated using (is_project_member(project_id));
create policy "notes_insert_member" on notes for insert to authenticated with check (is_project_member(project_id));
create policy "notes_update_author" on notes for update to authenticated
  using (author_id = auth.uid() or is_staff())
  with check ((author_id = auth.uid() or is_staff()) and is_project_member(project_id));
create policy "notes_delete_owner" on notes for delete to authenticated
  using (is_staff());

-- ---------------------------------------------------------------------------
-- Realtime: para que la app se actualice en vivo entre pestañas/personas
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table projects, tasks, files, notes, profiles, clients;

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para archivos de proyecto
-- Ruta esperada de cada objeto: "<project_id>/<nombre-de-archivo>"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

create policy "project_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and is_project_member(((storage.foldername(name))[1])::uuid));
create policy "project_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and is_project_member(((storage.foldername(name))[1])::uuid));
create policy "project_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (is_staff() or owner = auth.uid()));

-- ---------------------------------------------------------------------------
-- Registro de actividad (ver migrations/2026-09-29_registro_actividad.sql)
-- ---------------------------------------------------------------------------

create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_project_id_idx on activity (project_id);
create index if not exists activity_created_at_idx on activity (created_at desc);

alter table activity enable row level security;
drop policy if exists "activity_select_member" on activity;
create policy "activity_select_member" on activity for select to authenticated
  using (is_project_member(project_id));

-- Helper para insertar una entrada
create or replace function log_activity(pid uuid, k text, d jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into activity (project_id, actor_id, kind, data) values (pid, auth.uid(), k, coalesce(d, '{}'));
$$;
revoke execute on function log_activity(uuid, text, jsonb) from public, authenticated, anon;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create or replace function trg_activity_projects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dev uuid;
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.id, 'project_created', jsonb_build_object('status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    perform log_activity(new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.owner_id is distinct from old.owner_id then
    perform log_activity(new.id, 'owner_changed', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if new.developer_ids is distinct from old.developer_ids then
    foreach dev in array coalesce(new.developer_ids, '{}') loop
      if not (dev = any(coalesce(old.developer_ids, '{}'))) then
        perform log_activity(new.id, 'developer_added', jsonb_build_object('user_id', dev));
      end if;
    end loop;
  end if;
  if new.notes_doc is distinct from old.notes_doc then
    perform log_activity(new.id, 'notes_edited', '{}');
  end if;
  if coalesce(new.next_step, '') <> '' and new.next_step is distinct from old.next_step then
    perform log_activity(new.id, 'next_step', jsonb_build_object('text', left(new.next_step, 200)));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activity_projects on projects;
create trigger trg_activity_projects
  after insert or update on projects
  for each row execute function trg_activity_projects();

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create or replace function trg_activity_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.project_id, 'task_created', jsonb_build_object(
      'title', left(new.title, 200),
      'assignee_id', new.assignee_id,
      'client', new.assigned_to_client));
  elsif new.done and not old.done then
    perform log_activity(new.project_id, 'task_done', jsonb_build_object(
      'title', left(new.title, 200),
      'client', new.assigned_to_client));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activity_tasks on tasks;
create trigger trg_activity_tasks
  after insert or update on tasks
  for each row execute function trg_activity_tasks();

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------
create or replace function trg_activity_files()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_activity(new.project_id, 'file_uploaded', jsonb_build_object('filename', new.filename));
  return new;
end;
$$;

drop trigger if exists trg_activity_files on files;
create trigger trg_activity_files
  after insert on files
  for each row execute function trg_activity_files();

-- ---------------------------------------------------------------------------
-- notes (actualizaciones)
-- ---------------------------------------------------------------------------
create or replace function trg_activity_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_activity(new.project_id, 'update_posted', jsonb_build_object(
    'text', left(new.text, 280),
    'images', coalesce(array_length(new.image_paths, 1), 0)));
  return new;
end;
$$;

drop trigger if exists trg_activity_notes on notes;
create trigger trg_activity_notes
  after insert on notes
  for each row execute function trg_activity_notes();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity'
  ) then
    alter publication supabase_realtime add table activity;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scope de cada proyecto (ver migrations/2026-09-30_scope.sql)
-- ---------------------------------------------------------------------------
create table if not exists scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'incluido' check (status in ('incluido', 'excluido', 'por_decidir')),
  block text not null default '',
  is_extension boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists scope_items_project_id_idx on scope_items (project_id);

alter table scope_items enable row level security;
drop policy if exists "scope_select_member" on scope_items;
drop policy if exists "scope_insert_staff" on scope_items;
drop policy if exists "scope_update_staff" on scope_items;
drop policy if exists "scope_delete_staff" on scope_items;
create policy "scope_select_member" on scope_items for select to authenticated using (is_project_member(project_id));
create policy "scope_insert_staff" on scope_items for insert to authenticated with check (is_staff());
create policy "scope_update_staff" on scope_items for update to authenticated using (is_staff()) with check (is_staff());
create policy "scope_delete_staff" on scope_items for delete to authenticated using (is_staff());

alter table projects add column if not exists scope_closed_at timestamptz;
alter table projects add column if not exists scope_closed_by uuid references auth.users (id) on delete set null;
alter table projects add column if not exists scope_source_file_id uuid references files (id) on delete set null;

-- Realtime: que los cambios del scope se vean en vivo
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scope_items'
  ) then
    alter publication supabase_realtime add table scope_items;
  end if;
end;
$$;

-- ============================================================================
-- Después de ejecutar este script, crea a la primera persona administradora
-- a mano (ver README.md, sección "Primer arranque").
-- ============================================================================

-- ===========================================================================
-- Sección Comercial (ver migrations/2026-10-08_comercial.sql)
-- ===========================================================================

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

-- ===========================================================================
-- Enlaces importantes de cada proyecto (ver migrations/2026-10-09_enlaces_proyecto.sql)
-- Solo enlaces, nunca credenciales.
-- ===========================================================================

create table if not exists project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  url text not null,
  category text not null check (category in ('produccion', 'infraestructura', 'repositorio', 'documentos', 'cliente')),
  featured boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_links_url_http check (url ~* '^https?://\S+$'),
  -- nada de https://usuario:contraseña@…
  constraint project_links_no_userinfo check (url !~* '^[a-z]+://[^/?#]*@'),
  -- nada de claves, tokens ni firmas en la URL
  constraint project_links_no_secrets check (
    url !~* '[?&#](token|access_token|refresh_token|id_token|key|api_key|apikey|api-key|secret|client_secret|password|passwd|pwd|pass|auth|sig|signature|x-amz-signature|x-amz-credential|x-goog-signature|x-goog-credential)='
  )
);
create index if not exists project_links_project_idx on project_links (project_id);
-- Como mucho un enlace destacado por proyecto
create unique index if not exists project_links_one_featured on project_links (project_id) where featured;

create or replace function trg_project_links_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_project_links_touch on project_links;
create trigger trg_project_links_touch
  before update on project_links
  for each row execute function trg_project_links_touch();

-- Actividad: "ha añadido el enlace X" (sin la URL)
create or replace function trg_activity_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_activity(new.project_id, 'link_added', jsonb_build_object('label', new.label, 'category', new.category));
  return new;
end;
$$;
revoke execute on function trg_activity_links() from public, authenticated, anon;

drop trigger if exists trg_activity_links on project_links;
create trigger trg_activity_links
  after insert on project_links
  for each row execute function trg_activity_links();

-- Permisos
alter table project_links enable row level security;
drop policy if exists "links_select_member" on project_links;
drop policy if exists "links_insert_member" on project_links;
drop policy if exists "links_update_member" on project_links;
drop policy if exists "links_delete_owner" on project_links;
create policy "links_select_member" on project_links for select to authenticated
  using (is_project_member(project_id));
create policy "links_insert_member" on project_links for insert to authenticated
  with check (is_project_member(project_id) and created_by = auth.uid());
create policy "links_update_member" on project_links for update to authenticated
  using (is_project_member(project_id)) with check (is_project_member(project_id));
create policy "links_delete_owner" on project_links for delete to authenticated
  using (is_project_member(project_id) and (is_staff() or created_by = auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_links') then
    alter publication supabase_realtime add table project_links;
  end if;
end $$;

-- ===========================================================================
-- Accesos externos de cada proyecto (ver migrations/2026-10-10_accesos_externos.sql)
-- Solo admin y director. Nunca credenciales.
-- ===========================================================================

-- ¿Parece una credencial? (tokens conocidos, claves privadas, JWT, "password: …")
create or replace function looks_like_secret(t text)
returns boolean
language sql
immutable
as $$
  select coalesce(t, '') ~ '(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})'
      or coalesce(t, '') ~* '(password|passwd|contrase(ñ|n)a|pwd)\s*[:=]'
      or coalesce(t, '') ~* '(api[ _-]?key|token|secret|clave)\s*[:=]\s*[A-Za-z0-9_\-]{12,}';
$$;

create table if not exists project_accesses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  person text not null check (length(trim(person)) > 0),
  company text not null default '',
  system text not null check (length(trim(system)) > 0),
  level text not null check (level in ('lectura', 'escritura', 'admin', 'propietario')),
  granted_by uuid references profiles (id) on delete set null,
  granted_at date not null default current_date,
  revoked_at date,
  revoked_by uuid references profiles (id) on delete set null,
  -- p. ej. "GCP → IAM → quitar principal"
  revoke_how text not null default '',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint project_accesses_no_secrets check (
    not looks_like_secret(person) and not looks_like_secret(company)
    and not looks_like_secret(system) and not looks_like_secret(revoke_how)
  )
);
create index if not exists project_accesses_project_idx on project_accesses (project_id);

alter table project_accesses enable row level security;
drop policy if exists "accesses_select_staff" on project_accesses;
drop policy if exists "accesses_insert_staff" on project_accesses;
drop policy if exists "accesses_update_staff" on project_accesses;
drop policy if exists "accesses_delete_staff" on project_accesses;
create policy "accesses_select_staff" on project_accesses for select to authenticated using (is_staff());
create policy "accesses_insert_staff" on project_accesses for insert to authenticated with check (is_staff());
create policy "accesses_update_staff" on project_accesses for update to authenticated using (is_staff()) with check (is_staff());
create policy "accesses_delete_staff" on project_accesses for delete to authenticated using (is_staff());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_accesses') then
    alter publication supabase_realtime add table project_accesses;
  end if;
end $$;

-- ===========================================================================
-- Tareas al estilo Notion (ver migrations/2026-10-10_tareas_estilo_notion.sql)
-- ===========================================================================

create index if not exists tasks_project_position_idx on tasks (project_id, position);

create or replace function move_task(tid uuid, pos double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  select project_id into pid from tasks where id = tid;
  if pid is null or not is_project_member(pid) then
    raise exception 'No tienes acceso a esta tarea';
  end if;
  update tasks set position = pos where id = tid;
end;
$$;
grant execute on function move_task(uuid, double precision) to authenticated;
