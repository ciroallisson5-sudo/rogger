'use strict';

/** Valida JWT do utilizador Supabase (anon key). Devolve { id, email } ou null. */
async function verifySupabaseUserJwt(jwt) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  if (!base || !anon || !jwt) return null;
  try {
    const res = await fetch(base + '/auth/v1/user', {
      headers: {
        Authorization: 'Bearer ' + jwt,
        apikey: anon
      }
    });
    if (!res.ok) return null;
    const u = await res.json().catch(function () {
      return {};
    });
    const id = u && u.id ? String(u.id) : '';
    const email = u && u.email ? String(u.email) : '';
    if (!id) return null;
    const meta = u.user_metadata && typeof u.user_metadata === 'object' ? u.user_metadata : {};
    const phoneRaw =
      (u.phone != null && String(u.phone).trim()) ||
      (meta.phone != null && String(meta.phone).trim()) ||
      (meta.whatsapp != null && String(meta.whatsapp).trim()) ||
      '';
    return { id: id, email: email, phone: phoneRaw, user_metadata: meta };
  } catch (_) {
    return null;
  }
}

module.exports = { verifySupabaseUserJwt };
