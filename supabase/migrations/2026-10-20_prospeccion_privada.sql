-- ============================================================================
-- Migración: empresas privadas en Comercial (prospección de Eloi)
--   · prospects.is_private: solo la ven y editan los admin. El rol comercial
--     no la ve en la lista, ni en la ficha, ni en el historial, ni en vivo.
--   · El rol comercial no puede crear privadas ni cambiar la marca (RLS y,
--     por si acaso, también un trigger).
--   · Una empresa privada nunca puede tener como responsable a alguien con
--     rol comercial (las privadas las lleva Eloi).
--   · source admite 'prospeccion'.
--   · Campos nuevos opcionales: sector, website, employees.
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa (no afecta a la
-- versión actual: todavía no hay privadas y no usa los campos nuevos).
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

-- 1) Campos
alter table prospects add column if not exists is_private boolean not null default false;
alter table prospects add column if not exists sector text not null default '';
alter table prospects add column if not exists website text not null default '';
alter table prospects add column if not exists employees text not null default '';

alter table prospects drop constraint if exists prospects_source_check;
alter table prospects add constraint prospects_source_check
  check (source in ('ana', 'silleda', 'pipeline', 'propio', 'prospeccion'));

create index if not exists prospects_private_idx on prospects (is_private) where is_private;

-- 2) ¿Puede la persona actual ver esta empresa? (acceso a Comercial y, si es
--    privada, ser admin). Para los permisos del historial.
create or replace function can_see_prospect(pid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select has_sales_access() and exists (
    select 1 from prospects p where p.id = pid and (not p.is_private or is_admin())
  );
$$;
grant execute on function can_see_prospect(uuid) to authenticated;

-- 3) Permisos de prospects
drop policy if exists "prospects_select_sales" on prospects;
drop policy if exists "prospects_insert_sales" on prospects;
drop policy if exists "prospects_update_sales" on prospects;
create policy "prospects_select_sales" on prospects for select to authenticated
  using (has_sales_access() and (not is_private or is_admin()));
create policy "prospects_insert_sales" on prospects for insert to authenticated
  with check (has_sales_access() and (not is_private or is_admin()));
create policy "prospects_update_sales" on prospects for update to authenticated
  using (has_sales_access() and (not is_private or is_admin()))
  with check (has_sales_access() and (not is_private or is_admin()));
-- (borrar sigue siendo solo de admin: prospects_delete_admin)

-- 4) Permisos del historial: los de la empresa padre
drop policy if exists "prospect_events_select_sales" on prospect_events;
drop policy if exists "prospect_events_insert_note" on prospect_events;
drop policy if exists "prospect_events_update_note" on prospect_events;
drop policy if exists "prospect_events_delete_note" on prospect_events;
create policy "prospect_events_select_sales" on prospect_events for select to authenticated
  using (can_see_prospect(prospect_id));
create policy "prospect_events_insert_note" on prospect_events for insert to authenticated
  with check (can_see_prospect(prospect_id) and kind = 'note' and actor_id = auth.uid());
create policy "prospect_events_update_note" on prospect_events for update to authenticated
  using (can_see_prospect(prospect_id) and kind = 'note' and (actor_id = auth.uid() or is_admin()))
  with check (can_see_prospect(prospect_id) and kind = 'note' and (actor_id = auth.uid() or is_admin()));
create policy "prospect_events_delete_note" on prospect_events for delete to authenticated
  using (can_see_prospect(prospect_id) and kind = 'note' and (actor_id = auth.uid() or is_admin()));

-- 5) Red de seguridad: la marca solo la toca admin, y una privada no puede
--    llevarla alguien con rol comercial
create or replace function trg_prospects_privacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.is_private and not is_admin())
     or (tg_op = 'UPDATE' and new.is_private is distinct from old.is_private and not is_admin()) then
    raise exception 'Solo un admin puede marcar o desmarcar una empresa como privada';
  end if;
  if new.is_private and new.owner_id is not null
     and exists (select 1 from profiles where id = new.owner_id and role = 'comercial') then
    raise exception 'Una empresa privada no puede tener como responsable a alguien con rol comercial';
  end if;
  return new;
end;
$$;
revoke execute on function trg_prospects_privacy() from public, authenticated, anon;

drop trigger if exists trg_prospects_privacy on prospects;
create trigger trg_prospects_privacy
  before insert or update on prospects
  for each row execute function trg_prospects_privacy();

commit;
