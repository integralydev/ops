-- ============================================================================
-- Migración: adjuntar archivos a las tareas
-- Un archivo del proyecto puede quedar vinculado a una tarea (task_id).
-- Sigue apareciendo también en la pestaña Archivos, con los mismos permisos.
-- Si se borra la tarea, el archivo NO se borra: solo pierde el vínculo.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

alter table files add column if not exists task_id uuid references tasks (id) on delete set null;
create index if not exists files_task_id_idx on files (task_id);
