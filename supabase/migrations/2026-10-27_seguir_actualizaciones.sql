-- ============================================================================
-- Migración: seguir las actualizaciones de un proyecto
--   · project_follows: quién sigue qué proyecto. Cada persona solo ve, crea
--     y borra sus propias filas, y solo puede seguir proyectos a los que
--     tiene acceso.
--   · project_update_recipients(pid): a quién avisar por email de una
--     actualización nueva: quien sigue el proyecto y sigue teniendo acceso,
--     nunca quien publica. Solo la puede usar alguien con acceso al proyecto.
--
-- Ejecutar ANTES de publicar la versión que lo usa. Es idempotente.
-- ============================================================================

begin;

create table if not exists project_follows (
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table project_follows enable row level security;
revoke all on project_follows from anon;

drop policy if exists project_follows_select_own on project_follows;
create policy project_follows_select_own on project_follows for select to authenticated
  using (user_id = auth.uid());
drop policy if exists project_follows_insert_own on project_follows;
create policy project_follows_insert_own on project_follows for insert to authenticated
  with check (user_id = auth.uid() and is_project_member(project_id));
drop policy if exists project_follows_delete_own on project_follows;
create policy project_follows_delete_own on project_follows for delete to authenticated
  using (user_id = auth.uid());

-- Misma regla de acceso que is_project_member, pero para cada seguidor
create or replace function project_update_recipients(pid uuid)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select f.user_id
    from project_follows f
    join profiles pr on pr.id = f.user_id
    join projects p on p.id = f.project_id
   where f.project_id = pid
     and is_project_member(pid)
     and f.user_id <> auth.uid()
     and (pr.role in ('admin', 'director')
          or (pr.role = 'developer' and (p.owner_id = f.user_id or f.user_id = any (p.developer_ids))));
$$;

revoke all on function project_update_recipients(uuid) from public, anon;
grant execute on function project_update_recipients(uuid) to authenticated;

commit;
