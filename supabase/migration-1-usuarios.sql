-- ============================================================================
-- Alaba Tool · migración 1: nombres de usuario en lugar de correos
--
-- Solo para bases donde ya se ejecutó la primera versión de schema.sql
-- (alaba_miembros con columna "email"). En una instalación nueva no hace falta:
-- schema.sql ya trae la versión final. Es idempotente.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'alaba_miembros' and column_name = 'email'
  ) then
    alter table public.alaba_miembros rename column email to usuario;
  end if;
end;
$$;

alter table public.alaba_miembros drop constraint if exists alaba_miembros_usuario_formato;
alter table public.alaba_miembros
  add constraint alaba_miembros_usuario_formato check (usuario ~ '^[a-z0-9._-]{3,30}$');

alter table public.alaba_miembros drop constraint if exists alaba_miembros_usuario_key;
alter table public.alaba_miembros
  add constraint alaba_miembros_usuario_key unique (usuario);

comment on function public.alaba_usuario_por_email(text) is
  'Busca una cuenta de Auth por correo interno (<usuario>@alaba.invalid). Solo service_role.';
