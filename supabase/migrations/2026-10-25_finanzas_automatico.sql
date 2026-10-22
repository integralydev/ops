-- ============================================================================
-- Migración: finanzas · que se mantenga solo
--   · fin_recurrences: stripe_customer_id (para vincular los cobros de Stripe)
--     y payment_terms_days (días de pago: la entrada se espera en
--     día de cobro + estos días).
--   · fin_scheduled: frecuencia 'anual' y `skipped` (cuotas que no se pagaron
--     o se movieron a otra fecha; dejan de salir en la previsión).
--   · fin_invoices.stripe_invoice_id (único: un cobro de Stripe no entra dos veces).
--   · fin_stripe_pending: cobros de Stripe de un customer sin vincular, para
--     avisar en Finanzas en vez de perderlos.
--   · fin_secrets: el secreto del webhook de Stripe. Sin políticas: no se
--     puede leer desde la API, solo desde el SQL Editor.
--   · fin_stripe_webhook(payload, firma): la ÚNICA vía de escritura del
--     webhook. Verifica la firma de Stripe aquí dentro (con el secreto de
--     fin_secrets) y solo crea facturas cobradas de invoice.paid. La puede
--     ejecutar el rol anónimo (el webhook no tiene sesión); nadie más. Sin
--     service_role.
--
-- Mismas reglas: RLS solo is_owner() + aal2, fuera de Realtime, sin triggers
-- de actividad ni correos. Ejecutar ANTES de publicar. Es idempotente.
--
-- Después, guardar el secreto del webhook (lo da Stripe al crear el endpoint):
--   insert into fin_secrets (key, value) values ('stripe_webhook_secret', 'whsec_...')
--   on conflict (key) do update set value = excluded.value;
-- ============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1) Mensualidades: customer de Stripe y días de pago
-- ---------------------------------------------------------------------------
alter table fin_recurrences add column if not exists stripe_customer_id text;
alter table fin_recurrences add column if not exists payment_terms_days smallint not null default 0;
alter table fin_recurrences drop constraint if exists fin_recurrences_terms;
alter table fin_recurrences add constraint fin_recurrences_terms check (payment_terms_days between 0 and 365);
create index if not exists fin_recurrences_stripe_idx on fin_recurrences (stripe_customer_id);

-- ---------------------------------------------------------------------------
-- 2) Programados: anual y cuotas saltadas
-- ---------------------------------------------------------------------------
alter table fin_scheduled drop constraint if exists fin_scheduled_frequency_check;
alter table fin_scheduled add constraint fin_scheduled_frequency_check
  check (frequency in ('unica', 'mensual', 'trimestral', 'anual'));
alter table fin_scheduled add column if not exists skipped date[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 3) Facturas de Stripe
-- ---------------------------------------------------------------------------
alter table fin_invoices add column if not exists stripe_invoice_id text;
create unique index if not exists fin_invoices_stripe_uidx on fin_invoices (stripe_invoice_id);

create table if not exists fin_stripe_pending (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  customer_id text not null default '',
  customer_name text not null default '',
  number text not null default '',
  concept text not null default '',
  amount numeric(12, 2) not null,
  currency text not null default 'eur',
  paid_date date not null,
  created_at timestamptz not null default now()
);
alter table fin_stripe_pending enable row level security;

create table if not exists fin_secrets (
  key text primary key,
  value text not null
);
alter table fin_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Permisos
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- Tablas de propietarios (igual que el resto de fin_*)
  execute 'alter table fin_stripe_pending force row level security';
  execute 'revoke all on fin_stripe_pending from anon';
  execute 'drop policy if exists fin_stripe_pending_owner_all on fin_stripe_pending';
  execute 'create policy fin_stripe_pending_owner_all on fin_stripe_pending for all to authenticated '
       || 'using (can_see_finance()) with check (can_see_finance())';

  -- Secretos: nadie desde la API (ni propietarios)
  execute 'alter table fin_secrets force row level security';
  execute 'revoke all on fin_secrets from anon, authenticated';

  -- La función del webhook corre como su dueño (postgres). Como las tablas
  -- fin_* fuerzan RLS también para el dueño, se le da paso explícito; no
  -- cambia nada para anon ni authenticated.
  foreach t in array array['fin_secrets', 'fin_settings', 'fin_projects', 'fin_recurrences', 'fin_invoices', 'fin_stripe_pending'] loop
    execute format('drop policy if exists %I on %I', t || '_definer', t);
    execute format('create policy %I on %I for all to postgres using (true) with check (true)', t || '_definer', t);
  end loop;

  foreach t in array array['fin_stripe_pending', 'fin_secrets'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime drop table %I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Webhook de Stripe: invoice.paid → factura cobrada (mensualidad)
-- ---------------------------------------------------------------------------
create or replace function fin_stripe_webhook(p_payload text, p_signature text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_t text;
  v_sigs text[];
  v_event jsonb;
  v_inv jsonb;
  v_id text;
  v_customer text;
  v_amount numeric;
  v_cur text;
  v_fx numeric;
  v_date date;
  v_num text;
  v_concept text;
  v_rec record;
begin
  -- Firma: cabecera "t=…,v1=…[,v1=…]"; HMAC-SHA256 de "t.payload"; 5 min de margen
  select value into v_secret from fin_secrets where key = 'stripe_webhook_secret';
  if v_secret is null then
    return 'sin_secreto';
  end if;
  select max(split_part(trim(x), '=', 2)) filter (where split_part(trim(x), '=', 1) = 't'),
         array_agg(split_part(trim(x), '=', 2)) filter (where split_part(trim(x), '=', 1) = 'v1')
    into v_t, v_sigs
    from unnest(string_to_array(coalesce(p_signature, ''), ',')) x;
  if v_t is null or v_t !~ '^\d{1,12}$' or v_sigs is null then
    return 'firma_invalida';
  end if;
  if abs(extract(epoch from now()) - v_t::bigint) > 300 then
    return 'firma_caducada';
  end if;
  if not encode(hmac(convert_to(v_t || '.' || p_payload, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') = any (v_sigs) then
    return 'firma_invalida';
  end if;

  v_event := p_payload::jsonb;
  if v_event ->> 'type' is distinct from 'invoice.paid' then
    return 'ignorado';
  end if;
  v_inv := v_event -> 'data' -> 'object';
  v_id := v_inv ->> 'id';
  v_amount := coalesce((v_inv ->> 'amount_paid')::numeric, 0) / 100;
  if v_id is null or v_amount <= 0 then
    return 'ignorado';
  end if;
  if exists (select 1 from fin_invoices where stripe_invoice_id = v_id)
     or exists (select 1 from fin_stripe_pending where stripe_invoice_id = v_id) then
    return 'duplicado';
  end if;

  v_customer := coalesce(v_inv ->> 'customer', '');
  v_cur := lower(coalesce(v_inv ->> 'currency', 'eur'));
  v_date := (to_timestamp(coalesce((v_inv -> 'status_transitions' ->> 'paid_at')::bigint, (v_inv ->> 'created')::bigint))
             at time zone 'Europe/Madrid')::date;
  -- Serie S con el correlativo de Stripe ("XXXX-0004" → "S0004")
  v_num := coalesce(v_inv ->> 'number', '');
  v_num := 'S' || case when v_num ~ '-\d+$' then lpad(substring(v_num from '-(\d+)$'), 4, '0') else v_num end;
  v_concept := coalesce(nullif(v_inv -> 'lines' -> 'data' -> 0 ->> 'description', ''), 'Mensualidad (Stripe)');

  select r.fin_project_id, p.name
    into v_rec
    from fin_recurrences r
    join fin_projects p on p.id = r.fin_project_id
   where v_customer <> '' and r.stripe_customer_id = v_customer
   order by (r.status = 'activa') desc, r.slot
   limit 1;

  if not found then
    insert into fin_stripe_pending (stripe_invoice_id, customer_id, customer_name, number, concept, amount, currency, paid_date)
    values (v_id, v_customer, coalesce(v_inv ->> 'customer_name', v_inv ->> 'customer_email', ''), v_num, v_concept,
            v_amount, v_cur, v_date)
    on conflict (stripe_invoice_id) do nothing;
    return 'sin_vincular';
  end if;

  select fx_usd_eur into v_fx from fin_settings where id = 1;
  insert into fin_invoices (number, client, concept, date, eur, usd, kind, status, fin_project_id, stripe_invoice_id)
  values (v_num, v_rec.name, v_concept, v_date,
          case when v_cur = 'usd' then round(v_amount * coalesce(v_fx, 0.92), 2) else v_amount end,
          case when v_cur = 'usd' then v_amount end,
          'mensualidad', 'cobrada', v_rec.fin_project_id, v_id)
  on conflict do nothing;
  return 'ok';
exception
  when invalid_text_representation or invalid_parameter_value then
    return 'payload_invalido';
end;
$$;

revoke all on function fin_stripe_webhook(text, text) from public, anon, authenticated, service_role;
grant execute on function fin_stripe_webhook(text, text) to anon;

commit;
