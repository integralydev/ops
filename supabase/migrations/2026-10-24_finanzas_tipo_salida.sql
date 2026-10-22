-- ============================================================================
-- Migración: finanzas · tipo de salida en los programados
--   · fin_scheduled.kind (dev | comision | comercial | gasto_fijo | infra | otro)
--     para agrupar las salidas en "Próximos 60 días".
--   · fin_payments_out.kind admite también 'infra'.
--   · Relleno: los programados sin tipo toman el del último pago hecho que
--     los saldó (si lo hay); el resto queda en 'otro'.
--
-- Mismas reglas que siempre: tablas fin_* con RLS solo is_owner() + aal2,
-- fuera de Realtime, sin triggers de actividad ni correos.
-- Ejecutar ANTES de publicar la versión que lo usa. Es idempotente.
-- ============================================================================

begin;

alter table fin_scheduled add column if not exists kind text not null default 'otro';
alter table fin_scheduled drop constraint if exists fin_scheduled_kind;
alter table fin_scheduled add constraint fin_scheduled_kind
  check (kind in ('dev', 'comision', 'comercial', 'gasto_fijo', 'infra', 'otro'));

alter table fin_payments_out drop constraint if exists fin_payments_out_kind_check;
alter table fin_payments_out add constraint fin_payments_out_kind_check
  check (kind in ('dev', 'comision', 'comercial', 'gasto_fijo', 'infra', 'otro'));

update fin_scheduled s
   set kind = p.kind
  from (
    select distinct on (scheduled_id) scheduled_id, kind
      from fin_payments_out
     where scheduled_id is not null and kind <> 'otro'
     order by scheduled_id, date desc
  ) p
 where p.scheduled_id = s.id and s.kind = 'otro';

commit;
