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


function rawPayloadGuestSession(row) {
  const raw = row && row.raw_provider_payload ? row.raw_provider_payload : {};
  if (!raw || typeof raw !== 'object') return '';
  return String(raw.guest_session_id || '').trim();
}

async function guestOwnsOrder(cfg, orderId, guestSessionId) {
  if (!guestSessionId) return false;
  const pay = await restGet(
    cfg,
    '/rest/v1/payments?order_id=eq.' + encodeURIComponent(orderId) + '&select=raw_provider_payload&limit=1'
  );
  if (!pay.ok || !Array.isArray(pay.data) || !pay.data[0]) return false;
  return rawPayloadGuestSession(pay.data[0]) === String(guestSessionId).trim();
}

function mergeQuery(req) {
  const fromReq = typeof req.query === 'object' && req.query && !Array.isArray(req.query) ? req.query : {};
  const out = Object.assign({}, fromReq);
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    u.searchParams.forEach(function (v, k) {
      if (out[k] === undefined || out[k] === '') out[k] = v;
    });
  } catch (_) {
    /**/
  }
  return out;
}

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

  const q = mergeQuery(req);
  const auth = req.headers.authorization || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  const user = jwt ? await verifySupabaseUserJwt(jwt) : null;
  const guestSessionId = String(q.guest_session_id || q.guestSessionId || '').trim();

  let orderId = String(q.order_id || '').trim();
  if (!orderId) orderId = String(q.external_reference || '').trim();
  if (!orderId) {
    res.status(400).json({ error: 'order_id ou external_reference obrigatório' });
    return;
  }

  let ordPath =
    '/rest/v1/orders?id=eq.' +
    encodeURIComponent(orderId) +
    '&select=id,order_number,user_id,total_amount,payment_status,status,created_at&limit=1';
  let ord = await restGet(cfg, ordPath);
  if (!ord.ok || !Array.isArray(ord.data) || !ord.data[0]) {
    res.status(404).json({ error: 'Pedido não encontrado' });
    return;
  }
  let order = ord.data[0];
  const ownsByUser = !!(user && String(order.user_id || '') === String(user.id));
  const ownsByGuest = !ownsByUser && (await guestOwnsOrder(cfg, orderId, guestSessionId));
  if (!ownsByUser && !ownsByGuest) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  const paymentIdParam = String(q.payment_id || q.collection_id || '').trim();
  let mpStatus = null;
  let mpDetail = null;
  let mpIdUsed = '';
  let syncResult = null;

  if (paymentIdParam) {
    mpIdUsed = paymentIdParam;
    const pr = await fetch(
      'https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentIdParam),
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    const pj = await pr.json().catch(function () {
      return null;
    });
    if (!pr.ok || !pj || !pj.id) {
      res.status(502).json({
        error: 'Falha ao consultar pagamento no Mercado Pago',
        mp_http_status: pr.status
      });
      return;
    }
    const extRef = String(pj.external_reference || '').trim();
    if (!extRef || extRef !== orderId) {
      res.status(400).json({
        error: 'Pagamento não corresponde ao pedido (external_reference)',
        code: 'MP_EXTERNAL_REF_MISMATCH'
      });
      return;
    }

    mpStatus = pj.status;
    mpDetail = pj.status_detail || null;
    syncResult = await applyMercadoPagoApproved(cfg, pj, 'return_url_poll');
    if (syncResult.ok && syncResult.paid && syncResult.order_id && ownsByUser) {
      await clearCartForOrderUser(cfg, syncResult.order_id);
    }
    ord = await restGet(
      cfg,
      '/rest/v1/orders?id=eq.' +
        encodeURIComponent(orderId) +
        '&select=id,order_number,user_id,total_amount,payment_status,status,created_at&limit=1'
    );
    if (ord.ok && Array.isArray(ord.data) && ord.data[0]) order = ord.data[0];
  } else {
    const pay = await restGet(
      cfg,
      '/rest/v1/payments?order_id=eq.' +
        encodeURIComponent(orderId) +
        '&select=provider_payment_id,provider_status,status&limit=1'
    );
    let mpId = '';
    if (pay.ok && Array.isArray(pay.data) && pay.data[0]) {
      mpId = String(pay.data[0].provider_payment_id || '');
    }
    if (mpId) {
      mpIdUsed = mpId;
      const pr = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(mpId), {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      const pj = await pr.json().catch(function () {
        return null;
      });
      if (pr.ok && pj) {
        mpStatus = pj.status;
        mpDetail = pj.status_detail || null;
        const extRef = String(pj.external_reference || '').trim();
        if (extRef && extRef === orderId) {
          syncResult = await applyMercadoPagoApproved(cfg, pj, 'status_poll');
          if (syncResult.ok && syncResult.paid && syncResult.order_id && ownsByUser) {
            await clearCartForOrderUser(cfg, syncResult.order_id);
          }
          ord = await restGet(
            cfg,
            '/rest/v1/orders?id=eq.' +
              encodeURIComponent(orderId) +
              '&select=id,order_number,user_id,total_amount,payment_status,status,created_at&limit=1'
          );
          if (ord.ok && Array.isArray(ord.data) && ord.data[0]) order = ord.data[0];
        }
      }
    }
  }

  const out = {
    order_id: order.id,
    order_number: order.order_number,
    payment_status: order.payment_status,
    order_status: order.status,
    mercado_pago: {
      payment_id: mpIdUsed || null,
      status: mpStatus,
      status_detail: mpDetail
    }
  };
  if (syncResult && !syncResult.ok) {
    out.mercadopago_sync = {
      ok: false,
      reason: syncResult.reason || 'sync_error',
      expected_live_mode: syncResult.expected_live_mode,
      payment_live_mode: syncResult.payment_live_mode
    };
  }
  res.status(200).json(out);
};
