-- ============================================================================
-- Migración: editar actualizaciones
--   Las actualizaciones (tabla notes) se pueden editar: su autor (p. ej. para
--   corregir una transcripción de voz) y admin/director. Se guarda cuándo se
--   editó para mostrar «editado».
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table notes add column if not exists edited_at timestamptz;

drop policy if exists "notes_update_author" on notes;
create policy "notes_update_author" on notes for update to authenticated
  using (author_id = auth.uid() or is_staff())
  with check ((author_id = auth.uid() or is_staff()) and is_project_member(project_id));

commit;
