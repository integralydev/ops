-- ============================================================================
-- Migración: accesos externos de cada proyecto
--   Qué personas externas tienen acceso a qué sistema de un proyecto (GCP,
--   GitHub, Vercel, WooCommerce…), con qué nivel, quién se lo dio y si ya se
--   ha revocado. Para poder quitarlo todo al acabar sin buscar en correos.
--
--   · Nunca credenciales: solo que el acceso existe. La base de datos rechaza
--     textos con forma de clave, token o contraseña.
--   · Solo admin y director (is_staff). Ni developers ni comercial: es el mapa
--     de la superficie expuesta. Por eso tampoco va al registro de actividad.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

-- ¿Parece una credencial? (tokens conocidos, claves privadas, JWT, "password: …")
create or replace function looks_like_secret(t text)
returns boolean
language sql
immutable
as $$
  select coalesce(t, '') ~ '(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})'
      or coalesce(t, '') ~* '(password|passwd|contrase(ñ|n)a|pwd)\s*[:=]'
      or coalesce(t, '') ~* '(api[ _-]?key|token|secret|clave)\s*[:=]\s*[A-Za-z0-9_\-]{12,}';
$$;

create table if not exists project_accesses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  person text not null check (length(trim(person)) > 0),
  company text not null default '',
  system text not null check (length(trim(system)) > 0),
  level text not null check (level in ('lectura', 'escritura', 'admin', 'propietario')),
  granted_by uuid references profiles (id) on delete set null,
  granted_at date not null default current_date,
  revoked_at date,
  revoked_by uuid references profiles (id) on delete set null,
  -- p. ej. "GCP → IAM → quitar principal"
  revoke_how text not null default '',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint project_accesses_no_secrets check (
    not looks_like_secret(person) and not looks_like_secret(company)
    and not looks_like_secret(system) and not looks_like_secret(revoke_how)
  )
);
create index if not exists project_accesses_project_idx on project_accesses (project_id);

alter table project_accesses enable row level security;
drop policy if exists "accesses_select_staff" on project_accesses;
drop policy if exists "accesses_insert_staff" on project_accesses;
drop policy if exists "accesses_update_staff" on project_accesses;
drop policy if exists "accesses_delete_staff" on project_accesses;
create policy "accesses_select_staff" on project_accesses for select to authenticated using (is_staff());
create policy "accesses_insert_staff" on project_accesses for insert to authenticated with check (is_staff());
create policy "accesses_update_staff" on project_accesses for update to authenticated using (is_staff()) with check (is_staff());
create policy "accesses_delete_staff" on project_accesses for delete to authenticated using (is_staff());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_accesses') then
    alter publication supabase_realtime add table project_accesses;
  end if;
end $$;

commit;
