'use strict';

const { parseBody } = require('./_http');
const {
  adminConfig,
  applyMercadoPagoApproved,
  validateMercadoPagoWebhookSignature,
  clearCartForOrderUser
} = require('./mercadopago-sync');

function parseQuery(url) {
  const out = {};
  try {
    const u = new URL(url || '', 'http://localhost');
    u.searchParams.forEach(function (v, k) {
      out[k] = v;
    });
  } catch (_) {
    /**/
  }
  return out;
}

function rawBodyString(req, parsed) {
  if (typeof req.body === 'string') return req.body;
  try {
    return JSON.stringify(parsed != null ? parsed : {});
  } catch (_) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).end(
      JSON.stringify({
        ok: true,
        endpoint: 'mercadopago-webhook',
        hint: 'Mercado Pago envia notificacoes via POST com assinatura x-signature.'
      })
    );
    return;
  }
  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = (process.env.MERCADO_PAGO_WEBHOOK_SECRET || '').trim();
  const accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim();
  const cfg = adminConfig();

  const parsed = parseBody(req.body);
  const raw = rawBodyString(req, parsed);
  const fromUrl = parseQuery(req.url || '');
  const fromReq = typeof req.query === 'object' && req.query && !Array.isArray(req.query) ? req.query : {};
  const query = Object.assign({}, fromUrl, fromReq);

  if (!secret || !accessToken || !cfg.ok) {
    var miss = [];
    if (!secret) miss.push('MERCADO_PAGO_WEBHOOK_SECRET');
    if (!accessToken) miss.push('MERCADO_PAGO_ACCESS_TOKEN');
    if (!cfg.ok) {
      if (!(process.env.SUPABASE_URL || '').trim()) miss.push('SUPABASE_URL');
      if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) miss.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    res.status(503).json({ error: 'Webhook não configurado', missing: miss });
    return;
  }

  if (!validateMercadoPagoWebhookSignature(raw, req.headers, query, secret)) {
    console.error('[mercadopago-webhook] assinatura invalida ou cabecalhos ausentes (x-signature / x-request-id / data.id)');
    res.status(401).json({ error: 'Assinatura invalida' });
    return;
  }

  let dataId = String(query['data.id'] || query.data_id || '').trim();
  if (!dataId && parsed && parsed.data) dataId = String(parsed.data.id || '').trim();
  if (!dataId) {
    res.status(400).json({ error: 'data.id ausente' });
    return;
  }

  const typ = String(query.type || (parsed && parsed.type) || 'payment')
    .trim()
    .toLowerCase();
  if (typ !== 'payment') {
    res.status(200).json({ ok: true, ignored: true, type: typ });
    return;
  }

  try {
    const payRes = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(dataId), {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const payment = await payRes.json().catch(function () {
      return null;
    });
    if (!payRes.ok || !payment || !payment.id) {
      res.status(502).json({ error: 'Falha ao consultar pagamento no Mercado Pago' });
      return;
    }

    const result = await applyMercadoPagoApproved(cfg, payment, typ || 'payment');
    if (!result.ok) {
      if (result.reason === 'live_mode_mismatch') {
        res.status(409).json({ error: result.reason });
        return;
      }
      if (result.reason === 'amount_mismatch' || result.reason === 'order_not_found') {
        res.status(400).json({ error: result.reason });
        return;
      }
      res.status(500).json({ error: result.reason || 'sync_error' });
      return;
    }

    if (result.paid && result.order_id) {
      await clearCartForOrderUser(cfg, result.order_id);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[mercadopago-webhook]', err && err.message);
    res.status(500).json({ error: 'internal_error' });
  }
};
