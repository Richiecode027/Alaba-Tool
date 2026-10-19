-- ============================================================================
-- Alaba Tool · esquema en Supabase
--
-- Convive con otras aplicaciones en el mismo proyecto de Supabase (PSI, Arcade,
-- Nupcia): todo lo de Alaba Tool lleva el prefijo alaba_. Los usuarios de Auth
-- son comunes a todo el proyecto, así que solo pueden entrar las cuentas dadas
-- de alta en alaba_miembros, cada una con un rol:
--
--   lector  → ver, buscar, transponer, imprimir y armar su set list
--   editor  → lo anterior + crear, editar y eliminar canciones
--   admin   → lo anterior + módulo de Usuarios (altas, roles, quitar acceso)
--
-- Se entra con nombre de usuario, no con correo. Como Supabase Auth exige un
-- correo, cada usuario se guarda en Auth como <usuario>@alaba.invalid (".invalid"
-- es un dominio reservado que no existe: nunca se envía nada). Ese dominio
-- además separa estas cuentas de las de las otras apps del proyecto.
--
-- Ejecutar en Supabase → SQL Editor → New query → Run. Es idempotente: se puede
-- volver a correr sin perder datos.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Miembros y roles
-- Las altas las hace un admin desde la app (función de Netlify con la
-- service_role key); el navegador nunca puede insertarse a sí mismo.
-- --------------------------------------------------------------------------
create table if not exists public.alaba_miembros (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  usuario    text        not null
             constraint alaba_miembros_usuario_key unique
             constraint alaba_miembros_usuario_formato check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  rol        text        not null check (rol in ('lector', 'editor', 'admin')),
  creado_en  timestamptz not null default now()
);

alter table public.alaba_miembros enable row level security;

-- Rol de quien hace la petición (null si no es miembro de Alaba Tool).
-- security definer: así las políticas pueden consultar alaba_miembros sin
-- quedar en recursión con las políticas de la propia tabla.
create or replace function public.alaba_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.alaba_miembros where user_id = auth.uid();
$$;

revoke all on function public.alaba_rol() from public, anon;
grant execute on function public.alaba_rol() to authenticated;

drop policy if exists "alaba_miembros_select" on public.alaba_miembros;
drop policy if exists "alaba_miembros_update" on public.alaba_miembros;
drop policy if exists "alaba_miembros_delete" on public.alaba_miembros;

-- Cada quien ve su propia fila; el admin ve todas.
create policy "alaba_miembros_select" on public.alaba_miembros
  for select to authenticated
  using (user_id = auth.uid() or public.alaba_rol() = 'admin');

-- El admin cambia roles y quita accesos, pero nunca los suyos
-- (evita que el último admin se quede fuera por accidente).
create policy "alaba_miembros_update" on public.alaba_miembros
  for update to authenticated
  using (public.alaba_rol() = 'admin' and user_id <> auth.uid())
  with check (public.alaba_rol() = 'admin' and user_id <> auth.uid());

create policy "alaba_miembros_delete" on public.alaba_miembros
  for delete to authenticated
  using (public.alaba_rol() = 'admin' and user_id <> auth.uid());

revoke all on public.alaba_miembros from anon, authenticated;
grant select, delete on public.alaba_miembros to authenticated;
grant update (rol) on public.alaba_miembros to authenticated;

-- Busca una cuenta de Auth por correo interno (<usuario>@alaba.invalid).
-- Solo la usa la función de Netlify (service_role): si el usuario ya existe,
-- en vez de crearlo de nuevo se le restablece la contraseña y el rol.
create or replace function public.alaba_usuario_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.alaba_usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.alaba_usuario_por_email(text) to service_role;

-- --------------------------------------------------------------------------
-- Canciones
-- --------------------------------------------------------------------------
create table if not exists public.alaba_canciones (
  id                  bigint      generated always as identity primary key,
  titulo              text        not null check (char_length(titulo) between 1 and 255),
  autor               text        check (autor is null or char_length(autor) <= 255),
  genero              text        not null check (genero in ('Himno', 'Canto')),
  tono_original       text        not null check (char_length(tono_original) between 1 and 10),
  contenido           text        not null,
  creado_por          uuid        default auth.uid() references auth.users (id) on delete set null,
  fecha_creacion      timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

create or replace function public.alaba_tocar_actualizacion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.fecha_actualizacion := now();
  return new;
end;
$$;

drop trigger if exists alaba_canciones_actualizacion on public.alaba_canciones;
create trigger alaba_canciones_actualizacion
  before update on public.alaba_canciones
  for each row execute function public.alaba_tocar_actualizacion();

alter table public.alaba_canciones enable row level security;

drop policy if exists "alaba_canciones_select" on public.alaba_canciones;
drop policy if exists "alaba_canciones_insert" on public.alaba_canciones;
drop policy if exists "alaba_canciones_update" on public.alaba_canciones;
drop policy if exists "alaba_canciones_delete" on public.alaba_canciones;

-- Leer: cualquier miembro (lector, editor o admin).
create policy "alaba_canciones_select" on public.alaba_canciones
  for select to authenticated
  using (public.alaba_rol() is not null);

-- Crear / editar / eliminar: solo editor o admin.
create policy "alaba_canciones_insert" on public.alaba_canciones
  for insert to authenticated
  with check (public.alaba_rol() in ('editor', 'admin') and creado_por = auth.uid());

create policy "alaba_canciones_update" on public.alaba_canciones
  for update to authenticated
  using (public.alaba_rol() in ('editor', 'admin'))
  with check (public.alaba_rol() in ('editor', 'admin'));

create policy "alaba_canciones_delete" on public.alaba_canciones
  for delete to authenticated
  using (public.alaba_rol() in ('editor', 'admin'));

revoke all on public.alaba_canciones from anon, authenticated;
grant select, delete on public.alaba_canciones to authenticated;
grant insert (titulo, autor, genero, tono_original, contenido) on public.alaba_canciones to authenticated;
grant update (titulo, autor, genero, tono_original, contenido) on public.alaba_canciones to authenticated;

-- ============================================================================
-- PRIMER ADMINISTRADOR (una sola vez)
--
-- 1. Supabase → Authentication → Users → Add user → Create new user:
--      Email:    tuusuario@alaba.invalid   (usuario: 3-30 de a-z 0-9 . _ -)
--      Password: la que quieras (mínimo 8)
--      Marca "Auto Confirm User".
-- 2. Ejecuta también migration-2-en-vivo.sql y migration-3-nombres.sql.
-- 3. Cambia "tuusuario" y ejecuta:
--
--   insert into public.alaba_miembros (user_id, usuario, rol, nombre)
--   select id, split_part(email, '@', 1), 'admin', initcap(split_part(email, '@', 1))
--   from auth.users where email = 'tuusuario@alaba.invalid'
--   on conflict (user_id) do update set rol = 'admin';
--
-- A partir de ahí, las demás cuentas se dan de alta desde la app (módulo Usuarios).
-- ============================================================================
