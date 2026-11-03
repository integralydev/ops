-- ============================================================================
-- Migración: finanzas · banco (Mercury)
--   · fin_bank_tx: movimientos de las cuentas de Mercury. Se leen una vez al
--     día (y con el botón «Sincronizar» de Finanzas). Cada movimiento queda
--     «pendiente» hasta que un propietario lo concilia con una factura o un
--     pago hecho, o lo ignora. Nada se marca como cobrado solo.
--     Se clasifican solos: los ingresos de Stripe («stripe»: ya entran por su
--     webhook, contarlos otra vez sería duplicar), los traspasos entre cuentas
--     y los fallidos o cancelados («ignorado»).
--   · fin_settings: saldo de Mercury, desde qué fecha se leen movimientos
--     (lo anterior ya está en los libros), última lectura y último error.
--   · fin_mercury_sync(): la llaman los propietarios (aal2) desde Finanzas.
--     fin_mercury_sync_core(): la hace todo; solo la ejecuta pg_cron (postgres).
--   · Token de Mercury en fin_secrets (sin acceso por API). Token de SOLO
--     LECTURA: con él no se puede mover dinero.
--
-- Mismas reglas: RLS solo propietarios + aal2, fuera de Realtime, sin triggers
-- de actividad ni correos, sin service_role. Ejecutar ANTES de publicar. Es
-- idempotente.
--
-- Después, guardar el token (Mercury → Settings → API Tokens → Read Only):
--   insert into fin_secrets (key, value) values ('mercury_api_token', 'secret-token:mercury_production_...')
--   on conflict (key) do update set value = excluded.value;
-- ============================================================================

begin;

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 1) Movimientos del banco
-- ---------------------------------------------------------------------------
create table if not exists fin_bank_tx (
  id text primary key, -- id de Mercury
  account_id text not null default '',
  account_name text not null default '',
  date date not null,
  amount numeric(12, 2) not null, -- en USD; negativo = salida
  kind text not null default '',
  status text not null default '',
  counterparty text not null default '',
  description text not null default '',
  note text not null default '',
  link text not null default '',
  fx_info jsonb,
  review text not null default 'pendiente' check (review in ('pendiente', 'conciliado', 'ignorado', 'stripe')),
  fin_invoice_id uuid references fin_invoices (id) on delete set null,
  fin_payment_id uuid references fin_payments_out (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_bank_tx_date_idx on fin_bank_tx (date desc);
create index if not exists fin_bank_tx_review_idx on fin_bank_tx (review);
alter table fin_bank_tx enable row level security;

alter table fin_settings add column if not exists bank_balance_usd numeric(12, 2);
alter table fin_settings add column if not exists bank_since date not null default date '2026-11-01';
alter table fin_settings add column if not exists bank_synced_at timestamptz;
alter table fin_settings add column if not exists bank_error text;

-- ---------------------------------------------------------------------------
-- 2) Permisos
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter table fin_bank_tx force row level security';
  execute 'revoke all on fin_bank_tx from anon';
  execute 'drop policy if exists fin_bank_tx_owner_all on fin_bank_tx';
  execute 'create policy fin_bank_tx_owner_all on fin_bank_tx for all to authenticated '
       || 'using (can_see_finance()) with check (can_see_finance())';
  -- La sincronización corre como postgres (security definer / pg_cron)
  execute 'drop policy if exists fin_bank_tx_definer on fin_bank_tx';
  execute 'create policy fin_bank_tx_definer on fin_bank_tx for all to postgres using (true) with check (true)';
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'fin_bank_tx') then
    execute 'alter publication supabase_realtime drop table fin_bank_tx';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Lectura de Mercury
-- ---------------------------------------------------------------------------
create or replace function fin_mercury_get(p_token text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  perform http_set_curlopt('CURLOPT_TIMEOUT', '30');
  select status, content
    into r
    from http(('GET', 'https://api.mercury.com/api/v1' || p_path,
               array[http_header('Authorization', 'Bearer ' || p_token), http_header('Accept', 'application/json')],
               null, null)::http_request);
  if r.status <> 200 then
    raise exception 'Mercury respondió % en %', r.status, split_part(p_path, '?', 1);
  end if;
  return r.content::jsonb;
end;
$$;
revoke all on function fin_mercury_get(text, text) from public, anon, authenticated, service_role;

create or replace function fin_mercury_sync_core()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_since date;
  v_last timestamptz;
  v_start date;
  v_acc jsonb;
  v_page jsonb;
  v_tx jsonb;
  v_offset int;
  v_n int;
  v_balance numeric := 0;
  v_new int := 0;
  v_pending int;
  v_date date;
  v_amount numeric;
  v_kind text;
  v_status text;
  v_cp text;
  v_review text;
  v_ins boolean;
begin
  select value into v_token from fin_secrets where key = 'mercury_api_token';
  if v_token is null then
    return 'sin_token';
  end if;
  select bank_since, bank_synced_at into v_since, v_last from fin_settings where id = 1;
  -- Se relee una ventana de 15 días para recoger cambios de estado (pending → sent)
  v_start := greatest(v_since, coalesce((v_last at time zone 'Europe/Madrid')::date - 15, v_since));

  for v_acc in select * from jsonb_array_elements(coalesce(fin_mercury_get(v_token, '/accounts') -> 'accounts', '[]'::jsonb))
  loop
    if coalesce(v_acc ->> 'status', 'active') in ('deleted', 'archived') then
      continue;
    end if;
    v_balance := v_balance + coalesce((v_acc ->> 'currentBalance')::numeric, 0);
    v_offset := 0;
    loop
      v_page := fin_mercury_get(v_token, format('/account/%s/transactions?start=%s&limit=500&offset=%s&order=asc',
                                                 v_acc ->> 'id', v_start, v_offset));
      v_n := 0;
      for v_tx in select * from jsonb_array_elements(coalesce(v_page -> 'transactions', '[]'::jsonb))
      loop
        v_n := v_n + 1;
        v_amount := (v_tx ->> 'amount')::numeric;
        v_kind := coalesce(v_tx ->> 'kind', '');
        v_status := coalesce(v_tx ->> 'status', '');
        v_cp := coalesce(nullif(v_tx ->> 'counterpartyNickname', ''), v_tx ->> 'counterpartyName', '');
        v_date := (coalesce(v_tx ->> 'postedAt', v_tx ->> 'createdAt')::timestamptz at time zone 'Europe/Madrid')::date;
        if v_date < v_since then
          continue;
        end if;
        v_review := case
          when v_status in ('failed', 'cancelled', 'reversed', 'blocked') then 'ignorado'
          when v_kind in ('internalTransfer', 'treasuryTransfer') then 'ignorado'
          when v_amount > 0 and (v_cp ilike '%stripe%' or coalesce(v_tx ->> 'bankDescription', '') ilike '%stripe%') then 'stripe'
          else 'pendiente'
        end;
        insert into fin_bank_tx (id, account_id, account_name, date, amount, kind, status, counterparty, description, note, link, fx_info, review)
        values (v_tx ->> 'id', v_acc ->> 'id', coalesce(v_acc ->> 'nickname', v_acc ->> 'name', ''), v_date, v_amount, v_kind,
                v_status, v_cp, coalesce(v_tx ->> 'bankDescription', ''),
                concat_ws(' · ', nullif(v_tx ->> 'note', ''), nullif(v_tx ->> 'externalMemo', '')),
                coalesce(v_tx ->> 'dashboardLink', ''), v_tx -> 'currencyExchangeInfo', v_review)
        on conflict (id) do update
          set status = excluded.status,
              date = excluded.date,
              amount = excluded.amount,
              counterparty = excluded.counterparty,
              description = excluded.description,
              note = excluded.note,
              fx_info = excluded.fx_info,
              -- Un movimiento que falla después deja de pedir revisión
              review = case when fin_bank_tx.review = 'pendiente' and excluded.review = 'ignorado' then 'ignorado' else fin_bank_tx.review end,
              updated_at = now()
        returning (xmax = 0) into v_ins;
        if v_ins and v_review = 'pendiente' then
          v_new := v_new + 1;
        end if;
      end loop;
      exit when v_n < 500;
      v_offset := v_offset + 500;
    end loop;
  end loop;

  update fin_settings set bank_balance_usd = v_balance, bank_synced_at = now(), bank_error = null where id = 1;
  select count(*) into v_pending from fin_bank_tx where review = 'pendiente' and status = 'sent';
  return format('ok · %s nuevos · %s por revisar', v_new, v_pending);
exception
  when others then
    update fin_settings set bank_error = left(sqlerrm, 300) where id = 1;
    return 'error: ' || left(sqlerrm, 300);
end;
$$;
revoke all on function fin_mercury_sync_core() from public, anon, authenticated, service_role;

-- Botón «Sincronizar» de Finanzas: solo propietarios con aal2
create or replace function fin_mercury_sync()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not can_see_finance() then
    raise exception 'Solo propietarios con verificación en dos pasos';
  end if;
  return fin_mercury_sync_core();
end;
$$;
revoke all on function fin_mercury_sync() from public, anon, service_role;
grant execute on function fin_mercury_sync() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Una lectura al día, a las 7:00 UTC
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'fin-mercury-sync') then
    perform cron.unschedule('fin-mercury-sync');
  end if;
  perform cron.schedule('fin-mercury-sync', '0 7 * * *', 'select public.fin_mercury_sync_core()');
end $$;

commit;
