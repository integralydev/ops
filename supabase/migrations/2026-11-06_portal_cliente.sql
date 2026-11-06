-- ============================================================================
-- Migración: portal del cliente (vista del cliente, v1)
--
-- El portal es UNA sola app dentro del OPS (/portal). No se crea nada por
-- proyecto: cada cliente entra con su usuario y ve lo suyo, que sale solo de
-- lo que ya hay en el OPS (fase, siguiente paso para el cliente, equipo,
-- documentos marcados como visibles y su enlace de referidos).
--
-- Disparador (Eloi, 6 nov 2026): cuando un proyecto llega a "propuesta" (o ya
-- está más adelante) y su cliente aún no tiene acceso, el OPS le propone al
-- admin invitar a la persona de contacto. Un clic de confirmación → email con
-- enlace de acceso (sin contraseña). Los clientes de Ana no tienen portal.
--
-- SEGURIDAD (primera vez que entra gente de fuera):
--   · Rol nuevo 'cliente', ligado a profiles.client_id. NUNCA es miembro de
--     un proyecto: todas las políticas existentes (is_team, is_staff,
--     is_project_member, has_sales_access, can_see_finance, is_owner) ya lo
--     dejan fuera.
--   · El cliente no lee ninguna tabla directamente: todo lo que ve sale de la
--     función portal_home(), que devuelve solo campos pensados para él.
--   · Se tapan tres huecos que había:
--       1) profiles_select using (true): cualquiera autenticado veía a todo
--          el equipo. Ahora: el equipo ve al equipo, el admin también a las
--          personas de los clientes, y cada uno se ve a sí mismo.
--       2) Las cuentas nuevas nacían con rol 'developer'. Ahora nacen como
--          'cliente' sin empresa = no ven nada hasta que un admin les asigna
--          rol. Las invitaciones del equipo ya ponen el rol justo después.
--       3) Un usuario podía cambiar su propia fila: ahora client_id solo lo
--          cambia un admin (igual que el rol).
--
-- Ejecutar ANTES de publicar el código. Es idempotente.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Rol 'cliente' y su empresa
-- ---------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'director', 'developer', 'comercial', 'cliente'));

alter table profiles add column if not exists client_id uuid references clients (id) on delete set null;
-- Última vez que abrió su portal (para saber con quién tirar de correo/WhatsApp)
alter table profiles add column if not exists portal_last_seen_at timestamptz;
create index if not exists profiles_client_id_idx on profiles (client_id);

-- Las cuentas nuevas nacen sin permisos
alter table profiles alter column role set default 'cliente';

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sin empresa ni rol de equipo: no ve nada hasta que un admin le dé acceso
  insert into profiles (id, role) values (new.id, 'cliente')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Rol y empresa solo los cambia un admin
create or replace function validate_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.client_id is distinct from old.client_id then
    if not is_admin() then
      raise exception 'Solo un administrador puede cambiar roles';
    end if;
    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from profiles where role = 'admin') <= 1 then
      raise exception 'No puedes quitar al único administrador';
    end if;
  end if;
  return new;
end;
$$;

-- Personas de Integraly (todo lo que no es cliente)
create or replace function is_internal()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'director', 'developer', 'comercial')
  );
$$;
grant execute on function is_internal() to authenticated;

-- Hueco 1: perfiles
drop policy if exists "profiles_select" on profiles;
-- El admin también ve a las personas de los clientes (las invita él; la app
-- del equipo las filtra para que no salgan como equipo).
create policy "profiles_select" on profiles for select to authenticated
  using ((is_internal() and role <> 'cliente') or is_admin() or id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Datos del portal en clientes, proyectos y archivos
-- ---------------------------------------------------------------------------
-- Código de referidos: va en el enlace (integralyaisolutions.com/contacto/?ref=…)
alter table clients add column if not exists referral_code text;
-- Idioma del portal de este cliente
alter table clients add column if not exists portal_lang text not null default 'es';
alter table clients drop constraint if exists clients_portal_lang_check;
alter table clients add constraint clients_portal_lang_check check (portal_lang in ('es', 'ca'));
-- Sin portal (clientes que entran por Ana: los atiende App Informàtica Gavà)
alter table clients add column if not exists portal_off boolean not null default false;

create or replace function portal_slug(t text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(t, '')),
      'áàäâãéèëêíìïîóòöôõúùüûñçl·',
      'aaaaaeeeeiiiiooooouuuuncl'),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- Código único a partir del nombre (quitando S.L., S.A., etc.)
create or replace function portal_new_referral_code(cname text, cid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := left(portal_slug(regexp_replace(coalesce(cname, ''), '\m(s\.?l\.?u?|s\.?a\.?|s\.?c\.?p\.?|sccl|llc)\M\.?', '', 'gi')), 30);
  code text;
  n int := 1;
begin
  if base = '' then base := 'cliente'; end if;
  code := base;
  while exists (select 1 from clients where referral_code = code and id <> cid) loop
    n := n + 1;
    code := base || '-' || n;
  end loop;
  return code;
end;
$$;

create or replace function trg_clients_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.referral_code is null or new.referral_code = '' then
    new.referral_code := portal_new_referral_code(new.name, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_referral_code on clients;
create trigger trg_clients_referral_code
  before insert or update on clients
  for each row execute function trg_clients_referral_code();

-- Rellena los clientes que ya existen (uno a uno, para no repetir códigos)
do $$
declare r record;
begin
  for r in select id, name from clients where referral_code is null or referral_code = '' order by created_at loop
    update clients set referral_code = portal_new_referral_code(r.name, r.id) where id = r.id;
  end loop;
end $$;

create unique index if not exists clients_referral_code_key on clients (referral_code);

-- Clientes que entran por Ana: sin portal. Revisar en el SQL Editor después
-- (select name, portal_off from clients order by name) y corregir a mano.
update clients set portal_off = true
where portal_off = false
  and (name ilike '%arqteria%' or name ilike '%pineda%' or name ilike '%am reformas%');

-- Siguiente paso PARA EL CLIENTE (el next_step de siempre es interno)
alter table projects add column if not exists client_next_step text;
-- "Ahora no" en el aviso de invitar al portal
alter table projects add column if not exists portal_prompt_dismissed boolean not null default false;

-- Documentos que ve el cliente (por defecto, ninguno)
alter table files add column if not exists client_visible boolean not null default false;

-- El equipo (admin y director) marca o desmarca "visible para el cliente"
drop policy if exists "files_update_staff" on files;
create policy "files_update_staff" on files for update to authenticated
  using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- 3. Lo que ve el cliente: una sola función, solo campos pensados para él
-- ---------------------------------------------------------------------------
-- Fases en las que el cliente ve el proyecto
create or replace function portal_visible_status(s text)
returns boolean
language sql
immutable
as $$
  select s in ('propuesta', 'presupuesto', 'desarrollo', 'testing', 'mantenimiento');
$$;

-- Empresa del usuario que llama, si es cliente
create or replace function portal_my_client()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select client_id from profiles where id = auth.uid() and role = 'cliente';
$$;
grant execute on function portal_my_client() to authenticated;

-- p_client: solo para que admin/director vean el portal "como el cliente".
-- Un cliente siempre ve el suyo (se ignora p_client).
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
        -- Equipo visible: dirección (Eloi) y responsable del proyecto. Los
        -- developers no salen.
        'team', coalesce((
          select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'color', pr.color,
                   'lead', pr.id = p.owner_id) order by (pr.id = p.owner_id), pr.full_name)
          from profiles pr
          where pr.role in ('admin', 'director')
            and (pr.id = p.owner_id or pr.id in (select user_id from owners))
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

-- Ruta del archivo para descargarlo, solo si es visible para quien llama.
-- La URL firmada la genera el servidor después de esta comprobación.
create or replace function portal_file_path(fid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select f.storage_path
  from files f join projects p on p.id = f.project_id
  where f.id = fid and f.client_visible and p.kind = 'cliente'
    and portal_visible_status(p.status)
    and (p.client_id = portal_my_client() or is_staff());
$$;
revoke all on function portal_file_path(uuid) from public, anon;
grant execute on function portal_file_path(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lo que ve el equipo (solo admin): quién tiene acceso y a quién invitar
-- ---------------------------------------------------------------------------
create or replace function portal_users(cid uuid)
returns table (id uuid, full_name text, email text, last_seen timestamptz, invited_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select pr.id, pr.full_name, u.email::text, pr.portal_last_seen_at, pr.created_at
  from profiles pr join auth.users u on u.id = pr.id
  where is_admin() and pr.role = 'cliente' and pr.client_id = cid
  order by pr.created_at;
$$;
revoke all on function portal_users(uuid) from public, anon;
grant execute on function portal_users(uuid) to authenticated;

-- Proyectos cuyo cliente aún no tiene acceso al portal (aviso con un clic)
create or replace function portal_pending_invites()
returns table (project_id uuid, project_name text, client_id uuid, client_name text, status text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.name, c.id, c.name, p.status
  from projects p join clients c on c.id = p.client_id
  where is_admin()
    and p.kind = 'cliente'
    and portal_visible_status(p.status)
    and not c.portal_off
    and not p.portal_prompt_dismissed
    and not exists (select 1 from profiles pr where pr.role = 'cliente' and pr.client_id = c.id)
  order by p.updated_at desc;
$$;
revoke all on function portal_pending_invites() from public, anon;
grant execute on function portal_pending_invites() to authenticated;

commit;
