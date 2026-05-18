'use strict';

const { applyBrowserCors, handleOptions } = require('./_http');
const { verifySupabaseUserJwt } = require('./_supabase-user');
const { rateLimitKey, allow, prune } = require('./_rate-limit');
const {
  adminConfig,
  restGet,
  applyMercadoPagoApproved,
  clearCartForOrderUser
} = require('./mercadopago-sync');

module.exports = async function handler(req, res) {
  prune();
  applyBrowserCors(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = rateLimitKey(req, 'mp-status');
  if (!allow(key, 60, 60000)) {
    res.status(429).json({ error: 'Muitas consultas. Aguarde.' });
    return;
  }

  const cfg = adminConfig();
  const accessToken = String(
    process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      process.env.MERCADOPAGO_ACCESS_TOKEN ||
      process.env.MP_ACCESS_TOKEN ||
      ''
  ).trim();
  if (!cfg.ok || !accessToken) {
    res.status(503).json({ error: 'Serviço indisponível' });
    return;
  }

  const auth = req.headers.authorization || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  const user = await verifySupabaseUserJwt(jwt);
  if (!user) {
    res.status(401).json({ error: 'Nao autorizado' });
    return;
  }

  let orderId = '';
  try {
    const u = new URL(req.url || '', 'http://localhost');
    orderId = String(u.searchParams.get('order_id') || '').trim();
  } catch (_) {
    /**/
  }
  if (!orderId) {
    res.status(400).json({ error: 'order_id obrigatorio' });
    return;
  }

  let ord = await restGet(
    cfg,
    '/rest/v1/orders?id=eq.' +
      encodeURIComponent(orderId) +
      '&user_id=eq.' +
      encodeURIComponent(user.id) +
      '&select=id,order_number,total_amount,payment_status,status,created_at&limit=1'
  );
  if (!ord.ok || !Array.isArray(ord.data) || !ord.data[0]) {
    res.status(404).json({ error: 'Pedido não encontrado' });
    return;
  }
  let order = ord.data[0];

  const pay = await restGet(
    cfg,
    '/rest/v1/payments?order_id=eq.' + encodeURIComponent(orderId) + '&select=provider_payment_id,provider_status,status&limit=1'
  );
  let mpId = '';
  if (pay.ok && Array.isArray(pay.data) && pay.data[0]) {
    mpId = String(pay.data[0].provider_payment_id || '');
  }

  let mpStatus = null;
  let mpDetail = null;
  if (mpId) {
    const pr = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(mpId), {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const pj = await pr.json().catch(function () {
      return null;
    });
    if (pr.ok && pj) {
      mpStatus = pj.status;
      mpDetail = pj.status_detail || null;
      const st = String(pj.status || '').toLowerCase();
      if (st === 'approved' || st === 'accredited') {
        const applied = await applyMercadoPagoApproved(cfg, pj, 'status_poll');
        if (applied.ok && applied.paid && applied.order_id) {
          await clearCartForOrderUser(cfg, applied.order_id);
        }
        ord = await restGet(
          cfg,
          '/rest/v1/orders?id=eq.' +
            encodeURIComponent(orderId) +
            '&user_id=eq.' +
            encodeURIComponent(user.id) +
            '&select=id,order_number,total_amount,payment_status,status,created_at&limit=1'
        );
        if (ord.ok && Array.isArray(ord.data) && ord.data[0]) order = ord.data[0];
      }
    }
  }

  res.status(200).json({
    order_id: order.id,
    order_number: order.order_number,
    payment_status: order.payment_status,
    order_status: order.status,
    mercado_pago: mpId
      ? { payment_id: mpId, status: mpStatus, status_detail: mpDetail }
      : { payment_id: null, status: null, status_detail: null }
  });
};
