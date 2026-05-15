'use strict';

/** Atualiza pedido + pagamento no Supabase quando o Asaas confirma cobrança. */

function adminConfig() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, service, ok: !!(base && service) };
}

function mapPaymentStatus(asaasStatus, event) {
  const s = String(asaasStatus || '').toUpperCase();
  const ev = String(event || '').toUpperCase();
  if (
    s === 'RECEIVED' ||
    s === 'CONFIRMED' ||
    s === 'RECEIVED_IN_CASH' ||
    s === 'DUNNING_RECEIVED' ||
    ev === 'PAYMENT_RECEIVED' ||
    ev === 'PAYMENT_CONFIRMED'
  ) {
    return 'paid';
  }
  if (s === 'REFUNDED' || s === 'REFUND_IN_PROGRESS' || ev === 'PAYMENT_REFUNDED') {
    return 'refunded';
  }
  if (s === 'CANCELLED' || s === 'DELETED' || ev === 'PAYMENT_DELETED') {
    return 'cancelled';
  }
  if (s === 'OVERDUE' || ev === 'PAYMENT_OVERDUE') {
    return 'pending';
  }
  return 'pending';
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
    return [];
  });
  return { ok: res.ok, data: data };
}

async function restPatch(cfg, table, query, patch) {
  const res = await fetch(cfg.base + '/rest/v1/' + table + '?' + query, {
    method: 'PATCH',
    headers: {
      apikey: cfg.service,
      Authorization: 'Bearer ' + cfg.service,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(patch)
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, data: data };
}

/**
 * @param {object} payment — objeto payment do webhook ou API Asaas
 * @param {string} [event] — PAYMENT_RECEIVED, etc.
 */
async function applyAsaasPaymentUpdate(payment, event) {
  const cfg = adminConfig();
  if (!cfg.ok) {
    return { ok: false, error: 'Supabase service role not configured' };
  }
  if (!payment || !payment.id) {
    return { ok: false, error: 'payment.id missing' };
  }

  const asaasId = String(payment.id);
  const orderId = payment.externalReference ? String(payment.externalReference).trim() : '';
  const storePayStatus = mapPaymentStatus(payment.status, event);
  const asaasStatus = String(payment.status || '');

  let orderRow = null;

  if (orderId) {
    const o = await restGet(cfg, '/rest/v1/orders?id=eq.' + encodeURIComponent(orderId) + '&select=id,status,payment_status&limit=1');
    if (o.ok && Array.isArray(o.data) && o.data[0]) orderRow = o.data[0];
  }

  if (!orderRow) {
    const p = await restGet(
      cfg,
      '/rest/v1/payments?asaas_id=eq.' + encodeURIComponent(asaasId) + '&select=order_id&limit=1'
    );
    if (p.ok && Array.isArray(p.data) && p.data[0] && p.data[0].order_id) {
      const oid = p.data[0].order_id;
      const o2 = await restGet(cfg, '/rest/v1/orders?id=eq.' + encodeURIComponent(oid) + '&select=id,status,payment_status&limit=1');
      if (o2.ok && Array.isArray(o2.data) && o2.data[0]) orderRow = o2.data[0];
    }
  }

  await restPatch(cfg, 'payments', 'asaas_id=eq.' + encodeURIComponent(asaasId), {
    status: asaasStatus
  });

  if (!orderRow) {
    return { ok: true, updated: false, reason: 'order_not_found', asaas_id: asaasId };
  }

  const orderPatch = {
    payment_status: storePayStatus
  };
  if (storePayStatus === 'paid' && (orderRow.status === 'pending' || !orderRow.status)) {
    orderPatch.status = 'confirmed';
  }
  if (storePayStatus === 'cancelled') {
    orderPatch.status = 'cancelled';
  }

  const upd = await restPatch(cfg, 'orders', 'id=eq.' + encodeURIComponent(orderRow.id), orderPatch);

  return {
    ok: true,
    updated: upd.ok,
    order_id: orderRow.id,
    payment_status: storePayStatus,
    order_status: orderPatch.status || orderRow.status
  };
}

module.exports = {
  adminConfig,
  mapPaymentStatus,
  applyAsaasPaymentUpdate
};
