-- ============================================================================
-- Alaba Tool · migración 2: modo En vivo (Supabase Realtime)
--
-- El líder transmite qué canción tiene abierta, en qué tono y por dónde va;
-- los músicos la siguen en sus pantallas. Usa un canal PRIVADO de Realtime
-- ('alaba:en-vivo'), así que solo entra quien cumpla estas políticas:
--
--   escuchar  → cualquier miembro de Alaba Tool (lector, editor o admin)
--   presencia → cualquier miembro (para que el líder vea cuántos músicos hay)
--   transmitir → solo editor o admin (los que pueden dirigir)
--
-- Las políticas solo aplican al tema 'alaba:en-vivo': no afectan a los canales
-- de las otras apps del proyecto. Ejecutar en Supabase → SQL Editor. Idempotente.
-- ============================================================================

drop policy if exists "alaba_en_vivo_escuchar" on realtime.messages;
create policy "alaba_en_vivo_escuchar" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'alaba:en-vivo'
    and public.alaba_rol() is not null
  );

drop policy if exists "alaba_en_vivo_transmitir" on realtime.messages;
create policy "alaba_en_vivo_transmitir" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() = 'alaba:en-vivo'
    and (
      (extension = 'presence' and public.alaba_rol() is not null)
      or (extension = 'broadcast' and public.alaba_rol() in ('editor', 'admin'))
    )
  );
