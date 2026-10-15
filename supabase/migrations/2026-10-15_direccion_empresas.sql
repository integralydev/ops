-- ============================================================================
-- Migración: dirección de las empresas de Comercial
--   · prospects.address: calle y número (la población va aparte, en city).
--   · "Último movimiento" (last_touched_at) solo cuenta lo comercial: cambio
--     de estado, de responsable o de próxima acción, y las notas (estas ya lo
--     actualizan por su cuenta). Corregir datos de contacto —teléfono, email,
--     dirección…— no cuenta como haber trabajado la empresa.
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table prospects add column if not exists address text not null default '';

create or replace function trg_prospects_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Enlazar con cliente/proyecto es cosa de admin/director (crean el proyecto)
  if (new.client_id is distinct from old.client_id or new.project_id is distinct from old.project_id)
     and not is_staff() then
    raise exception 'Solo admin puede enlazar la empresa con un cliente o proyecto';
  end if;
  new.updated_at := now();
  -- Movimiento comercial: estado, responsable o próxima acción
  if new.status is distinct from old.status
     or new.owner_id is distinct from old.owner_id
     or new.next_action is distinct from old.next_action
     or new.next_action_date is distinct from old.next_action_date then
    new.last_touched_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function trg_prospects_before_update() from public, authenticated, anon;

commit;
