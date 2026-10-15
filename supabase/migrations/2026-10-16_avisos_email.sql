-- ============================================================================
-- Migración: preferencias de avisos por email de cada persona
--   · notify_task_assigned: email cuando te asignan una tarea (ya existía el
--     aviso; ahora se puede apagar).
--   · notify_task_comments: email cuando alguien comenta en una tarea tuya
--     (asignada a ti, creada por ti o en la que has comentado).
--   Las dos vienen activadas. Cada persona las cambia en Ajustes (la política
--   de profiles ya deja editar la fila propia).
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table profiles add column if not exists notify_task_assigned boolean not null default true;
alter table profiles add column if not exists notify_task_comments boolean not null default true;

commit;
