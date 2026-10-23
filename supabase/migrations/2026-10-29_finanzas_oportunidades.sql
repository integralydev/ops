-- ============================================================================
-- Migración: finanzas · mensualidades firmadas y oportunidades
--   · fin_recurrences.status admite 'confirmada' (firmada, pendiente del
--     primer cobro): cuenta en la previsión como entrada confirmada, pero no en
--     el MRR activo. Se pasa sola a 'activa' cuando se cobra la primera
--     mensualidad de su proyecto (factura de mensualidad cobrada, a mano o por
--     Stripe).
--   · fin_recurrences.probability: para las 'por_activar', que cuentan como
--     probables en la previsión (por defecto 50 %).
--   · fin_opportunities: importes de los proyectos del OPS que están en
--     descubrimiento, propuesta o presupuesto. Los precios NUNCA van en
--     projects (la ven Francesc y los devs); aquí solo los ven propietarios.
--
-- Mismas reglas que siempre: RLS solo can_see_finance() (propietario + aal2),
-- nada para anon, fuera de Realtime, sin actividad ni correos.
-- Ejecutar ANTES de publicar el código. Es idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Mensualidades: estado 'confirmada' y probabilidad
-- ---------------------------------------------------------------------------
alter table fin_recurrences drop constraint if exists fin_recurrences_status;
alter table fin_recurrences add constraint fin_recurrences_status
  check (status in ('activa', 'confirmada', 'por_activar', 'cancelada'));

alter table fin_recurrences add column if not exists probability smallint;
alter table fin_recurrences drop constraint if exists fin_recurrences_probability;
alter table fin_recurrences add constraint fin_recurrences_probability
  check (probability is null or probability between 0 and 100);

-- active ⇄ status (solo toca la propia fila). 'confirmada' no es activa.
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
                       when old.status in ('cancelada', 'confirmada') then old.status
                       else 'por_activar' end;
  end if;
  return new;
end;
$$;

-- Primer cobro de una mensualidad → sus tramos 'confirmada' pasan a 'activa'.
-- Solo toca fin_recurrences del mismo proyecto; sin actividad ni correos.
create or replace function trg_fin_invoices_activate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cobrada' and new.kind = 'mensualidad' and new.fin_project_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'cobrada') then
    update fin_recurrences
       set status = 'activa'
     where fin_project_id = new.fin_project_id
       and status = 'confirmada';
  end if;
  return new;
end;
$$;
revoke execute on function trg_fin_invoices_activate() from public, anon, authenticated;

drop trigger if exists trg_fin_invoices_activate on fin_invoices;
create trigger trg_fin_invoices_activate
  after insert or update of status on fin_invoices
  for each row execute function trg_fin_invoices_activate();

-- ---------------------------------------------------------------------------
-- 2) Oportunidades (una por proyecto del OPS)
-- ---------------------------------------------------------------------------
create table if not exists fin_opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  amount_eur numeric(12, 2),
  monthly_eur numeric(12, 2),
  probability smallint check (probability is null or probability between 0 and 100),
  expected_close text check (expected_close is null or expected_close ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  first_payment_pct smallint not null default 50 check (first_payment_pct between 0 and 100),
  delivery_months smallint not null default 2 check (delivery_months between 0 and 24),
  note text not null default '',
  -- Al ganarla: el proyecto económico que se creó a partir de ella
  converted_fin_project_id uuid references fin_projects (id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fin_opportunities_project_uidx on fin_opportunities (project_id);

-- ---------------------------------------------------------------------------
-- 3) Permisos: solo propietarios con sesión aal2. Nada para anon. Sin Realtime.
-- ---------------------------------------------------------------------------
do $$
begin
  alter table fin_opportunities enable row level security;
  alter table fin_opportunities force row level security;
  revoke all on fin_opportunities from anon;
  drop policy if exists fin_opportunities_owner_all on fin_opportunities;
  create policy fin_opportunities_owner_all on fin_opportunities
    for all to authenticated using (can_see_finance()) with check (can_see_finance());
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fin_opportunities') then
    alter publication supabase_realtime drop table fin_opportunities;
  end if;
end $$;

commit;
