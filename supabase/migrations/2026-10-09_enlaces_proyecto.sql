-- ============================================================================
-- Migración: enlaces importantes de cada proyecto
--   · Tabla project_links: app en producción, consola cloud, repositorio,
--     Excels de seguimiento… agrupados por categoría. Uno puede ir destacado
--     (es el botón rápido del proyecto).
--   · SOLO enlaces, nunca credenciales: la base de datos rechaza URLs con
--     usuario:contraseña@ o con parámetros de clave/token/firma.
--   · Visibles solo para miembros del proyecto (is_project_member ya excluye
--     al rol comercial). Cualquier miembro añade y edita; borra quien lo
--     añadió o admin/director.
--   · Absorbe projects.demo_url: cada demo pasa a ser un enlace "Demo"
--     (producción, destacado) y la columna se elimina.
--
-- Ejecutar DESPUÉS de que esté publicada la versión de la app que ya no usa
-- demo_url. Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

create table if not exists project_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  url text not null,
  category text not null check (category in ('produccion', 'infraestructura', 'repositorio', 'documentos', 'cliente')),
  featured boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_links_url_http check (url ~* '^https?://\S+$'),
  -- nada de https://usuario:contraseña@…
  constraint project_links_no_userinfo check (url !~* '^[a-z]+://[^/?#]*@'),
  -- nada de claves, tokens ni firmas en la URL
  constraint project_links_no_secrets check (
    url !~* '[?&#](token|access_token|refresh_token|id_token|key|api_key|apikey|api-key|secret|client_secret|password|passwd|pwd|pass|auth|sig|signature|x-amz-signature|x-amz-credential|x-goog-signature|x-goog-credential)='
  )
);
create index if not exists project_links_project_idx on project_links (project_id);
-- Como mucho un enlace destacado por proyecto
create unique index if not exists project_links_one_featured on project_links (project_id) where featured;

create or replace function trg_project_links_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_project_links_touch on project_links;
create trigger trg_project_links_touch
  before update on project_links
  for each row execute function trg_project_links_touch();

-- Actividad: "ha añadido el enlace X" (sin la URL)
create or replace function trg_activity_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform log_activity(new.project_id, 'link_added', jsonb_build_object('label', new.label, 'category', new.category));
  return new;
end;
$$;
revoke execute on function trg_activity_links() from public, authenticated, anon;

drop trigger if exists trg_activity_links on project_links;
create trigger trg_activity_links
  after insert on project_links
  for each row execute function trg_activity_links();

-- Permisos
alter table project_links enable row level security;
drop policy if exists "links_select_member" on project_links;
drop policy if exists "links_insert_member" on project_links;
drop policy if exists "links_update_member" on project_links;
drop policy if exists "links_delete_owner" on project_links;
create policy "links_select_member" on project_links for select to authenticated
  using (is_project_member(project_id));
create policy "links_insert_member" on project_links for insert to authenticated
  with check (is_project_member(project_id) and created_by = auth.uid());
create policy "links_update_member" on project_links for update to authenticated
  using (is_project_member(project_id)) with check (is_project_member(project_id));
create policy "links_delete_owner" on project_links for delete to authenticated
  using (is_project_member(project_id) and (is_staff() or created_by = auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_links') then
    alter publication supabase_realtime add table project_links;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Absorber projects.demo_url
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'projects' and column_name = 'demo_url') then
    -- Sin trigger de actividad: no es un enlace "nuevo", ya existía
    alter table project_links disable trigger trg_activity_links;
    insert into project_links (project_id, label, url, category, featured, created_by)
    select p.id, 'Demo', trim(p.demo_url), 'produccion',
           not exists (select 1 from project_links l where l.project_id = p.id and l.featured),
           p.created_by
    from projects p
    where coalesce(trim(p.demo_url), '') <> ''
      and not exists (select 1 from project_links l where l.project_id = p.id and l.url = trim(p.demo_url));
    alter table project_links enable trigger trg_activity_links;

    -- Red de seguridad: no se borra la columna si alguna demo no se ha copiado
    if exists (
      select 1 from projects p
      where coalesce(trim(p.demo_url), '') <> ''
        and not exists (select 1 from project_links l where l.project_id = p.id and l.url = trim(p.demo_url))
    ) then
      raise exception 'Hay demos que no se han podido copiar a enlaces; no se borra demo_url';
    end if;
  end if;
end $$;

-- El registro de actividad de proyectos dejaba de compilar sin demo_url
create or replace function trg_activity_projects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dev uuid;
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.id, 'project_created', jsonb_build_object('status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    perform log_activity(new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.owner_id is distinct from old.owner_id then
    perform log_activity(new.id, 'owner_changed', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if new.developer_ids is distinct from old.developer_ids then
    foreach dev in array coalesce(new.developer_ids, '{}') loop
      if not (dev = any(coalesce(old.developer_ids, '{}'))) then
        perform log_activity(new.id, 'developer_added', jsonb_build_object('user_id', dev));
      end if;
    end loop;
  end if;
  if new.notes_doc is distinct from old.notes_doc then
    perform log_activity(new.id, 'notes_edited', '{}');
  end if;
  if coalesce(new.next_step, '') <> '' and new.next_step is distinct from old.next_step then
    perform log_activity(new.id, 'next_step', jsonb_build_object('text', left(new.next_step, 200)));
  end if;
  return new;
end;
$$;

alter table projects drop column if exists demo_url;

commit;
