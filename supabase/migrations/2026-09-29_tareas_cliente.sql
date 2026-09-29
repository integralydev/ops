-- ============================================================================
-- Migración: tareas asignadas al cliente
-- Permite marcar una tarea como pendiente del cliente del proyecto (p. ej.
-- "Aprobar cambio estético corporativo") en lugar de una persona del equipo.
-- Las tareas existentes no cambian (quedan en false).
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

alter table tasks add column if not exists assigned_to_client boolean not null default false;
