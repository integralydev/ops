-- ============================================================================
-- Migración: comentarios en las tareas
--   · task_comments: comentarios de una tarea (autor, texto, fecha).
--   · task_comment_reads: hasta cuándo ha leído cada persona los comentarios
--     de cada tarea, para marcar desde fuera los comentarios nuevos de otros.
--   · Cada comentario nuevo va al registro de actividad del proyecto.
--   Permisos: los miembros del proyecto leen y comentan; cada uno edita y
--   borra lo suyo (admin/director, cualquiera). Cada uno solo ve y toca sus
--   propias marcas de leído.
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

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

commit;
