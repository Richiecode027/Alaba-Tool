# Alaba Tool - Gestor de Cifrados Musicales

Aplicación web para gestionar, visualizar y transponer cifrados musicales (chord charts), con acceso por usuario y roles.

## Arquitectura

```
Netlify (sitio estático, sin build)
├── public/                         HTML + JS vanilla + Tailwind (CDN)
│   ├── config.js                   URL y anon key públicas de Supabase
│   ├── app.js                      canciones, set list, auto-scroll, sesión y roles
│   ├── admin.js                    módulo Usuarios (solo Administrador)
│   └── transposer.js               motor de transposición (corre en el navegador)
└── netlify/functions/
    └── admin-usuarios.mjs          alta de cuentas (única pieza con la service_role key)
          │
          ▼
Supabase (proyecto compartido con PSI, Arcade y Nupcia)
├── public.alaba_miembros           quién puede entrar y con qué rol
└── public.alaba_canciones          canciones
```

- El navegador habla directo con Supabase. **La seguridad la imponen las políticas RLS** de [supabase/schema.sql](supabase/schema.sql), no el JavaScript del frontend.
- Todo lo de esta app lleva el prefijo `alaba_` para convivir con las demás apps del proyecto.
- Se entra con **nombre de usuario** (sin correo). Como Supabase Auth exige un correo, cada usuario se guarda internamente como `usuario@alaba.invalid`. `.invalid` es un dominio reservado que no existe, así que nunca se envía nada. Ese dominio también separa estas cuentas de las de las otras apps del proyecto.
- Solo entra a Alaba Tool quien esté dado de alta en `alaba_miembros`.

## Roles

| | Lector | Editor | Administrador |
|---|:-:|:-:|:-:|
| Ver, buscar, transponer, imprimir, set list, auto-scroll | ✅ | ✅ | ✅ |
| Crear, editar y eliminar canciones | ❌ | ✅ | ✅ |
| Módulo **Usuarios**: dar de alta, cambiar rol, quitar acceso | ❌ | ❌ | ✅ |

- No hay registro público: los usuarios los da de alta un Administrador, con una contraseña temporal.
- Usuarios válidos: de 3 a 30 caracteres, con minúsculas, números, `.`, `_` y `-`. Se guardan en minúsculas.
- **¿Alguien olvidó su contraseña?** El Administrador lo vuelve a dar de alta con una contraseña nueva; se le restablece.
- "Quitar acceso" solo le impide entrar; se le puede volver a dar de alta cuando quieras.
- Un Administrador no puede cambiar ni quitar su propio rol (así no te quedas fuera por accidente).
- Cada usuario puede cambiar su contraseña en **Mi cuenta**.

## Puesta en marcha (una sola vez)

### 1. Base de datos

En Supabase → **SQL Editor** → New query, pega el contenido de [supabase/schema.sql](supabase/schema.sql) y ejecútalo. Es idempotente.

> Si ya habías ejecutado la primera versión de `schema.sql` (la de correos), ejecuta también [supabase/migration-1-usuarios.sql](supabase/migration-1-usuarios.sql).

### 2. Primer Administrador

1. En Supabase → **Authentication → Users → Add user → Create new user**:
   - Email: `tuusuario@alaba.invalid`. `tuusuario` será tu nombre de usuario para entrar.
   - Password: la que quieras (mínimo 8 caracteres).
   - Marca **Auto Confirm User**.
2. En el SQL Editor, cambia `tuusuario` y ejecuta:

```sql
insert into public.alaba_miembros (user_id, usuario, rol)
select id, split_part(email, '@', 1), 'admin'
from auth.users where email = 'tuusuario@alaba.invalid'
on conflict (user_id) do update set rol = 'admin';
```

A partir de ahí, los demás usuarios se dan de alta desde la app, en el módulo **Usuarios**.

### 3. Netlify

1. **Add new site → Import an existing project → GitHub →** `Richiecode027/Alaba-Tool`. La configuración de build se lee de [netlify.toml](netlify.toml), no hay que tocar nada.
2. En **Site configuration → Environment variables**, agrega:
   - `SUPABASE_URL` = `https://pbjthkfiuapwnmwhlrxp.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = la clave *service_role* (Supabase → Project Settings → API Keys). Marca la opción **Secret**.
3. Redespliega para que la función tome las variables.

> ⚠️ La `service_role` key da acceso total a **todo** el proyecto compartido. Solo va en las variables de Netlify, nunca en el repo ni en `public/`.

## Desarrollo local

```bash
npm install
```

```bash
npm test
```

Para probar todo, incluida la función de alta, usa [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`npm i -g netlify-cli`), copia `.env.example` a `.env`, rellena la service_role key y ejecuta:

```bash
npm run dev
```

## Formato de las canciones

Los acordes van entre corchetes dentro de la letra:

```
[G]Te loamos oh [D]Dios,
[Em]Por tu amor sin [A]fin
```

El transpositor soporta:
- Sostenidos y bemoles (`F#`, `Bb`, …), con salida normalizada a sostenidos.
- Cualquier sufijo, que se conserva intacto: `m`, `7`, `maj7`, `sus4`, `dim`, `add9`, `6/9`, …
- Slash chords, transponiendo también el bajo: `G/B` → `A/C#`.
- Tonos menores o con bemol como tono original (`Em`, `Bb`).

## Licencia

MIT
