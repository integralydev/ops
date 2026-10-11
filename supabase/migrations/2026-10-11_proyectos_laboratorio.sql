-- ============================================================================
-- Migración: proyectos de laboratorio (productos propios, sin cliente)
--   · projects.kind: 'cliente' (lo de siempre, por defecto) o 'laboratorio'.
--   · Cada tipo tiene sus estados y un proyecto nunca puede quedarse con un
--     estado del otro tipo:
--       cliente:     descubrimiento, propuesta, presupuesto, desarrollo,
--                    testing, mantenimiento, pausado, cerrado
--       laboratorio: idea, construccion, validacion, escalado, aparcado
--   · Un proyecto de laboratorio no tiene cliente (sí encargado y developers).
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa (solo amplía lo
-- que ya hay: los proyectos actuales quedan como 'cliente').
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table projects add column if not exists kind text not null default 'cliente';

alter table projects drop constraint if exists projects_kind_check;
alter table projects add constraint projects_kind_check check (kind in ('cliente', 'laboratorio'));

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (
  (kind = 'cliente' and status in ('descubrimiento', 'propuesta', 'presupuesto', 'desarrollo', 'testing', 'mantenimiento', 'pausado', 'cerrado'))
  or (kind = 'laboratorio' and status in ('idea', 'construccion', 'validacion', 'escalado', 'aparcado'))
);

alter table projects drop constraint if exists projects_lab_no_client;
alter table projects add constraint projects_lab_no_client check (kind = 'cliente' or client_id is null);

commit;
