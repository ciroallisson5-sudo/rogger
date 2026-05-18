'use strict';

const crypto = require('crypto');

function adminConfig() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, service, ok: !!(base && service) };
}

async function restGet(cfg, path) {
  const res = await fetch(cfg.base + path, {
    headers: {
      apikey: cfg.service,
      Authorization: 'Bearer ' + cfg.service,
      'Content-Type': 'application/json'
    }
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, status: res.status, data: data };
}

async function restPatch(cfg, table, query, patch, opts) {
  const prefer = (opts && opts.prefer) || 'return=minimal';
  const res = await fetch(cfg.base + '/rest/v1/' + table + '?' + query, {
    method: 'PATCH',
    headers: {
      apikey: cfg.service,
      Authorization: 'Bearer ' + cfg.service,
      'Content-Type': 'application/json',
      Prefer: prefer
    },
    body: JSON.stringify(patch)
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, status: res.status, data: data };
}

async function restPost(cfg, table, row) {
  const res = await fetch(cfg.base + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: cfg.service,
      Authorization: 'Bearer ' + cfg.service,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, status: res.status, data: data };
}

/**
 * Idempotência: insere em payment_events; se conflito unique, já processado.
 * @returns {{ inserted: boolean, duplicate: boolean }}
 */
async function insertPaymentEvent(cfg, row) {
  const r = await restPost(cfg, 'payment_events', row);
  if (r.ok) return { inserted: true, duplicate: false };
  if (r.status === 409) return { inserted: false, duplicate: true };
  const msg = JSON.stringify(r.data || {});
  if (/duplicate|unique|23505/i.test(msg)) return { inserted: false, duplicate: true };
  return { inserted: false, duplicate: false, error: r.data };
}

async function rpcDecrementStock(cfg, orderId) {
  const res = await fetch(cfg.base + '/rest/v1/rpc/decrement_stock_for_order', {
    method: 'POST',
    headers: {
      apikey: cfg.service,
      Authorization: 'Bearer ' + cfg.service,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_order_id: orderId })
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, data: data };
}

/**
 * Processa pagamento aprovado no Mercado Pago (webhook ou consulta servidor).
 * @param {object} mpPayment — objeto GET /v1/payments/:id
 */
async function applyMercadoPagoApproved(cfg, mpPayment, eventType) {
  const ext = String(mpPayment.external_reference || '').trim();
  const mpId = String(mpPayment.id || '');
  const amount = parseFloat(mpPayment.transaction_amount);
  const currency = String(mpPayment.currency_id || '').toUpperCase();
  const live = mpPayment.live_mode === true;

  const envProd = String(process.env.MERCADO_PAGO_ENV || 'production').toLowerCase() === 'production';
  if (envProd !== live) {
    console.error(
      '[mercadopago-sync] live_mode_mismatch: MERCADO_PAGO_ENV=' +
        (envProd ? 'production' : 'sandbox') +
        ' espera pagamento live_mode=' +
        String(envProd) +
        ', mas o MP retornou live_mode=' +
        String(live) +
        ' (payment_id=' +
        (mpId || '?') +
        ')'
    );
    return {
      ok: false,
      reason: 'live_mode_mismatch',
      expected_live_mode: envProd,
      payment_live_mode: live
    };
  }

  if (!ext || !mpId || currency !== 'BRL' || !isFinite(amount)) {
    return { ok: false, reason: 'invalid_payment_payload' };
  }

  const st = String(mpPayment.status || '')
    .toLowerCase()
    .replace(/^canceled$/, 'cancelled');

  const ord = await restGet(
    cfg,
    '/rest/v1/orders?id=eq.' + encodeURIComponent(ext) + '&select=id,user_id,total_amount,payment_status,status,inventory_applied&limit=1'
  );
  if (!ord.ok || !Array.isArray(ord.data) || !ord.data[0]) {
    return { ok: false, reason: 'order_not_found' };
  }
  const order = ord.data[0];
  const total = parseFloat(order.total_amount);
  if ((st === 'approved' || st === 'accredited') && (!isFinite(total) || Math.abs(total - amount) > 0.02)) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  const eventKey = 'mp-' + mpId + '-' + st;
  const evIns = await insertPaymentEvent(cfg, {
    provider: 'mercadopago',
    event_id: eventKey,
    event_type: eventType || mpPayment.status || 'unknown',
    resource_id: mpId,
    order_id: ext,
    payment_id: null,
    raw_payload: { status: mpPayment.status, amount: amount },
    processed_at: new Date().toISOString()
  });
  if (evIns.duplicate) {
    return { ok: true, duplicate: true };
  }
  if (!evIns.inserted && evIns.error) {
    return { ok: false, reason: 'event_insert_failed', detail: evIns.error };
  }

  if (st === 'approved' || st === 'accredited') {
    if (order.payment_status === 'paid' && order.inventory_applied) {
      return { ok: true, duplicate: true };
    }

    await restPatch(cfg, 'payments', 'order_id=eq.' + encodeURIComponent(ext), {
      provider: 'mercadopago',
      provider_payment_id: mpId,
      provider_status: mpPayment.status != null ? String(mpPayment.status) : null,
      provider_status_detail:
        mpPayment.status_detail != null ? String(mpPayment.status_detail) : null,
      status: 'approved',
      paid_at: new Date().toISOString(),
      raw_provider_payload: mpPayment
    });

    const ordUp = await restPatch(
      cfg,
      'orders',
      'id=eq.' + encodeURIComponent(ext) + '&payment_status=neq.paid',
      {
        payment_status: 'paid',
        status: 'confirmed',
        inventory_applied: true
      },
      { prefer: 'return=representation' }
    );
    const transitioned =
      ordUp.ok && Array.isArray(ordUp.data) && ordUp.data.length > 0;

    if (transitioned) {
      const stock = await rpcDecrementStock(cfg, ext);
      if (!stock.ok) {
        console.error('[mercadopago-sync] decrement_stock RPC', stock.status);
      }
    }

    return { ok: true, order_id: ext, paid: true, duplicate: !transitioned && order.payment_status === 'paid' };
  }

  if (st === 'pending' || st === 'in_process' || st === 'in_mediation') {
    await restPatch(cfg, 'payments', 'order_id=eq.' + encodeURIComponent(ext), {
      provider: 'mercadopago',
      provider_payment_id: mpId,
      provider_status: mpPayment.status != null ? String(mpPayment.status) : null,
      provider_status_detail:
        mpPayment.status_detail != null ? String(mpPayment.status_detail) : null,
      raw_provider_payload: mpPayment
    });
    await restPatch(cfg, 'orders', 'id=eq.' + encodeURIComponent(ext), {
      payment_status: 'pending',
      status: 'pending'
    });
    return { ok: true, pending: true };
  }

  if (st === 'rejected' || st === 'cancelled' || st === 'refunded' || st === 'charged_back') {
    const orderPaymentStatus = st === 'refunded' ? 'refunded' : 'cancelled';
    await restPatch(cfg, 'payments', 'order_id=eq.' + encodeURIComponent(ext), {
      provider: 'mercadopago',
      provider_payment_id: mpId,
      provider_status: mpPayment.status != null ? String(mpPayment.status) : null,
      provider_status_detail:
        mpPayment.status_detail != null ? String(mpPayment.status_detail) : null,
      status: st === 'refunded' ? 'refunded' : st === 'charged_back' ? 'charged_back' : 'cancelled',
      raw_provider_payload: mpPayment
    });
    await restPatch(cfg, 'orders', 'id=eq.' + encodeURIComponent(ext), {
      payment_status: orderPaymentStatus,
      status: 'cancelled'
    });
    return { ok: true, failed: true };
  }

  return { ok: true, ignored: true, status: st };
}

/**
 * Valida assinatura webhook Mercado Pago (x-signature, x-request-id).
 * @see https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
function validateMercadoPagoWebhookSignature(rawBodyStr, headers, query, secret) {
  if (!secret) return false;
  const xSig = String((headers && (headers['x-signature'] || headers['X-Signature'])) || '');
  const xReq = String((headers && (headers['x-request-id'] || headers['X-Request-Id'])) || '');
  if (!xSig || !xReq) return false;

  let ts = '';
  let v1 = '';
  xSig.split(',').forEach(function (part) {
    const p = part.trim();
    if (p.indexOf('ts=') === 0) ts = p.slice(3);
    if (p.indexOf('v1=') === 0) v1 = p.slice(3);
  });
  if (!ts || !v1) return false;

  let dataId = '';
  try {
    const q = typeof query === 'object' && query ? query : {};
    dataId = String(q['data.id'] || q['data_id'] || '').trim();
  } catch (_) {
    /**/
  }
  if (!dataId && rawBodyStr) {
    try {
      const j = JSON.parse(rawBodyStr);
      if (j && j.data && j.data.id != null) dataId = String(j.data.id);
    } catch (_) {
      /**/
    }
  }
  if (!dataId) return false;

  const manifest = 'id:' + dataId + ';request-id:' + xReq + ';ts:' + ts + ';';
  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = String(hmac).toLowerCase();
  const b = String(v1).trim().toLowerCase();
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function clearCartForOrderUser(cfg, orderId) {
  const o = await fetch(
    cfg.base + '/rest/v1/orders?id=eq.' + encodeURIComponent(orderId) + '&select=user_id&limit=1',
    {
      headers: { apikey: cfg.service, Authorization: 'Bearer ' + cfg.service }
    }
  );
  const rows = await o.json().catch(function () {
    return [];
  });
  if (!Array.isArray(rows) || !rows[0] || !rows[0].user_id) return;
  const uid = rows[0].user_id;
  const c = await fetch(
    cfg.base + '/rest/v1/carts?user_id=eq.' + encodeURIComponent(uid) + '&select=id&limit=1',
    {
      headers: { apikey: cfg.service, Authorization: 'Bearer ' + cfg.service }
    }
  );
  const cr = await c.json().catch(function () {
    return [];
  });
  if (!Array.isArray(cr) || !cr[0]) return;
  const cartId = cr[0].id;
  await fetch(cfg.base + '/rest/v1/cart_items?cart_id=eq.' + encodeURIComponent(cartId), {
    method: 'DELETE',
    headers: { apikey: cfg.service, Authorization: 'Bearer ' + cfg.service }
  }).catch(function () {});
}

/**
 * URL pública do site (sem barra final). Usada em back_urls e notification_url do MP.
 * Ordem: APP_URL / SITE_* → VERCEL_URL → cabeçalhos Host (domínio custom na Vercel).
 */
function resolvePublicBaseUrl(req) {
  var fromEnv = (process.env.APP_URL || process.env.SITE_URL || process.env.SITE_PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  var vu = (process.env.VERCEL_URL || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (vu) return 'https://' + vu;
  if (req && req.headers) {
    var host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
    if (host && !/^localhost(:\d+)?$/i.test(host)) {
      var proto = String(req.headers['x-forwarded-proto'] || 'https')
        .split(',')[0]
        .trim();
      if (proto !== 'http' && proto !== 'https') proto = 'https';
      return proto + '://' + host;
    }
  }
  return '';
}

module.exports = {
  adminConfig,
  applyMercadoPagoApproved,
  validateMercadoPagoWebhookSignature,
  insertPaymentEvent,
  restGet,
  restPatch,
  restPost,
  clearCartForOrderUser,
  resolvePublicBaseUrl
};
