'use strict';

const { verifySupabaseAdmin } = require('./_supabase-admin');

function parseBody(raw) {
  if (raw == null) return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '{}');
    } catch (_) {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function normalizeCep(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length === 8) return d;
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  try {
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const auth = req.headers.authorization || '';
    const jwt = auth.replace(/^Bearer\s+/i, '').trim();

    let adminOk = jwt && await verifySupabaseAdmin(jwt);
    if (!adminOk) {
      /** Fallback dev: ADMIN_EMAIL_ALLOW se RPC get_admin_emails falhar ou email nao listado */
      const dev = process.env.ADMIN_EMAIL_ALLOW || '';
      if (dev && jwt) {
        const userRes = await fetch((process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/auth/v1/user', {
          headers: {
            Authorization: 'Bearer ' + jwt,
            apikey: process.env.SUPABASE_ANON_KEY || ''
          }
        });
        const u = await userRes.json().catch(function () {
          return {};
        });
        if (userRes.ok && String((u.email || '').toLowerCase()) === dev.trim().toLowerCase()) adminOk = true;
      }
    }

    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    if (!jwt || !adminOk || !svc || !base) {
      res.status(!adminOk && jwt ? 403 : 401).json({
        error: 'Acesso restrito ao admin. Confirme login e permissao.'
      });
      return;
    }

    const useSvc = svc;

    if (req.method === 'GET') {
      const fetchRes = await fetch(base + '/rest/v1/delivery_cep_rates?select=*&order=cep.asc', {
        headers: { apikey: useSvc, Authorization: 'Bearer ' + useSvc }
      });
      const list = await fetchRes.json().catch(function () {
        return [];
      });
      const arr = fetchRes.ok && Array.isArray(list) ? list : [];
      if (!fetchRes.ok) {
        res.status(fetchRes.status >= 400 && fetchRes.status < 600 ? fetchRes.status : 502).json({
          error: 'Tabela delivery_cep_rates pode nao existir. Rode database/delivery_cep_rates.sql.',
          detail: typeof list === 'object' ? list : []
        });
        return;
      }
      res.status(200).json({ rows: arr });
      return;
    }

    if (req.method === 'POST') {
      const body = parseBody(req.body);
      const cep = normalizeCep(body.cep);
      const amt = parseFloat(body.freight_amount);
      if (!cep || isNaN(amt) || amt < 0) {
        res.status(400).json({ error: 'cep (8 digitos) e freight_amount validos obrigatorios' });
        return;
      }
      const row = {
        cep: cep,
        freight_amount: amt,
        label: typeof body.label === 'string' ? body.label.trim().slice(0, 120) || null : null
      };

      const r = await fetch(base + '/rest/v1/delivery_cep_rates', {
        method: 'POST',
        headers: {
          apikey: useSvc,
          Authorization: 'Bearer ' + useSvc,
          'Content-Type': 'application/json',
          Prefer: 'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(row)
      }).catch(function () {
        return null;
      });
      const data = r ? await r.json().catch(function () { return null; }) : null;
      const ok = r && r.ok;
      if (!ok) {
        res.status(r ? r.status : 503).json({
          error: 'Falha ao inserir. CEP pode ja existir.',
          detail: data
        });
        return;
      }
      res.status(201).json({ row: Array.isArray(data) ? data[0] : data });
      return;
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req.body);
      const id = String(body.id || '').trim();
      const amt = parseFloat(body.freight_amount);
      if (!id || isNaN(amt) || amt < 0) {
        res.status(400).json({ error: 'id e freight_amount validos sao obrigatorios' });
        return;
      }
      const patch = {
        freight_amount: amt,
        label: typeof body.label === 'string' ? body.label.trim().slice(0, 120) || null : null
      };
      const newCep = normalizeCep(body.cep);
      if (newCep) {
        patch.cep = newCep;
      }
      const r = await fetch(base + '/rest/v1/delivery_cep_rates?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: {
          apikey: useSvc,
          Authorization: 'Bearer ' + useSvc,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(patch)
      }).catch(function () {
        return null;
      });
      const data = r ? await r.json().catch(function () { return null; }) : null;
      if (!r || !r.ok) {
        res.status(r ? r.status : 503).json({
          error: 'Falha ao atualizar. CEP pode estar duplicado ou id invalido.',
          detail: data
        });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      res.status(200).json({ row: row || { id } });
      return;
    }

    if (req.method === 'DELETE') {
      const body = parseBody(req.body);
      const id = String(body.id || '').trim();
      if (!id) {
        res.status(400).json({ error: 'id obrigatorio' });
        return;
      }
      await fetch(base + '/rest/v1/delivery_cep_rates?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: {
          apikey: useSvc,
          Authorization: 'Bearer ' + useSvc,
          Prefer: 'return=minimal'
        }
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin-delivery-ceps]', err);
    res.status(500).json({
      error: 'Erro interno na API de CEP. Verifique os logs do servidor.',
      detail: process.env.VERCEL_ENV === 'development' ? String(err && err.message) : undefined
    });
  }
};
