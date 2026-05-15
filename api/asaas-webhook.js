// Webhook Asaas → atualiza pedido/pagamento no Supabase automaticamente
// Cadastre na Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opcional: ASAAS_WEBHOOK_TOKEN (mesmo token configurado no painel Asaas → Webhooks)
//
// URL: https://SEU-DOMINIO.vercel.app/api/asaas-webhook

const sync = require('./asaas-payment-sync');

function parseBody(raw) {
  if (raw == null) return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '{}');
    } catch (_) {
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

function extractPayment(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.payment && typeof payload.payment === 'object') return payload.payment;
  if (payload.id && payload.status && payload.customer) return payload;
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, asaas-access-token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      webhook: 'asaas-webhook',
      supabase: sync.adminConfig().ok,
      url: 'POST esta URL no painel Asaas → Integrações → Webhooks'
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expectedToken = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  if (expectedToken) {
    const got =
      (req.headers && (req.headers['asaas-access-token'] || req.headers['Asaas-Access-Token'])) || '';
    if (String(got).trim() !== expectedToken) {
      res.status(401).json({ error: 'Invalid webhook token' });
      return;
    }
  }

  const payload = parseBody(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const event = payload.event || payload.type || '';
  const payment = extractPayment(payload);

  if (!payment) {
    res.status(200).json({ ok: true, ignored: true, event: event, reason: 'no payment in payload' });
    return;
  }

  try {
    const result = await sync.applyAsaasPaymentUpdate(payment, event);
    res.status(200).json({ ok: true, event: event, result: result });
  } catch (err) {
    console.error('[asaas-webhook]', err);
    res.status(200).json({ ok: false, error: err.message || 'sync failed' });
  }
};
