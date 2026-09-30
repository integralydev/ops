-- ============================================================================
-- Migración: scope (alcance) de cada proyecto
--   · Tabla scope_items: puntos del scope con estado incluido / excluido /
--     por decidir, bloque opcional y marca de "ampliación" si se añadió
--     después de cerrar el scope. SIN importes, a propósito: así se puede
--     enseñar a developers (y en el futuro a clientes) sin riesgo.
--   · En projects: cuándo y quién cerró el scope, y el PDF de referencia.
-- Permisos: lo ven todos los miembros del proyecto; solo admin/director
-- lo editan.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

create table if not exists scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  status text not null default 'incluido' check (status in ('incluido', 'excluido', 'por_decidir')),
  block text not null default '',
  is_extension boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists scope_items_project_id_idx on scope_items (project_id);

alter table scope_items enable row level security;
drop policy if exists "scope_select_member" on scope_items;
drop policy if exists "scope_insert_staff" on scope_items;
drop policy if exists "scope_update_staff" on scope_items;
drop policy if exists "scope_delete_staff" on scope_items;
create policy "scope_select_member" on scope_items for select to authenticated using (is_project_member(project_id));
create policy "scope_insert_staff" on scope_items for insert to authenticated with check (is_staff());
create policy "scope_update_staff" on scope_items for update to authenticated using (is_staff()) with check (is_staff());
create policy "scope_delete_staff" on scope_items for delete to authenticated using (is_staff());

alter table projects add column if not exists scope_closed_at timestamptz;
alter table projects add column if not exists scope_closed_by uuid references auth.users (id) on delete set null;
alter table projects add column if not exists scope_source_file_id uuid references files (id) on delete set null;

-- Realtime: que los cambios del scope se vean en vivo
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scope_items'
  ) then
    alter publication supabase_realtime add table scope_items;
  end if;
end;
$$;

commit;
