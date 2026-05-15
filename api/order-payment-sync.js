// Sincroniza status do pagamento (usuario logado no checkout / perfil)
// POST { "order_id": "uuid", "asaas_payment_id": "pay_..." }

const sync = require('./asaas-payment-sync');

const BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3'
};

function stripKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (/^bearer\s+/i.test(s)) s = s.slice(7).trim();
  return s;
}

function pickKey(envNorm) {
  const fallback = stripKey(process.env.ASAAS_API_KEY || '');
  const sand = stripKey(process.env.ASAAS_API_KEY_SANDBOX || '') || fallback;
  const prod = stripKey(process.env.ASAAS_API_KEY_PRODUCTION || '') || fallback;
  return envNorm === 'production' ? prod : sand;
}

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
  if (typeof raw === 'object') return raw;
  return {};
}

async function verifyUserOwnsOrder(orderId, jwt) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !anon || !service || !jwt) return false;

  const userRes = await fetch(base + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + jwt, apikey: anon }
  });
  if (!userRes.ok) return false;
  const user = await userRes.json().catch(function () {
    return {};
  });
  const uid = user && user.id;
  if (!uid) return false;

  const orderRes = await fetch(
    base + '/rest/v1/orders?id=eq.' + encodeURIComponent(orderId) + '&user_id=eq.' + encodeURIComponent(uid) + '&select=id&limit=1',
    { headers: { apikey: service, Authorization: 'Bearer ' + service } }
  );
  const rows = await orderRes.json().catch(function () {
    return [];
  });
  return Array.isArray(rows) && rows.length > 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = (req.headers && req.headers.authorization) || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    res.status(401).json({ error: 'Login required' });
    return;
  }

  const body = parseBody(req.body);
  const orderId = String(body.order_id || body.orderId || '').trim();
  const asaasPaymentId = String(body.asaas_payment_id || body.asaasPaymentId || body.payment_id || '').trim();
  const envNorm =
    String(body.environment || process.env.ASAAS_DEFAULT_ENV || 'production').toLowerCase() === 'sandbox'
      ? 'sandbox'
      : 'production';

  if (!orderId || !asaasPaymentId) {
    res.status(400).json({ error: 'order_id and asaas_payment_id required' });
    return;
  }

  const owns = await verifyUserOwnsOrder(orderId, jwt);
  if (!owns) {
    res.status(403).json({ error: 'Order not found' });
    return;
  }

  const apiKey = pickKey(envNorm);
  if (!apiKey) {
    res.status(503).json({ error: 'ASAAS_API_KEY not configured' });
    return;
  }

  try {
    const asaasRes = await fetch(BASE_URLS[envNorm] + '/payments/' + encodeURIComponent(asaasPaymentId), {
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey,
        'User-Agent': 'conforta-store/1.0'
      }
    });
    const payment = await asaasRes.json().catch(function () {
      return {};
    });
    if (!asaasRes.ok) {
      res.status(asaasRes.status).json({ error: payment.message || 'Asaas error', payment_status: 'pending' });
      return;
    }

    payment.externalReference = payment.externalReference || orderId;
    const result = await sync.applyAsaasPaymentUpdate(payment, 'PAYMENT_SYNC');

    res.status(200).json({
      ok: true,
      payment_status: result.payment_status || mapFallback(payment.status),
      order_status: result.order_status,
      asaas_status: payment.status,
      updated: result.updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};

function mapFallback(s) {
  return sync.mapPaymentStatus(s, '');
}
