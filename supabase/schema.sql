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
  -- avisos por email (Ajustes)
  notify_task_assigned boolean not null default true,
  notify_task_comments boolean not null default true,
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
  -- 'cliente' (por defecto) o 'laboratorio' (producto propio, sin cliente)
  kind text not null default 'cliente' constraint projects_kind_check check (kind in ('cliente', 'laboratorio')),
  -- cada tipo tiene sus estados (ver projects_status_check más abajo)
  status text not null default 'descubrimiento',
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
  -- fase: backlog → next → doing → testing → deploy → production (= done)
  stage text not null default 'backlog' check (stage in ('backlog', 'next', 'doing', 'testing', 'deploy', 'production')),
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
  -- calle y número (la población va en city)
  address text not null default '',
  city text not null default '',
  province text not null default '',
  phone text not null default '',
  mobile text not null default '',
  email text not null default '',
  -- código en el sistema de Ana (App Informàtica Gavà)
  app_code text,
  source text not null default 'propio' constraint prospects_source_check
    check (source in ('ana', 'silleda', 'pipeline', 'propio', 'prospeccion')),
  -- privada: solo la ven admin (prospección de Eloi); ver 2026-10-20_prospeccion_privada.sql
  is_private boolean not null default false,
  sector text not null default '',
  website text not null default '',
  employees text not null default '',
  -- prioridad: 'A' llamar primero · 'B' después · 'C' poco encaje · null sin prioridad
  priority text constraint prospects_priority_check check (priority is null or priority in ('A', 'B', 'C')),
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
-- last_touched_at: solo lo comercial (estado, responsable, próxima acción; las notas lo
-- actualizan aparte). Corregir datos de contacto no cuenta como movimiento.
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
  -- Movimiento comercial: estado, responsable o próxima acción
  if new.status is distinct from old.status
     or new.owner_id is distinct from old.owner_id
     or new.next_action is distinct from old.next_action
     or new.next_action_date is distinct from old.next_action_date then
    new.last_touched_at := now();
  end if;
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

-- ===========================================================================
-- Proyectos de laboratorio (ver migrations/2026-10-11_proyectos_laboratorio.sql)
-- ===========================================================================

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (
  (kind = 'cliente' and status in ('descubrimiento', 'propuesta', 'presupuesto', 'desarrollo', 'testing', 'mantenimiento', 'pausado', 'cerrado'))
  or (kind = 'laboratorio' and status in ('idea', 'construccion', 'validacion', 'escalado', 'aparcado'))
);

alter table projects drop constraint if exists projects_lab_no_client;
alter table projects add constraint projects_lab_no_client check (kind = 'cliente' or client_id is null);

-- ===========================================================================
-- Fases de las tareas (ver migrations/2026-10-12_fases_tareas.sql)
-- done / in_progress se sincronizan solos con stage.
-- ===========================================================================

create or replace function trg_tasks_sync_stage()
returns trigger
language plpgsql
as $$
begin
  -- Alta sin fase explícita pero marcada como hecha / en curso (versiones
  -- antiguas de la app o scripts): la fase sale de esas marcas
  if tg_op = 'INSERT' and new.stage = 'backlog' and (new.done or new.in_progress) then
    new.stage := case when new.done then 'production' else 'doing' end;
  end if;

  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    -- Manda la fase
    new.done := new.stage = 'production';
    new.in_progress := new.stage = 'doing';
  elsif new.done is distinct from old.done or new.in_progress is distinct from old.in_progress then
    -- Alguien ha tocado done / in_progress directamente: se ajusta la fase
    new.stage := case
      when new.done then 'production'
      when new.in_progress then 'doing'
      when old.stage = 'production' or old.stage = 'doing' then 'backlog'
      else old.stage
    end;
  end if;

  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := coalesce(new.done_at, now());
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_sync_stage on tasks;
create trigger trg_tasks_sync_stage
  before insert or update on tasks
  for each row execute function trg_tasks_sync_stage();

-- ===========================================================================
-- Ideas de contenido de los proyectos de laboratorio (ver migrations/2026-10-13_ideas_contenido.sql)
-- ===========================================================================

create table if not exists content_ideas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  text text not null check (length(trim(text)) > 0),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists content_ideas_project_idx on content_ideas (project_id, created_at desc);

alter table content_ideas enable row level security;
drop policy if exists "ideas_select_member" on content_ideas;
drop policy if exists "ideas_insert_member" on content_ideas;
drop policy if exists "ideas_update_member" on content_ideas;
drop policy if exists "ideas_delete_member" on content_ideas;
create policy "ideas_select_member" on content_ideas for select to authenticated using (is_project_member(project_id));
create policy "ideas_insert_member" on content_ideas for insert to authenticated with check (is_project_member(project_id));
create policy "ideas_update_member" on content_ideas for update to authenticated
  using (is_project_member(project_id)) with check (is_project_member(project_id));
create policy "ideas_delete_member" on content_ideas for delete to authenticated using (is_project_member(project_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'content_ideas') then
    alter publication supabase_realtime add table content_ideas;
  end if;
end $$;

-- ===========================================================================
-- Comentarios en las tareas (ver migrations/2026-10-14_comentarios_tareas.sql)
-- ===========================================================================

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  -- copia del proyecto de la tarea: para los permisos y para filtrar en vivo
  project_id uuid not null references projects (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null default auth.uid(),
  text text not null check (length(trim(text)) > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists task_comments_task_idx on task_comments (task_id, created_at);
create index if not exists task_comments_project_idx on task_comments (project_id);

create table if not exists task_comment_reads (
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  last_read_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table task_comments enable row level security;
alter table task_comment_reads enable row level security;

drop policy if exists "task_comments_select" on task_comments;
drop policy if exists "task_comments_insert" on task_comments;
drop policy if exists "task_comments_update" on task_comments;
drop policy if exists "task_comments_delete" on task_comments;
create policy "task_comments_select" on task_comments for select to authenticated
  using (is_project_member(project_id));
create policy "task_comments_insert" on task_comments for insert to authenticated
  with check (
    is_project_member(project_id)
    and author_id = auth.uid()
    and exists (select 1 from tasks t where t.id = task_comments.task_id and t.project_id = task_comments.project_id)
  );
create policy "task_comments_update" on task_comments for update to authenticated
  using (is_project_member(project_id) and (author_id = auth.uid() or is_staff()))
  with check (is_project_member(project_id) and (author_id = auth.uid() or is_staff()));
create policy "task_comments_delete" on task_comments for delete to authenticated
  using (is_project_member(project_id) and (author_id = auth.uid() or is_staff()));

drop policy if exists "task_comment_reads_own" on task_comment_reads;
create policy "task_comment_reads_own" on task_comment_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Actividad: "ha comentado en la tarea X"
create or replace function trg_activity_task_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_activity(new.project_id, 'task_comment', jsonb_build_object(
    'task_id', new.task_id,
    'title', (select left(title, 200) from tasks where id = new.task_id),
    'text', left(new.text, 200)));
  return new;
end;
$$;
revoke execute on function trg_activity_task_comments() from public, authenticated, anon;

drop trigger if exists trg_activity_task_comments on task_comments;
create trigger trg_activity_task_comments
  after insert on task_comments
  for each row execute function trg_activity_task_comments();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'task_comments') then
    alter publication supabase_realtime add table task_comments;
  end if;
end $$;

-- ===========================================================================
-- Empresas privadas de Comercial (ver migrations/2026-10-20_prospeccion_privada.sql)
-- Sustituye las políticas de prospects y prospect_events de más arriba.
-- ===========================================================================

create index if not exists prospects_private_idx on prospects (is_private) where is_private;

-- 2) ¿Puede la persona actual ver esta empresa? (acceso a Comercial y, si es
--    privada, ser admin). Para los permisos del historial.
create or replace function can_see_prospect(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_sales_access() and exists (
    select 1 from prospects p where p.id = pid and (not p.is_private or is_admin())
  );
$$;
grant execute on function can_see_prospect(uuid) to authenticated;

-- 3) Permisos de prospects
drop policy if exists "prospects_select_sales" on prospects;
drop policy if exists "prospects_insert_sales" on prospects;
drop policy if exists "prospects_update_sales" on prospects;
create policy "prospects_select_sales" on prospects for select to authenticated
  using (has_sales_access() and (not is_private or is_admin()));
create policy "prospects_insert_sales" on prospects for insert to authenticated
  with check (has_sales_access() and (not is_private or is_admin()));
create policy "prospects_update_sales" on prospects for update to authenticated
  using (has_sales_access() and (not is_private or is_admin()))
  with check (has_sales_access() and (not is_private or is_admin()));
-- (borrar sigue siendo solo de admin: prospects_delete_admin)

-- 4) Permisos del historial: los de la empresa padre
drop policy if exists "prospect_events_select_sales" on prospect_events;
drop policy if exists "prospect_events_insert_note" on prospect_events;
drop policy if exists "prospect_events_update_note" on prospect_events;
drop policy if exists "prospect_events_delete_note" on prospect_events;
create policy "prospect_events_select_sales" on prospect_events for select to authenticated
  using (can_see_prospect(prospect_id));
create policy "prospect_events_insert_note" on prospect_events for insert to authenticated
  with check (can_see_prospect(prospect_id) and kind = 'note' and actor_id = auth.uid());
create policy "prospect_events_update_note" on prospect_events for update to authenticated
  using (can_see_prospect(prospect_id) and kind = 'note' and (actor_id = auth.uid() or is_admin()))
  with check (can_see_prospect(prospect_id) and kind = 'note' and (actor_id = auth.uid() or is_admin()));
create policy "prospect_events_delete_note" on prospect_events for delete to authenticated
  using (can_see_prospect(prospect_id) and kind = 'note' and (actor_id = auth.uid() or is_admin()));

-- 5) Red de seguridad: la marca solo la toca admin, y una privada no puede
--    llevarla alguien con rol comercial
create or replace function trg_prospects_privacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.is_private and not is_admin())
     or (tg_op = 'UPDATE' and new.is_private is distinct from old.is_private and not is_admin()) then
    raise exception 'Solo un admin puede marcar o desmarcar una empresa como privada';
  end if;
  if new.is_private and new.owner_id is not null
     and exists (select 1 from profiles where id = new.owner_id and role = 'comercial') then
    raise exception 'Una empresa privada no puede tener como responsable a alguien con rol comercial';
  end if;
  return new;
end;
$$;
revoke execute on function trg_prospects_privacy() from public, authenticated, anon;

drop trigger if exists trg_prospects_privacy on prospects;
create trigger trg_prospects_privacy
  before insert or update on prospects
  for each row execute function trg_prospects_privacy();

-- ===========================================================================
-- Finanzas: solo propietarios con sesión aal2 (ver migrations/2026-10-22_finanzas.sql)
-- La lista de propietarios (owners) se rellena a mano en el SQL Editor.
-- ===========================================================================

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

-- ============================================================================
-- Finanzas · previsión (migración 2026-10-23_finanzas_prevision.sql)
-- ============================================================================
-- ---------------------------------------------------------------------------
-- 1) Mensualidades con calendario
-- ---------------------------------------------------------------------------
alter table fin_recurrences add column if not exists start_month text
  constraint fin_recurrences_start_fmt check (start_month is null or start_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
alter table fin_recurrences add column if not exists end_month text
  constraint fin_recurrences_end_fmt check (end_month is null or end_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
alter table fin_recurrences add column if not exists billing_day smallint
  constraint fin_recurrences_day check (billing_day is null or billing_day between 1 and 31);
alter table fin_recurrences add column if not exists method text
  constraint fin_recurrences_method check (method is null or method in ('stripe', 'transferencia', 'otro'));

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'fin_recurrences' and column_name = 'status') then
    alter table fin_recurrences add column status text not null default 'por_activar'
      constraint fin_recurrences_status check (status in ('activa', 'por_activar', 'cancelada'));
    update fin_recurrences set status = case when active then 'activa' else 'por_activar' end;
  end if;
end $$;

-- active ⇄ status (solo toca la propia fila; sin actividad ni correos)
create or replace function trg_fin_recurrences_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'por_activar' and new.active then
      new.status := 'activa';
    end if;
    new.active := new.status = 'activa';
  elsif new.status is distinct from old.status then
    new.active := new.status = 'activa';
  elsif new.active is distinct from old.active then
    new.status := case when new.active then 'activa'
                       when old.status = 'cancelada' then 'cancelada'
                       else 'por_activar' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fin_recurrences_status on fin_recurrences;
create trigger trg_fin_recurrences_status
  before insert or update on fin_recurrences
  for each row execute function trg_fin_recurrences_status();

-- ---------------------------------------------------------------------------
-- 2) Movimientos programados
-- ---------------------------------------------------------------------------
create table if not exists fin_scheduled (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('entrada', 'salida')),
  concept text not null default '',
  counterparty text not null default '',
  fin_project_id uuid references fin_projects (id) on delete set null,
  amount_eur numeric(12, 2),
  amount_usd numeric(12, 2),
  frequency text not null default 'unica' check (frequency in ('unica', 'mensual', 'trimestral')),
  date date not null, -- la única, o el primer cargo
  end_date date,
  certainty text not null default 'confirmado' check (certainty in ('confirmado', 'probable')),
  probability smallint check (probability is null or probability between 0 and 100),
  note text not null default '',
  -- una única ya pagada / facturada deja de salir en la previsión
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint fin_scheduled_one_amount check ((amount_eur is null) <> (amount_usd is null))
);
create index if not exists fin_scheduled_date_idx on fin_scheduled (date);
alter table fin_scheduled enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Pagos hechos (salidas reales)
-- ---------------------------------------------------------------------------
create table if not exists fin_payments_out (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  concept text not null default '',
  counterparty text not null default '',
  amount_eur numeric(12, 2),
  amount_usd numeric(12, 2),
  fin_project_id uuid references fin_projects (id) on delete set null,
  kind text not null default 'otro' check (kind in ('dev', 'comision', 'comercial', 'gasto_fijo', 'otro')),
  -- si salda una cuota de un programado: cuál y de qué fecha
  scheduled_id uuid references fin_scheduled (id) on delete set null,
  period date,
  created_at timestamptz not null default now(),
  constraint fin_payments_out_one_amount check ((amount_eur is null) <> (amount_usd is null))
);
create index if not exists fin_payments_out_date_idx on fin_payments_out (date desc);
alter table fin_payments_out enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Facturas: proyecto y programado que facturan
-- ---------------------------------------------------------------------------
alter table fin_invoices add column if not exists fin_project_id uuid references fin_projects (id) on delete set null;
alter table fin_invoices add column if not exists scheduled_id uuid references fin_scheduled (id) on delete set null;
alter table fin_invoices add column if not exists scheduled_period date;

-- ---------------------------------------------------------------------------
-- 5) Permisos: solo propietarios con sesión aal2. Nada para anon. Sin Realtime.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fin_scheduled', 'fin_payments_out'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (can_see_finance()) with check (can_see_finance())',
      t || '_owner_all', t);
  end loop;
  foreach t in array array['fin_settings', 'fin_projects', 'fin_recurrences', 'fin_invoices', 'fin_receivables', 'fin_scheduled', 'fin_payments_out'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime drop table %I', t);
    end if;
  end loop;
end $$;

-- Finanzas · tipo de salida en los programados (migración 2026-10-24_finanzas_tipo_salida.sql)
alter table fin_scheduled add column if not exists kind text not null default 'otro';
alter table fin_scheduled drop constraint if exists fin_scheduled_kind;
alter table fin_scheduled add constraint fin_scheduled_kind
  check (kind in ('dev', 'comision', 'comercial', 'gasto_fijo', 'infra', 'otro'));

alter table fin_payments_out drop constraint if exists fin_payments_out_kind_check;
alter table fin_payments_out add constraint fin_payments_out_kind_check
  check (kind in ('dev', 'comision', 'comercial', 'gasto_fijo', 'infra', 'otro'));

update fin_scheduled s
   set kind = p.kind
  from (
    select distinct on (scheduled_id) scheduled_id, kind
      from fin_payments_out
     where scheduled_id is not null and kind <> 'otro'
     order by scheduled_id, date desc
  ) p
 where p.scheduled_id = s.id and s.kind = 'otro';

-- Finanzas · que se mantenga solo (migración 2026-10-25_finanzas_automatico.sql)
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1) Mensualidades: customer de Stripe y días de pago
-- ---------------------------------------------------------------------------
alter table fin_recurrences add column if not exists stripe_customer_id text;
alter table fin_recurrences add column if not exists payment_terms_days smallint not null default 0;
alter table fin_recurrences drop constraint if exists fin_recurrences_terms;
alter table fin_recurrences add constraint fin_recurrences_terms check (payment_terms_days between 0 and 365);
create index if not exists fin_recurrences_stripe_idx on fin_recurrences (stripe_customer_id);

-- ---------------------------------------------------------------------------
-- 2) Programados: anual y cuotas saltadas
-- ---------------------------------------------------------------------------
alter table fin_scheduled drop constraint if exists fin_scheduled_frequency_check;
alter table fin_scheduled add constraint fin_scheduled_frequency_check
  check (frequency in ('unica', 'mensual', 'trimestral', 'anual'));
alter table fin_scheduled add column if not exists skipped date[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 3) Facturas de Stripe
-- ---------------------------------------------------------------------------
alter table fin_invoices add column if not exists stripe_invoice_id text;
create unique index if not exists fin_invoices_stripe_uidx on fin_invoices (stripe_invoice_id);

create table if not exists fin_stripe_pending (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  customer_id text not null default '',
  customer_name text not null default '',
  number text not null default '',
  concept text not null default '',
  amount numeric(12, 2) not null,
  currency text not null default 'eur',
  paid_date date not null,
  created_at timestamptz not null default now()
);
alter table fin_stripe_pending enable row level security;

create table if not exists fin_secrets (
  key text primary key,
  value text not null
);
alter table fin_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Permisos
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- Tablas de propietarios (igual que el resto de fin_*)
  execute 'alter table fin_stripe_pending force row level security';
  execute 'revoke all on fin_stripe_pending from anon';
  execute 'drop policy if exists fin_stripe_pending_owner_all on fin_stripe_pending';
  execute 'create policy fin_stripe_pending_owner_all on fin_stripe_pending for all to authenticated '
       || 'using (can_see_finance()) with check (can_see_finance())';

  -- Secretos: nadie desde la API (ni propietarios)
  execute 'alter table fin_secrets force row level security';
  execute 'revoke all on fin_secrets from anon, authenticated';

  -- La función del webhook corre como su dueño (postgres). Como las tablas
  -- fin_* fuerzan RLS también para el dueño, se le da paso explícito; no
  -- cambia nada para anon ni authenticated.
  foreach t in array array['fin_secrets', 'fin_settings', 'fin_projects', 'fin_recurrences', 'fin_invoices', 'fin_stripe_pending'] loop
    execute format('drop policy if exists %I on %I', t || '_definer', t);
    execute format('create policy %I on %I for all to postgres using (true) with check (true)', t || '_definer', t);
  end loop;

  foreach t in array array['fin_stripe_pending', 'fin_secrets'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime drop table %I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Webhook de Stripe: invoice.paid → factura cobrada (mensualidad)
-- ---------------------------------------------------------------------------
create or replace function fin_stripe_webhook(p_payload text, p_signature text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_t text;
  v_sigs text[];
  v_event jsonb;
  v_inv jsonb;
  v_id text;
  v_customer text;
  v_amount numeric;
  v_cur text;
  v_fx numeric;
  v_date date;
  v_num text;
  v_concept text;
  v_rec record;
begin
  -- Firma: cabecera "t=…,v1=…[,v1=…]"; HMAC-SHA256 de "t.payload"; 5 min de margen
  select value into v_secret from fin_secrets where key = 'stripe_webhook_secret';
  if v_secret is null then
    return 'sin_secreto';
  end if;
  select max(split_part(trim(x), '=', 2)) filter (where split_part(trim(x), '=', 1) = 't'),
         array_agg(split_part(trim(x), '=', 2)) filter (where split_part(trim(x), '=', 1) = 'v1')
    into v_t, v_sigs
    from unnest(string_to_array(coalesce(p_signature, ''), ',')) x;
  if v_t is null or v_t !~ '^\d{1,12}$' or v_sigs is null then
    return 'firma_invalida';
  end if;
  if abs(extract(epoch from now()) - v_t::bigint) > 300 then
    return 'firma_caducada';
  end if;
  if not encode(hmac(convert_to(v_t || '.' || p_payload, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') = any (v_sigs) then
    return 'firma_invalida';
  end if;

  v_event := p_payload::jsonb;
  if v_event ->> 'type' is distinct from 'invoice.paid' then
    return 'ignorado';
  end if;
  v_inv := v_event -> 'data' -> 'object';
  v_id := v_inv ->> 'id';
  v_amount := coalesce((v_inv ->> 'amount_paid')::numeric, 0) / 100;
  if v_id is null or v_amount <= 0 then
    return 'ignorado';
  end if;
  if exists (select 1 from fin_invoices where stripe_invoice_id = v_id)
     or exists (select 1 from fin_stripe_pending where stripe_invoice_id = v_id) then
    return 'duplicado';
  end if;

  v_customer := coalesce(v_inv ->> 'customer', '');
  v_cur := lower(coalesce(v_inv ->> 'currency', 'eur'));
  v_date := (to_timestamp(coalesce((v_inv -> 'status_transitions' ->> 'paid_at')::bigint, (v_inv ->> 'created')::bigint))
             at time zone 'Europe/Madrid')::date;
  -- Serie S con el correlativo de Stripe ("XXXX-0004" → "S0004")
  v_num := coalesce(v_inv ->> 'number', '');
  v_num := 'S' || case when v_num ~ '-\d+$' then lpad(substring(v_num from '-(\d+)$'), 4, '0') else v_num end;
  v_concept := coalesce(nullif(v_inv -> 'lines' -> 'data' -> 0 ->> 'description', ''), 'Mensualidad (Stripe)');

  select r.fin_project_id, p.name
    into v_rec
    from fin_recurrences r
    join fin_projects p on p.id = r.fin_project_id
   where v_customer <> '' and r.stripe_customer_id = v_customer
   order by (r.status = 'activa') desc, r.slot
   limit 1;

  if not found then
    insert into fin_stripe_pending (stripe_invoice_id, customer_id, customer_name, number, concept, amount, currency, paid_date)
    values (v_id, v_customer, coalesce(v_inv ->> 'customer_name', v_inv ->> 'customer_email', ''), v_num, v_concept,
            v_amount, v_cur, v_date)
    on conflict (stripe_invoice_id) do nothing;
    return 'sin_vincular';
  end if;

  select fx_usd_eur into v_fx from fin_settings where id = 1;
  insert into fin_invoices (number, client, concept, date, eur, usd, kind, status, fin_project_id, stripe_invoice_id)
  values (v_num, v_rec.name, v_concept, v_date,
          case when v_cur = 'usd' then round(v_amount * coalesce(v_fx, 0.92), 2) else v_amount end,
          case when v_cur = 'usd' then v_amount end,
          'mensualidad', 'cobrada', v_rec.fin_project_id, v_id)
  on conflict do nothing;
  return 'ok';
exception
  when invalid_text_representation or invalid_parameter_value then
    return 'payload_invalido';
end;
$$;

revoke all on function fin_stripe_webhook(text, text) from public, anon, authenticated, service_role;
grant execute on function fin_stripe_webhook(text, text) to anon;

-- Finanzas · cobros con Payment Links (migración 2026-10-26_finanzas_payment_links.sql)
alter table fin_recurrences add column if not exists stripe_payment_link text;
alter table fin_recurrences add column if not exists stripe_email text;
create index if not exists fin_recurrences_plink_idx on fin_recurrences (stripe_payment_link);

alter table fin_stripe_pending add column if not exists payment_link text not null default '';
alter table fin_stripe_pending add column if not exists email text not null default '';

create or replace function fin_stripe_webhook(p_payload text, p_signature text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_t text;
  v_sigs text[];
  v_event jsonb;
  v_type text;
  v_obj jsonb;
  v_id text;
  v_customer text;
  v_email text;
  v_plink text;
  v_amount numeric;
  v_cur text;
  v_fx numeric;
  v_date date;
  v_num text;
  v_concept text;
  v_name text;
  v_rec record;
begin
  -- Firma: cabecera "t=…,v1=…[,v1=…]"; HMAC-SHA256 de "t.payload"; 5 min de margen
  select value into v_secret from fin_secrets where key = 'stripe_webhook_secret';
  if v_secret is null then
    return 'sin_secreto';
  end if;
  select max(split_part(trim(x), '=', 2)) filter (where split_part(trim(x), '=', 1) = 't'),
         array_agg(split_part(trim(x), '=', 2)) filter (where split_part(trim(x), '=', 1) = 'v1')
    into v_t, v_sigs
    from unnest(string_to_array(coalesce(p_signature, ''), ',')) x;
  if v_t is null or v_t !~ '^\d{1,12}$' or v_sigs is null then
    return 'firma_invalida';
  end if;
  if abs(extract(epoch from now()) - v_t::bigint) > 300 then
    return 'firma_caducada';
  end if;
  if not encode(hmac(convert_to(v_t || '.' || p_payload, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') = any (v_sigs) then
    return 'firma_invalida';
  end if;

  v_event := p_payload::jsonb;
  v_type := v_event ->> 'type';
  v_obj := v_event -> 'data' -> 'object';

  if v_type = 'invoice.paid' then
    -- Suscripciones (también las creadas desde un Payment Link)
    v_id := v_obj ->> 'id';
    v_amount := coalesce((v_obj ->> 'amount_paid')::numeric, 0) / 100;
    v_customer := coalesce(v_obj ->> 'customer', '');
    v_email := coalesce(v_obj ->> 'customer_email', '');
    v_name := coalesce(v_obj ->> 'customer_name', '');
    v_plink := '';
    v_date := (to_timestamp(coalesce((v_obj -> 'status_transitions' ->> 'paid_at')::bigint, (v_obj ->> 'created')::bigint))
               at time zone 'Europe/Madrid')::date;
    -- Serie S con el correlativo de Stripe ("XXXX-0004" → "S0004")
    v_num := coalesce(v_obj ->> 'number', '');
    v_num := 'S' || case when v_num ~ '-\d+$' then lpad(substring(v_num from '-(\d+)$'), 4, '0') else v_num end;
    v_concept := coalesce(nullif(v_obj -> 'lines' -> 'data' -> 0 ->> 'description', ''), 'Mensualidad (Stripe)');
  elsif v_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    -- Pagos únicos por Payment Link. Si hay factura o es suscripción, ya entra por invoice.paid.
    if v_obj ->> 'payment_status' is distinct from 'paid'
       or v_obj ->> 'mode' = 'subscription'
       or v_obj ->> 'invoice' is not null then
      return 'ignorado';
    end if;
    v_id := v_obj ->> 'id';
    v_amount := coalesce((v_obj ->> 'amount_total')::numeric, 0) / 100;
    v_customer := coalesce(v_obj ->> 'customer', '');
    v_email := coalesce(v_obj -> 'customer_details' ->> 'email', v_obj ->> 'customer_email', '');
    v_name := coalesce(v_obj -> 'customer_details' ->> 'name', '');
    v_plink := coalesce(v_obj ->> 'payment_link', '');
    v_date := (to_timestamp((v_obj ->> 'created')::bigint) at time zone 'Europe/Madrid')::date;
    v_num := 'S-' || right(v_id, 8);
    v_concept := 'Mensualidad (enlace de pago Stripe)';
  else
    return 'ignorado';
  end if;

  if v_id is null or v_amount <= 0 then
    return 'ignorado';
  end if;
  if exists (select 1 from fin_invoices where stripe_invoice_id = v_id)
     or exists (select 1 from fin_stripe_pending where stripe_invoice_id = v_id) then
    return 'duplicado';
  end if;
  v_cur := lower(coalesce(v_obj ->> 'currency', 'eur'));

  -- Vincular: por Payment Link, si no por customer, si no por email
  select r.fin_project_id, p.name
    into v_rec
    from fin_recurrences r
    join fin_projects p on p.id = r.fin_project_id
   where r.status <> 'cancelada'
     and ((v_plink <> '' and r.stripe_payment_link = v_plink)
       or (v_customer <> '' and r.stripe_customer_id = v_customer)
       or (v_email <> '' and lower(r.stripe_email) = lower(v_email)))
   order by (v_plink <> '' and r.stripe_payment_link = v_plink) desc,
            (v_customer <> '' and r.stripe_customer_id = v_customer) desc,
            (r.status = 'activa') desc,
            r.slot
   limit 1;

  if not found then
    insert into fin_stripe_pending (stripe_invoice_id, customer_id, customer_name, number, concept, amount, currency, paid_date,
                                    payment_link, email)
    values (v_id, v_customer, coalesce(nullif(v_name, ''), v_email), v_num, v_concept, v_amount, v_cur, v_date, v_plink, v_email)
    on conflict (stripe_invoice_id) do nothing;
    return 'sin_vincular';
  end if;

  select fx_usd_eur into v_fx from fin_settings where id = 1;
  insert into fin_invoices (number, client, concept, date, eur, usd, kind, status, fin_project_id, stripe_invoice_id)
  values (v_num, v_rec.name, v_concept, v_date,
          case when v_cur = 'usd' then round(v_amount * coalesce(v_fx, 0.92), 2) else v_amount end,
          case when v_cur = 'usd' then v_amount end,
          'mensualidad', 'cobrada', v_rec.fin_project_id, v_id)
  on conflict do nothing;
  return 'ok';
exception
  when invalid_text_representation or invalid_parameter_value then
    return 'payload_invalido';
end;
$$;

revoke all on function fin_stripe_webhook(text, text) from public, anon, authenticated, service_role;
grant execute on function fin_stripe_webhook(text, text) to anon;
