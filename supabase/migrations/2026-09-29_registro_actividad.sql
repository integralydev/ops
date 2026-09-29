-- ============================================================================
-- Migración: registro de actividad (tabla "activity")
-- Triggers que apuntan automáticamente lo que pasa en cada proyecto:
--   · proyecto creado            · cambio de estado / fase
--   · cambio de encargado        · developer añadido al proyecto
--   · enlace de demo añadido     · notas del proyecto editadas
--   · próximo paso cambiado      · tarea creada / completada
--   · archivo subido             · actualización publicada
-- Cada persona solo ve la actividad de los proyectos a los que tiene acceso
-- (misma regla que el resto: is_project_member). Nadie puede escribir ni
-- borrar a mano en esta tabla; solo la rellenan los triggers.
-- Al final se rellena con el histórico que ya existe (proyectos, tareas,
-- archivos y actualizaciones), para que no empiece vacía.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

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
  if coalesce(new.demo_url, '') <> '' and new.demo_url is distinct from old.demo_url then
    perform log_activity(new.id, 'demo_link', jsonb_build_object('url', new.demo_url));
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

-- ---------------------------------------------------------------------------
-- Histórico: rellenar con lo que ya existe (solo si la tabla está vacía)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from activity) then
    insert into activity (project_id, actor_id, kind, data, created_at)
    select id, created_by, 'project_created', jsonb_build_object('status', status), created_at from projects;

    insert into activity (project_id, actor_id, kind, data, created_at)
    select project_id, created_by, 'task_created',
      jsonb_build_object('title', left(title, 200), 'assignee_id', assignee_id, 'client', assigned_to_client), created_at
    from tasks;

    insert into activity (project_id, actor_id, kind, data, created_at)
    select project_id, null, 'task_done',
      jsonb_build_object('title', left(title, 200), 'client', assigned_to_client), done_at
    from tasks where done and done_at is not null;

    insert into activity (project_id, actor_id, kind, data, created_at)
    select project_id, uploaded_by, 'file_uploaded', jsonb_build_object('filename', filename), uploaded_at from files;

    insert into activity (project_id, actor_id, kind, data, created_at)
    select project_id, author_id, 'update_posted',
      jsonb_build_object('text', left(text, 280), 'images', coalesce(array_length(image_paths, 1), 0)), created_at
    from notes;
  end if;
end;
$$;

-- Realtime: que la app reciba la actividad nueva en vivo
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

commit;
