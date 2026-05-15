'use strict';

/** Verifica JWT de usuario administrador (mesmo criterio de gerar-3d). */

async function verifySupabaseAdmin(jwt) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !anon || !service || !jwt) return null;

  const userRes = await fetch(base + '/auth/v1/user', {
    headers: {
      Authorization: 'Bearer ' + jwt,
      apikey: anon
    }
  });
  if (!userRes.ok) return null;
  const userJson = await userRes.json().catch(function () {
    return {};
  });
  const email = String((userJson && userJson.email) || '').toLowerCase();
  if (!email) return null;

  const rpcRes = await fetch(base + '/rest/v1/rpc/get_admin_emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + service,
      apikey: service,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: '{}'
  });
  const admins = await rpcRes.json().catch(function () {
    return [];
  });
  const list = Array.isArray(admins) ? admins : [];
  const ok = list.some(function (e) {
    return String(e || '').toLowerCase() === email;
  });
  return ok ? { email } : null;
}

module.exports = { verifySupabaseAdmin };
