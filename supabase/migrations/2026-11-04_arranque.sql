-- ============================================================================
-- Migración: registro del arranque (pestaña "Arranque" del proyecto)
--
-- Primer paso del portal de cliente (ver ESPEC-v1 en mi-proyecto/integraly/
-- comercial/portal-cliente/). Antes de que entre ningún cliente, el equipo
-- apunta aquí cómo va el arranque de cada proyecto:
--   propuesta aceptada → contrato firmado → primer pago → reunión de inicio
--
-- Principio "ventana, no puerta": cada paso se marca hecho por el canal que
-- sea (correo, WhatsApp, llamada, en persona, Stripe, banco… o el portal
-- cuando exista). Nada bloquea nada: es un registro, no un flujo obligatorio.
--
-- Una fila por (proyecto, paso), creada al tocar el paso. Sin fila = pendiente.
-- Hecho = done_on no nulo. Sin importes: el dinero vive en Finanzas.
--
-- ACCESO: solo admin y director (is_staff()), como "Accesos externos".
-- La vista del cliente vendrá después, con funciones propias (no esta RLS).
--
-- Ejecutar ANTES de publicar el código. Es idempotente.
-- ============================================================================

begin;

-- Qué se le ha vendido para arrancar: implementación (camino A) o
-- diagnóstico de pago (camino B). Null = aún sin decidir.
alter table projects add column if not exists onboarding_track text;
alter table projects drop constraint if exists projects_onboarding_track_check;
alter table projects add constraint projects_onboarding_track_check
  check (onboarding_track is null or onboarding_track in ('implementacion', 'diagnostico'));

create table if not exists project_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  step text not null check (step in ('propuesta', 'contrato', 'primer_pago', 'reunion_inicio')),
  -- Fecha en que quedó hecho; null = pendiente
  done_on date,
  done_by uuid references profiles (id) on delete set null,
  -- Por dónde se cerró
  channel text check (channel is null or channel in
    ('portal', 'correo', 'whatsapp', 'llamada', 'en_persona', 'stripe', 'banco', 'otro')),
  note text not null default '' check (char_length(note) <= 500),
  -- Documento de respaldo (p. ej. el contrato firmado), de Archivos del proyecto
  file_id uuid references files (id) on delete set null,
  -- Solo para la reunión de inicio: cuándo está agendada
  scheduled_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, step),
  constraint onboarding_steps_no_secrets check (not looks_like_secret(note))
);
create index if not exists project_onboarding_steps_project_idx on project_onboarding_steps (project_id);

create or replace function trg_onboarding_steps_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_onboarding_steps_touch on project_onboarding_steps;
create trigger trg_onboarding_steps_touch
  before update on project_onboarding_steps
  for each row execute function trg_onboarding_steps_touch();

alter table project_onboarding_steps enable row level security;
revoke all on project_onboarding_steps from anon;

drop policy if exists "onboarding_select_staff" on project_onboarding_steps;
drop policy if exists "onboarding_insert_staff" on project_onboarding_steps;
drop policy if exists "onboarding_update_staff" on project_onboarding_steps;
drop policy if exists "onboarding_delete_staff" on project_onboarding_steps;
create policy "onboarding_select_staff" on project_onboarding_steps for select to authenticated using (is_staff());
create policy "onboarding_insert_staff" on project_onboarding_steps for insert to authenticated with check (is_staff());
create policy "onboarding_update_staff" on project_onboarding_steps for update to authenticated using (is_staff()) with check (is_staff());
create policy "onboarding_delete_staff" on project_onboarding_steps for delete to authenticated using (is_staff());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_onboarding_steps') then
    alter publication supabase_realtime add table project_onboarding_steps;
  end if;
end $$;

commit;
