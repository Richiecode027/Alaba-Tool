/* ============================================================================
 * Alaba Tool · netlify/functions/admin-usuarios.mjs
 * Alta de usuarios: es lo único que necesita la service_role key (crear cuentas
 * de Auth), por eso no puede hacerse desde el navegador.
 *
 *   POST /api/admin/usuarios
 *   Authorization: Bearer <access_token de un admin de Alaba Tool>
 *   { usuario, password, rol }  → { ok: true, creada: boolean }
 *
 * Se entra con nombre de usuario; en Auth cada uno se guarda como
 * <usuario>@alaba.invalid (mismo dominio que USER_DOMAIN en public/config.js).
 * Si el usuario ya existe (por ejemplo, se le quitó el acceso antes), no se
 * crea otro: se le pone la nueva contraseña y el rol (creada: false). Así el
 * admin también puede restablecer contraseñas olvidadas.
 *
 * Variables de entorno (Netlify → Site configuration → Environment variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * ==========================================================================*/

import { createClient } from '@supabase/supabase-js';

const USER_DOMAIN = 'alaba.invalid';
const ROLES = ['lector', 'editor', 'admin'];
const USUARIO_RE = /^[a-z0-9._-]{3,30}$/;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json({ error: 'El servidor no está configurado' }, 500);

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // ¿Quién llama? Debe ser un admin de Alaba Tool.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sesión requerida' }, 401);

  const { data: authData, error: authError } = await sb.auth.getUser(token);
  const caller = authData?.user;
  if (authError || !caller) return json({ error: 'Sesión inválida o expirada' }, 401);

  const { data: callerRow, error: rolError } = await sb
    .from('alaba_miembros').select('rol').eq('user_id', caller.id).maybeSingle();
  if (rolError) return json({ error: 'No se pudo verificar tu rol' }, 500);
  if (callerRow?.rol !== 'admin') return json({ error: 'Solo un Administrador puede dar de alta usuarios' }, 403);

  // Validar entrada
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido' }, 400);
  }

  const usuario = String(body.usuario || '').trim().toLowerCase();
  const password = String(body.password || '');
  const rol = body.rol;

  if (!USUARIO_RE.test(usuario)) {
    return json({ error: 'Usuario inválido: de 3 a 30 caracteres, solo letras minúsculas, números, punto, guion y guion bajo' }, 400);
  }
  if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
  if (!ROLES.includes(rol)) return json({ error: 'Rol inválido' }, 400);

  const email = `${usuario}@${USER_DOMAIN}`;

  const { data: existingId, error: lookupError } = await sb.rpc('alaba_usuario_por_email', { p_email: email });
  if (lookupError) return json({ error: 'No se pudo buscar el usuario' }, 500);

  if (existingId === caller.id) return json({ error: 'No puedes cambiar tu propio rol ni tu contraseña desde aquí' }, 400);

  let userId = existingId;
  let creada = false;

  if (userId) {
    const { error } = await sb.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: `No se pudo restablecer la contraseña: ${error.message}` }, 400);
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return json({ error: `No se pudo crear el usuario: ${error.message}` }, 400);
    userId = data.user.id;
    creada = true;
  }

  const { error: memberError } = await sb
    .from('alaba_miembros')
    .upsert({ user_id: userId, usuario, rol }, { onConflict: 'user_id' });
  if (memberError) return json({ error: 'No se pudo asignar el rol' }, 500);

  return json({ ok: true, creada });
};

export const config = { path: '/api/admin/usuarios' };
