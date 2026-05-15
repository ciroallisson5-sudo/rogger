// Conforta Store — proxy Asaas (Vercel Serverless)
// Front: js/asaas-payment.js → GET/POST /api/asaas-proxy
//
// Env:
//   ASAAS_API_KEY (fallback)
//   ASAAS_API_KEY_SANDBOX | ASAAS_API_KEY_PRODUCTION (opcional, preferidos por ambiente)

const BASE_URLS = {
  sandbox: 'https://sandbox.asaas.com/api/v3',
  production: 'https://api.asaas.com/api/v3'
};

function stripKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (/^bearer\s+/i.test(s)) s = s.slice(7).trim();
  return s;
}

function pickKeyForEnv(envNorm) {
  const fallback = stripKey(process.env.ASAAS_API_KEY || '');
  const sand = stripKey(process.env.ASAAS_API_KEY_SANDBOX || '') || fallback;
  const prod = stripKey(process.env.ASAAS_API_KEY_PRODUCTION || '') || fallback;
  return envNorm === 'production' ? prod : sand;
}

function normalizeEnv(environment) {
  if (environment == null || environment === '') return 'sandbox';
  let s = String(environment).trim().toLowerCase();
  if (s === 'production' || s === 'prod') return 'production';
  return 'sandbox';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const sand = pickKeyForEnv('sandbox');
    const prod = pickKeyForEnv('production');
    const configured = !!(sand || prod);
    res.status(200).json({ ok: true, configured: configured });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const endpoint = String(body.endpoint || '').trim();
    const method = String(body.method || 'GET').toUpperCase();
    const envNorm = normalizeEnv(body.environment);
    const apiKey = pickKeyForEnv(envNorm);

    if (!apiKey) {
      res.status(503).json({ error: 'ASAAS_API_KEY not configured', configured: false });
      return;
    }
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }

    const base = BASE_URLS[envNorm];
    const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = base + path;

    const m = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) >= 0 ? method : 'GET';
    const opts = {
      method: m,
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey
      }
    };

    if ((m === 'POST' || m === 'PUT' || m === 'PATCH') && body.body != null && body.body !== '') {
      opts.body = typeof body.body === 'string' ? body.body : JSON.stringify(body.body);
    }

    const asaasRes = await fetch(url, opts);
    const text = await asaasRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { _raw: text };
    }

    res.status(asaasRes.status >= 100 && asaasRes.status < 600 ? asaasRes.status : 502).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};
