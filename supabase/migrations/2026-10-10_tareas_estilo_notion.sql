-- ============================================================================
-- Migración: tareas al estilo Notion / Todoist
--   · in_progress: columna "En curso" del tablero (la de "Hecha" sigue siendo
--     done, que usan el registro de actividad y los avisos).
--   · due_date: fecha límite.
--   · description: notas de la tarea (panel lateral).
--   · position: orden manual (arrastrar). Menor = más arriba. Las tareas que
--     ya existen conservan su orden actual (las más nuevas arriba).
--   · move_task(): reordenar es cosa de cualquier miembro del proyecto
--     (solo toca el orden, nada más de la tarea).
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table tasks add column if not exists in_progress boolean not null default false;
alter table tasks add column if not exists due_date date;
alter table tasks add column if not exists description text not null default '';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'position') then
    alter table tasks add column position double precision;
    update tasks set position = -extract(epoch from created_at);
    alter table tasks alter column position set default -extract(epoch from now());
    alter table tasks alter column position set not null;
  end if;
end $$;

create index if not exists tasks_project_position_idx on tasks (project_id, position);

create or replace function move_task(tid uuid, pos double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  select project_id into pid from tasks where id = tid;
  if pid is null or not is_project_member(pid) then
    raise exception 'No tienes acceso a esta tarea';
  end if;
  update tasks set position = pos where id = tid;
end;
$$;
grant execute on function move_task(uuid, double precision) to authenticated;

commit;
