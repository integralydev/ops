-- ============================================================================
-- Migración: color de cada persona
--   profiles.color: color del avatar elegido por la persona (o por un admin),
--   en formato #RRGGBB. Si está vacío, se usa el color automático de siempre.
-- Permisos: ya cubiertos por las políticas de profiles (cada uno edita su
-- fila; los admins, cualquiera).
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

begin;

alter table profiles add column if not exists color text
  constraint profiles_color_hex check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

commit;
