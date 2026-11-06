-- ============================================================================
-- Migración: ajustes del portal del cliente (tras la primera prueba, 6 nov)
--
--   1) "Tu equipo": salían todos los propietarios (también la cuenta de
--      Claudia). Ahora sale el responsable del proyecto + las personas
--      marcadas con profiles.portal_visible (Eloi).
--   2) Códigos de referidos: los acentos guardados como letra + tilde
--      separada daban "dpag-s". Ahora se quitan todos los acentos y se
--      regeneran los códigos (aún no se han compartido con nadie).
--
-- Ejecutar ANTES de publicar el código. Es idempotente.
-- ============================================================================

begin;

-- 1. Quién sale como "Dirección" en el portal
alter table profiles add column if not exists portal_visible boolean not null default false;
update profiles set portal_visible = true
where id in (select user_id from owners)
  and coalesce(full_name, '') not ilike 'claud%'
  and role = 'admin';

create or replace function portal_home(p_client uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid := portal_my_client();
  preview boolean := false;
begin
  if cid is null then
    if p_client is null or not is_staff() then
      return null;
    end if;
    cid := p_client;
    preview := true;
  end if;

  if not preview then
    update profiles set portal_last_seen_at = now() where id = auth.uid();
  end if;

  return jsonb_build_object(
    'preview', preview,
    'me', (select full_name from profiles where id = auth.uid()),
    'client', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'referral_code', c.referral_code, 'lang', c.portal_lang)
      from clients c where c.id = cid
    ),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'status', p.status,
        'next_step', nullif(trim(coalesce(p.client_next_step, '')), ''),
        'updated_at', p.updated_at,
        -- Equipo visible: responsable del proyecto + Dirección (portal_visible).
        -- Los developers no salen.
        'team', coalesce((
          select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'color', pr.color,
                   'lead', pr.id = p.owner_id) order by (pr.id = p.owner_id), pr.full_name)
          from profiles pr
          where pr.role in ('admin', 'director')
            and (pr.id = p.owner_id or pr.portal_visible)
        ), '[]'::jsonb),
        'files', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.filename, 'type', f.content_type,
                   'size', f.size_bytes, 'at', f.uploaded_at) order by f.uploaded_at desc)
          from files f where f.project_id = p.id and f.client_visible
        ), '[]'::jsonb)
      ) order by p.created_at)
      from projects p
      where p.client_id = cid and p.kind = 'cliente' and portal_visible_status(p.status)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function portal_home(uuid) from public, anon;
grant execute on function portal_home(uuid) to authenticated;

-- 2. Códigos sin acentos (NFD separa la letra del acento; se borra el acento)
create or replace function portal_slug(t text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(normalize(lower(replace(coalesce(t, ''), '·', '')), NFD), '[\u0300-\u036f]', '', 'g'),
    '[^a-z0-9]+', '-', 'g'));
$$;

alter table clients disable trigger trg_clients_referral_code;
update clients set referral_code = null;
alter table clients enable trigger trg_clients_referral_code;
do $$
declare r record;
begin
  for r in select id, name from clients order by created_at loop
    update clients set referral_code = portal_new_referral_code(r.name, r.id) where id = r.id;
  end loop;
end $$;

commit;
