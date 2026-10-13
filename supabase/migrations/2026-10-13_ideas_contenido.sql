-- ============================================================================
-- Migración: ideas de contenido (proyectos de laboratorio)
--   Lista sencilla de ideas para publicar sobre el producto. Sin estados:
--   cuando se publica una idea, se borra.
--   Permisos: los miembros del proyecto (como tareas o archivos).
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

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

commit;
