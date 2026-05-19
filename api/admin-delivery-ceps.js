'use strict';

const { verifySupabaseAdmin } = require('./_supabase-admin');
const { applyBrowserCors, handleOptions } = require('./_http');

module.exports = async function handler(req, res) {
  applyBrowserCors(req, res);
  if (handleOptions(req, res)) return;

  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.replace(/^Bearer\s+/i, '').trim();

    let adminOk = jwt && await verifySupabaseAdmin(jwt);
    if (!adminOk) {
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

    if (!jwt || !adminOk) {
      res.status(!adminOk && jwt ? 403 : 401).json({
        error: 'Acesso restrito ao admin. Confirme login e permissão.'
      });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({
        rows: [],
        policy: {
          mode: 'state',
          allowed_state: 'ES',
          allowed_state_name: 'Espírito Santo',
          cep_range: '29000-000 a 29999-999',
          freight_amount: Number(process.env.ES_FREIGHT_AMOUNT || process.env.DELIVERY_ES_FREIGHT_AMOUNT || 150)
        },
        message: 'Frete por CEP individual desativado. A entrega agora é validada por estado: Espírito Santo.'
      });
      return;
    }

    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
      res.status(410).json({
        error: 'Frete por CEP individual foi desativado. Use a regra por estado: Espírito Santo.',
        code: 'DELIVERY_BY_STATE_ONLY'
      });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin-delivery-ceps]', err);
    res.status(500).json({
      error: 'Erro interno na API de entrega por estado.',
      detail: process.env.VERCEL_ENV === 'development' ? String(err && err.message) : undefined
    });
  }
};
