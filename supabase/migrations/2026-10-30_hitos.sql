-- ============================================================================
-- Migración: hitos ("Lo que ha pasado" en Inicio)
--
-- Una línea por cada cosa importante que pasa en la agencia: decisiones,
-- cambios de estado de un cliente, cobros, clientes nuevos, giros de
-- estrategia. NO son tareas ni actualizaciones de proyecto.
-- Los escribe Claudia desde los chats (scripts/claude-ops.mjs hito) en el
-- momento en que pasan.
--
-- ACCESO: solo propietarios (is_owner()). Pueden incluir estrategia o dinero,
-- así que nadie más los ve: ni admin, ni director, ni devs, ni comerciales.
-- Fuera de Realtime, sin triggers de actividad y sin correos.
--
-- Ejecutar ANTES de publicar el código. Es idempotente.
-- ============================================================================

begin;

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  happened_on date not null default (now() at time zone 'Europe/Madrid')::date,
  title text not null check (char_length(title) between 1 and 240),
  detail text check (detail is null or char_length(detail) <= 1000),
  area text not null default 'otros'
    check (area in ('clientes', 'ventas', 'captacion', 'equipo', 'estrategia', 'dinero', 'laboratorio', 'otros')),
  project_id uuid references projects (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists milestones_happened_idx on milestones (happened_on desc, created_at desc);

alter table milestones enable row level security;
revoke all on milestones from anon;

drop policy if exists milestones_select on milestones;
drop policy if exists milestones_insert on milestones;
drop policy if exists milestones_update on milestones;
drop policy if exists milestones_delete on milestones;

create policy milestones_select on milestones for select to authenticated using (is_owner());
create policy milestones_insert on milestones for insert to authenticated with check (is_owner());
create policy milestones_update on milestones for update to authenticated using (is_owner()) with check (is_owner());
create policy milestones_delete on milestones for delete to authenticated using (is_owner());

commit;
