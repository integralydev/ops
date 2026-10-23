-- ============================================================================
-- Migración: finanzas · fecha de cobro separada de la fecha de factura
--   · fin_invoices.paid_date (opcional): cuándo llegó el dinero. Si una
--     factura cobrada no la tiene, vale su fecha (date), como hasta ahora.
--     Todo lo que es caja (este mes, meses pasados, cobrado y comisiones del
--     resumen) va por esta fecha; "Facturado" sigue por date.
--   · fin_stripe_webhook: guarda la fecha de la factura de Stripe en date y la
--     del pago en paid_date.
--
-- Mismas reglas que siempre (RLS de propietarios con aal2, firma verificada
-- en la base de datos, sin service_role). Ejecutar ANTES de publicar.
-- Es idempotente.
-- ============================================================================

begin;

alter table fin_invoices add column if not exists paid_date date;

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
  v_type text;
  v_obj jsonb;
  v_id text;
  v_customer text;
  v_email text;
  v_plink text;
  v_amount numeric;
  v_cur text;
  v_fx numeric;
  v_date date;      -- fecha de cobro (caja)
  v_inv_date date;  -- fecha de la factura
  v_num text;
  v_concept text;
  v_name text;
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
  v_type := v_event ->> 'type';
  v_obj := v_event -> 'data' -> 'object';

  if v_type = 'invoice.paid' then
    -- Suscripciones (también las creadas desde un Payment Link)
    v_id := v_obj ->> 'id';
    v_amount := coalesce((v_obj ->> 'amount_paid')::numeric, 0) / 100;
    v_customer := coalesce(v_obj ->> 'customer', '');
    v_email := coalesce(v_obj ->> 'customer_email', '');
    v_name := coalesce(v_obj ->> 'customer_name', '');
    v_plink := '';
    v_date := (to_timestamp(coalesce((v_obj -> 'status_transitions' ->> 'paid_at')::bigint, (v_obj ->> 'created')::bigint))
               at time zone 'Europe/Madrid')::date;
    v_inv_date := coalesce((to_timestamp((v_obj ->> 'created')::bigint) at time zone 'Europe/Madrid')::date, v_date);
    -- Serie S con el correlativo de Stripe ("XXXX-0004" → "S0004")
    v_num := coalesce(v_obj ->> 'number', '');
    v_num := 'S' || case when v_num ~ '-\d+$' then lpad(substring(v_num from '-(\d+)$'), 4, '0') else v_num end;
    v_concept := coalesce(nullif(v_obj -> 'lines' -> 'data' -> 0 ->> 'description', ''), 'Mensualidad (Stripe)');
  elsif v_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    -- Pagos únicos por Payment Link. Si hay factura o es suscripción, ya entra por invoice.paid.
    if v_obj ->> 'payment_status' is distinct from 'paid'
       or v_obj ->> 'mode' = 'subscription'
       or v_obj ->> 'invoice' is not null then
      return 'ignorado';
    end if;
    v_id := v_obj ->> 'id';
    v_amount := coalesce((v_obj ->> 'amount_total')::numeric, 0) / 100;
    v_customer := coalesce(v_obj ->> 'customer', '');
    v_email := coalesce(v_obj -> 'customer_details' ->> 'email', v_obj ->> 'customer_email', '');
    v_name := coalesce(v_obj -> 'customer_details' ->> 'name', '');
    v_plink := coalesce(v_obj ->> 'payment_link', '');
    v_date := (to_timestamp((v_obj ->> 'created')::bigint) at time zone 'Europe/Madrid')::date;
    v_inv_date := v_date;
    v_num := 'S-' || right(v_id, 8);
    v_concept := 'Mensualidad (enlace de pago Stripe)';
  else
    return 'ignorado';
  end if;

  if v_id is null or v_amount <= 0 then
    return 'ignorado';
  end if;
  if exists (select 1 from fin_invoices where stripe_invoice_id = v_id)
     or exists (select 1 from fin_stripe_pending where stripe_invoice_id = v_id) then
    return 'duplicado';
  end if;
  v_cur := lower(coalesce(v_obj ->> 'currency', 'eur'));

  -- Vincular: por Payment Link, si no por customer, si no por email
  select r.fin_project_id, p.name
    into v_rec
    from fin_recurrences r
    join fin_projects p on p.id = r.fin_project_id
   where r.status <> 'cancelada'
     and ((v_plink <> '' and r.stripe_payment_link = v_plink)
       or (v_customer <> '' and r.stripe_customer_id = v_customer)
       or (v_email <> '' and lower(r.stripe_email) = lower(v_email)))
   order by (v_plink <> '' and r.stripe_payment_link = v_plink) desc,
            (v_customer <> '' and r.stripe_customer_id = v_customer) desc,
            (r.status = 'activa') desc,
            r.slot
   limit 1;

  if not found then
    insert into fin_stripe_pending (stripe_invoice_id, customer_id, customer_name, number, concept, amount, currency, paid_date,
                                    payment_link, email)
    values (v_id, v_customer, coalesce(nullif(v_name, ''), v_email), v_num, v_concept, v_amount, v_cur, v_date, v_plink, v_email)
    on conflict (stripe_invoice_id) do nothing;
    return 'sin_vincular';
  end if;

  select fx_usd_eur into v_fx from fin_settings where id = 1;
  insert into fin_invoices (number, client, concept, date, paid_date, eur, usd, kind, status, fin_project_id, stripe_invoice_id)
  values (v_num, v_rec.name, v_concept, v_inv_date, v_date,
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
