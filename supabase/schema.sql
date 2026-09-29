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
  role text not null default 'developer' check (role in ('admin', 'director', 'developer')),
  full_name text,
  created_at timestamptz not null default now(),
  added_by uuid references auth.users (id)
);

-- ---------------------------------------------------------------------------
-- Tabla: clients
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text default '',
  email text default '',
  phone text default '',
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
  demo_url text default '',
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

-- ---------------------------------------------------------------------------
-- Tabla: notes (comentarios/actividad por proyecto)
-- ---------------------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  author_id uuid references auth.users (id),
  text text not null,
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now()
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

create or replace function is_project_member(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
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
create policy "clients_select" on clients for select to authenticated using (true);
create policy "clients_write_admin" on clients for insert to authenticated with check (is_staff());
create policy "clients_update_admin" on clients for update to authenticated using (is_staff()) with check (is_staff());
create policy "clients_delete_admin" on clients for delete to authenticated using (is_staff());

-- projects — solo ven/editan quienes son miembros (o admins); crear/editar
-- metadatos completos es solo de admins (el "próximo paso" se actualiza
-- aparte vía la función update_next_step, abierta a cualquier miembro).
create policy "projects_select_member" on projects for select to authenticated
  using (is_staff() or owner_id = auth.uid() or auth.uid() = any(developer_ids));
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

-- ============================================================================
-- Después de ejecutar este script, crea a la primera persona administradora
-- a mano (ver README.md, sección "Primer arranque").
-- ============================================================================
