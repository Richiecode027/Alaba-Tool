# Alaba Tool - Gestor de Cifrados Musicales

Aplicación web para gestionar, visualizar y transponer cifrados musicales (chord charts), con acceso por usuario y roles.

## Arquitectura

```
Netlify (sitio estático, sin build)
├── public/                         HTML + JS vanilla + Tailwind (CDN)
│   ├── config.js                   URL y anon key públicas de Supabase
│   ├── app.js                      canciones, set list, auto-scroll, sesión y roles
│   ├── admin.js                    módulo Usuarios (solo Administrador)
│   ├── envivo.js                   modo En vivo: los músicos siguen al líder (Supabase Realtime)
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
| Seguir al líder en **En vivo** | ✅ | ✅ | ✅ |
| **Dirigir en vivo** | ❌ | ✅ | ✅ |
| Crear, editar y eliminar canciones | ❌ | ✅ | ✅ |
| Módulo **Usuarios**: dar de alta, cambiar rol, quitar acceso | ❌ | ❌ | ✅ |

- No hay registro público: los usuarios los da de alta un Administrador, con una contraseña temporal.
- Usuarios válidos: de 3 a 30 caracteres, con minúsculas, números, `.`, `_` y `-`. Se guardan en minúsculas.
- **Nombre para mostrar:** cada usuario tiene uno ("Ricardo", "Juan Pérez"), que es el que se ve en la app. El usuario para entrar sigue en minúsculas y da igual cómo se escriba al iniciar sesión.
- **¿Alguien olvidó su contraseña?** En **Usuarios**, el Administrador pulsa **Contraseña** en su fila y le pone una nueva.
- "Quitar acceso" solo le impide entrar; se le puede volver a dar de alta cuando quieras.
- Un Administrador no puede cambiar ni quitar su propio rol (así no te quedas fuera por accidente).
- Cada usuario puede cambiar su nombre y su contraseña en **Mi cuenta**. Las contraseñas van de 8 a 72 caracteres (el máximo lo pone Supabase).

## Puesta en marcha (una sola vez)

### 1. Base de datos

En Supabase → **SQL Editor** → New query, pega el contenido de [supabase/schema.sql](supabase/schema.sql) y ejecútalo. Es idempotente.

> Si ya habías ejecutado la primera versión de `schema.sql` (la de correos), ejecuta también [supabase/migration-1-usuarios.sql](supabase/migration-1-usuarios.sql).

Para el modo **En vivo**, ejecuta además [supabase/migration-2-en-vivo.sql](supabase/migration-2-en-vivo.sql). Crea las políticas del canal privado de Realtime: escucha cualquier miembro y transmiten solo editores y administradores.

Después ejecuta [supabase/migration-3-nombres.sql](supabase/migration-3-nombres.sql), que agrega el nombre para mostrar.

### 2. Primer Administrador

1. En Supabase → **Authentication → Users → Add user → Create new user**:
   - Email: `tuusuario@alaba.invalid`. `tuusuario` será tu nombre de usuario para entrar.
   - Password: la que quieras (mínimo 8 caracteres).
   - Marca **Auto Confirm User**.
2. En el SQL Editor, cambia `tuusuario` y ejecuta:

```sql
insert into public.alaba_miembros (user_id, usuario, rol, nombre)
select id, split_part(email, '@', 1), 'admin', initcap(split_part(email, '@', 1))
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

## Tocar en vivo

### Modo En vivo (los músicos siguen al líder)

1. **El líder** (Editor o Administrador) abre una canción → menú **☰ → ● Dirigir en vivo**. Arriba aparece "● EN VIVO · N músicos".
2. **Los músicos** pulsan **● En vivo** en la lista de canciones. A partir de ahí ven exactamente lo del líder, sin tocar nada:
   - **Canción:** si el líder abre otra (por ejemplo desde el set list), cambia también para ellos.
   - **Tono:** si el líder transpone, también se les transpone.
   - **Posición:** si el líder baja, ya sea con el dedo o con auto-scroll, su pantalla baja.
3. **Mensajes:** el líder pulsa **💬** en su indicador EN VIVO y elige un mensaje rápido ("Repetimos el coro", "Último coro", "Más despacio"…) o escribe uno propio (máx. 140 caracteres).
   - A los músicos les aparece un globo arriba, sobre la barra y no sobre la letra, con el nombre de quien lo manda.
   - El globo se cierra solo (más tiempo si el texto es largo) o al tocarlo.
   - El celular vibra brevemente, si lo permite.
4. Para terminar, el líder pulsa **Terminar**. Los músicos salen con **Salir**.

Notas:
- La posición se comparte por línea de la canción, no en píxeles, para que coincida aunque cada quien tenga otro tamaño de pantalla.
- La pantalla no se apaga mientras están en vivo.
- Si un músico entra tarde o pierde la señal, se pone al día solo en un par de segundos.
- Si otro Editor empieza a dirigir, el anterior deja de dirigir y se le avisa.

### Auto-scroll

- **▶ / ⏸** inicia y pausa. En computadora también funciona la barra espaciadora.
- **x1–x5** cambia la velocidad al momento, incluso en pausa, y se recuerda en cada dispositivo:

| Velocidad | Segundos por línea | Para |
|---|---|---|
| x1 | 8 | himno lento |
| x2 | 6 | |
| x3 | 4.5 | (predeterminada) |
| x4 | 3.5 | |
| x5 | 2.5 | canto rápido |

- La velocidad se mide en líneas de canción (acordes + letra), así se siente igual en cualquier pantalla.
- Se detiene solo al llegar al final. Si mueves la canción con el dedo, sigue desde ahí.

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
