-- ============================================================================
-- Migración: actualizaciones con capturas + notas del proyecto
--   1) Las actualizaciones (tabla notes) pueden llevar imágenes adjuntas.
--      Las imágenes viven en el bucket privado "project-files", en
--      "<project_id>/updates/…", con los mismos permisos que los archivos.
--   2) Cada proyecto tiene un bloque de "Notas" (arquitectura, stack…):
--      lo ven todos los miembros del proyecto y solo lo editan admin/director
--      (la política de update de projects ya es solo para staff).
--   3) Solo admin y director pueden borrar actualizaciones (antes también
--      podía borrarlas su autor).
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table notes add column if not exists image_paths text[] not null default '{}';

alter table projects add column if not exists notes_doc text default '';
alter table projects add column if not exists notes_updated_at timestamptz;
alter table projects add column if not exists notes_updated_by uuid references auth.users (id);

drop policy if exists "notes_delete_owner" on notes;
create policy "notes_delete_owner" on notes for delete to authenticated
  using (is_staff());

commit;
