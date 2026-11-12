-- ============================================================================
-- Migración: seguridad, segunda tanda (12 nov 2026)
--   1. Nadie puede escribir a nombre de otro: actualizaciones, tareas, ideas
--      (al crear) y, al editar, el autor no se puede cambiar (salvo admin).
--   2. Enlaces del proyecto: los edita quien los creó o el staff.
--   3. Borrar tareas/archivos propios exige seguir en el proyecto.
--   4. Perfil propio: no se puede cambiar portal_visible ni added_by.
--   5. portal_new_referral_code: fuera del alcance de la API (solo lo usa
--      el trigger de clientes).
-- ============================================================================

begin;

-- 1) Autoría al crear
drop policy if exists "notes_insert_member" on notes;
create policy "notes_insert_member" on notes for insert to authenticated
  with check (is_project_member(project_id) and author_id = auth.uid());

drop policy if exists "tasks_insert_member" on tasks;
create policy "tasks_insert_member" on tasks for insert to authenticated
  with check (is_project_member(project_id) and created_by = auth.uid());

drop policy if exists "ideas_insert_member" on content_ideas;
create policy "ideas_insert_member" on content_ideas for insert to authenticated
  with check (is_project_member(project_id) and created_by = auth.uid());

-- 1b) Autoría al editar: la columna de autor no cambia (salvo admin)
create or replace function trg_keep_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col text := tg_argv[0];
begin
  if (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) and not is_admin() then
    raise exception 'No se puede cambiar el autor (%)', col using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists keep_author on notes;
create trigger keep_author before update on notes for each row execute function trg_keep_author('author_id');
drop trigger if exists keep_author on tasks;
create trigger keep_author before update on tasks for each row execute function trg_keep_author('created_by');
drop trigger if exists keep_author on files;
create trigger keep_author before update on files for each row execute function trg_keep_author('uploaded_by');
drop trigger if exists keep_author on project_links;
create trigger keep_author before update on project_links for each row execute function trg_keep_author('created_by');
drop trigger if exists keep_author on content_ideas;
create trigger keep_author before update on content_ideas for each row execute function trg_keep_author('created_by');
drop trigger if exists keep_author on task_comments;
create trigger keep_author before update on task_comments for each row execute function trg_keep_author('author_id');

-- 2) Enlaces: editar solo quien lo creó o el staff
drop policy if exists "links_update_member" on project_links;
create policy "links_update_member" on project_links for update to authenticated
  using (is_project_member(project_id) and (is_staff() or created_by = auth.uid()))
  with check (is_project_member(project_id) and (is_staff() or created_by = auth.uid()));

-- 3) Borrar lo propio solo mientras sigues en el proyecto
drop policy if exists "tasks_delete_owner" on tasks;
create policy "tasks_delete_owner" on tasks for delete to authenticated
  using (is_staff() or (is_project_member(project_id) and created_by = auth.uid()));

drop policy if exists "files_delete_owner" on files;
create policy "files_delete_owner" on files for delete to authenticated
  using (is_staff() or (is_project_member(project_id) and uploaded_by = auth.uid()));

-- 4) Perfil propio: portal_visible y added_by solo los cambia un admin
create or replace function trg_profiles_protect_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() and (
       new.portal_visible is distinct from old.portal_visible
    or new.added_by is distinct from old.added_by) then
    raise exception 'Solo un administrador puede cambiar estos datos del perfil' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_protect_fields on profiles;
create trigger profiles_protect_fields before update on profiles
  for each row execute function trg_profiles_protect_fields();

-- 5) Generador de códigos de referido: solo para el trigger (security definer)
revoke all on function portal_new_referral_code(text, uuid) from public, anon, authenticated;

commit;
