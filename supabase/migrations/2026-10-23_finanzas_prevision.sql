-- ============================================================================
-- Migración: finanzas · previsión (lo que viene)
--   · fin_recurrences: calendario de cada mensualidad (start_month, end_month,
--     billing_day, method) y estado (activa | por_activar | cancelada).
--     active se mantiene y se sincroniza sola con status (los cálculos de la
--     fase 1 siguen igual).
--   · fin_scheduled: movimientos programados (entradas y salidas futuras).
--   · fin_payments_out: pagos hechos (salidas reales).
--   · fin_invoices: proyecto económico (para no contar dos veces mensualidad
--     y factura) y enlace al programado que factura.
--
-- Mismas reglas que la fase 1: RLS solo is_owner() + sesión aal2, sin anon,
-- fuera de Realtime, sin triggers de actividad ni correos.
--
-- Ejecutar ANTES de publicar la versión de la app que lo usa (no afecta a la
-- versión actual). Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Mensualidades con calendario
-- ---------------------------------------------------------------------------
alter table fin_recurrences add column if not exists start_month text
  constraint fin_recurrences_start_fmt check (start_month is null or start_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
alter table fin_recurrences add column if not exists end_month text
  constraint fin_recurrences_end_fmt check (end_month is null or end_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
alter table fin_recurrences add column if not exists billing_day smallint
  constraint fin_recurrences_day check (billing_day is null or billing_day between 1 and 31);
alter table fin_recurrences add column if not exists method text
  constraint fin_recurrences_method check (method is null or method in ('stripe', 'transferencia', 'otro'));

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'fin_recurrences' and column_name = 'status') then
    alter table fin_recurrences add column status text not null default 'por_activar'
      constraint fin_recurrences_status check (status in ('activa', 'por_activar', 'cancelada'));
    update fin_recurrences set status = case when active then 'activa' else 'por_activar' end;
  end if;
end $$;

-- active ⇄ status (solo toca la propia fila; sin actividad ni correos)
create or replace function trg_fin_recurrences_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'por_activar' and new.active then
      new.status := 'activa';
    end if;
    new.active := new.status = 'activa';
  elsif new.status is distinct from old.status then
    new.active := new.status = 'activa';
  elsif new.active is distinct from old.active then
    new.status := case when new.active then 'activa'
                       when old.status = 'cancelada' then 'cancelada'
                       else 'por_activar' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fin_recurrences_status on fin_recurrences;
create trigger trg_fin_recurrences_status
  before insert or update on fin_recurrences
  for each row execute function trg_fin_recurrences_status();

-- ---------------------------------------------------------------------------
-- 2) Movimientos programados
-- ---------------------------------------------------------------------------
create table if not exists fin_scheduled (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('entrada', 'salida')),
  concept text not null default '',
  counterparty text not null default '',
  fin_project_id uuid references fin_projects (id) on delete set null,
  amount_eur numeric(12, 2),
  amount_usd numeric(12, 2),
  frequency text not null default 'unica' check (frequency in ('unica', 'mensual', 'trimestral')),
  date date not null, -- la única, o el primer cargo
  end_date date,
  certainty text not null default 'confirmado' check (certainty in ('confirmado', 'probable')),
  probability smallint check (probability is null or probability between 0 and 100),
  note text not null default '',
  -- una única ya pagada / facturada deja de salir en la previsión
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint fin_scheduled_one_amount check ((amount_eur is null) <> (amount_usd is null))
);
create index if not exists fin_scheduled_date_idx on fin_scheduled (date);
alter table fin_scheduled enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Pagos hechos (salidas reales)
-- ---------------------------------------------------------------------------
create table if not exists fin_payments_out (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  concept text not null default '',
  counterparty text not null default '',
  amount_eur numeric(12, 2),
  amount_usd numeric(12, 2),
  fin_project_id uuid references fin_projects (id) on delete set null,
  kind text not null default 'otro' check (kind in ('dev', 'comision', 'comercial', 'gasto_fijo', 'otro')),
  -- si salda una cuota de un programado: cuál y de qué fecha
  scheduled_id uuid references fin_scheduled (id) on delete set null,
  period date,
  created_at timestamptz not null default now(),
  constraint fin_payments_out_one_amount check ((amount_eur is null) <> (amount_usd is null))
);
create index if not exists fin_payments_out_date_idx on fin_payments_out (date desc);
alter table fin_payments_out enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Facturas: proyecto y programado que facturan
-- ---------------------------------------------------------------------------
alter table fin_invoices add column if not exists fin_project_id uuid references fin_projects (id) on delete set null;
alter table fin_invoices add column if not exists scheduled_id uuid references fin_scheduled (id) on delete set null;
alter table fin_invoices add column if not exists scheduled_period date;

-- ---------------------------------------------------------------------------
-- 5) Permisos: solo propietarios con sesión aal2. Nada para anon. Sin Realtime.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fin_scheduled', 'fin_payments_out'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (can_see_finance()) with check (can_see_finance())',
      t || '_owner_all', t);
  end loop;
  foreach t in array array['fin_settings', 'fin_projects', 'fin_recurrences', 'fin_invoices', 'fin_receivables', 'fin_scheduled', 'fin_payments_out'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime drop table %I', t);
    end if;
  end loop;
end $$;

commit;
