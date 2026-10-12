-- ============================================================================
-- Migración: fases de las tareas (flujo de desarrollo)
--   tasks.stage: backlog → next → doing → testing → deploy → production
--     · backlog: todo lo pendiente · next: lo que toca ahora (≈5)
--     · doing: en curso · testing: hecha, falta probar y validar
--     · deploy: validada y fusionada, pendiente de pasar a producción
--     · production: ya en producción = tarea hecha
--   Los proyectos de preventa solo usan backlog / doing / production
--   ("Por hacer / En curso / Hecha"); eso lo decide la app.
--
--   done e in_progress se mantienen (los usan el registro de actividad, los
--   avisos y otros scripts) y se sincronizan solos con stage:
--     done = (stage = 'production') · in_progress = (stage = 'doing')
--   Si algo cambia done directamente (p. ej. un script), stage se ajusta.
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'stage') then
    alter table tasks add column stage text not null default 'backlog'
      check (stage in ('backlog', 'next', 'doing', 'testing', 'deploy', 'production'));
    update tasks set stage = case when done then 'production' when in_progress then 'doing' else 'backlog' end;
  end if;
end $$;

create or replace function trg_tasks_sync_stage()
returns trigger
language plpgsql
as $$
begin
  -- Alta sin fase explícita pero marcada como hecha / en curso (versiones
  -- antiguas de la app o scripts): la fase sale de esas marcas
  if tg_op = 'INSERT' and new.stage = 'backlog' and (new.done or new.in_progress) then
    new.stage := case when new.done then 'production' else 'doing' end;
  end if;

  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    -- Manda la fase
    new.done := new.stage = 'production';
    new.in_progress := new.stage = 'doing';
  elsif new.done is distinct from old.done or new.in_progress is distinct from old.in_progress then
    -- Alguien ha tocado done / in_progress directamente: se ajusta la fase
    new.stage := case
      when new.done then 'production'
      when new.in_progress then 'doing'
      when old.stage = 'production' or old.stage = 'doing' then 'backlog'
      else old.stage
    end;
  end if;

  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := coalesce(new.done_at, now());
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_sync_stage on tasks;
create trigger trg_tasks_sync_stage
  before insert or update on tasks
  for each row execute function trg_tasks_sync_stage();

commit;
