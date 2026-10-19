// Configuración pública de Supabase (proyecto compartido con PSI/Arcade/Nupcia).
// La anon key es pública por diseño: la seguridad la imponen las políticas RLS
// de supabase/schema.sql. NUNCA pongas aquí la service_role key.
const SUPABASE_URL = 'https://pbjthkfiuapwnmwhlrxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBianRoa2ZpdWFwd25td2hscnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MDgzMzQsImV4cCI6MjA5NzE4NDMzNH0.do3K1RXfmCqi3WwqFTOBfdDdhGL-6mn6ZFqktgN3PuA';

// Se entra con nombre de usuario; en Supabase Auth cada uno es <usuario>@alaba.invalid.
// Debe coincidir con USER_DOMAIN en netlify/functions/admin-usuarios.mjs.
const USER_DOMAIN = 'alaba.invalid';
