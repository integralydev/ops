-- ============================================================================
-- Migración: prioridad de las empresas de Comercial
--   prospects.priority: 'A' (llamar primero), 'B' (después), 'C' (poco
--   encaje) o vacío (null). Sigue los mismos permisos que el resto de la
--   fila (no se toca ninguna política).
--   Cambiar la prioridad no cuenta como "movimiento" ni va al historial: el
--   trigger de último movimiento solo mira estado, responsable y próxima
--   acción, así que no hay que tocarlo.
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa (no afecta a la
-- versión actual).
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table prospects add column if not exists priority text;

alter table prospects drop constraint if exists prospects_priority_check;
alter table prospects add constraint prospects_priority_check
  check (priority is null or priority in ('A', 'B', 'C'));

commit;
