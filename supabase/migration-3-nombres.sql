-- ============================================================================
-- Alaba Tool · migración 3: nombre para mostrar
--
-- El usuario para entrar sigue siendo en minúsculas ("ricardo"); el nombre
-- para mostrar es libre ("Ricardo", "Ricardo Juárez") y es el que se ve en la
-- app (En vivo, Mi cuenta, Usuarios). Ejecutar en Supabase → SQL Editor.
-- Idempotente.
-- ============================================================================

alter table public.alaba_miembros add column if not exists nombre text;

-- A los que ya existen: su usuario con mayúscula inicial (ricardo → Ricardo)
update public.alaba_miembros
set nombre = initcap(replace(replace(usuario, '.', ' '), '_', ' '))
where nombre is null or btrim(nombre) = '';

alter table public.alaba_miembros alter column nombre set not null;

alter table public.alaba_miembros drop constraint if exists alaba_miembros_nombre_largo;
alter table public.alaba_miembros
  add constraint alaba_miembros_nombre_largo check (char_length(btrim(nombre)) between 1 and 60);

-- El admin puede cambiar el nombre de los demás (misma política que el rol)
grant update (nombre) on public.alaba_miembros to authenticated;

-- Cada quien puede cambiar SU nombre. Es una función (y no una política de
-- UPDATE sobre su propia fila) para que nadie pueda cambiarse el rol a sí mismo.
create or replace function public.alaba_cambiar_mi_nombre(p_nombre text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  limpio text := btrim(coalesce(p_nombre, ''));
begin
  if char_length(limpio) not between 1 and 60 then
    raise exception 'El nombre debe tener entre 1 y 60 caracteres';
  end if;
  update public.alaba_miembros set nombre = limpio where user_id = auth.uid();
  if not found then
    raise exception 'No tienes acceso a Alaba Tool';
  end if;
  return limpio;
end;
$$;

revoke all on function public.alaba_cambiar_mi_nombre(text) from public, anon;
grant execute on function public.alaba_cambiar_mi_nombre(text) to authenticated;
