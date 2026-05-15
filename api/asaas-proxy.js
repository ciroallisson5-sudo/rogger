// Conforta Store — proxy Asaas (Vercel Serverless)
// Front: js/asaas-payment.js → GET/POST /api/asaas-proxy
//
// Env:
//   ASAAS_API_KEY (fallback)
//   ASAAS_API_KEY_SANDBOX | ASAAS_API_KEY_PRODUCTION (opcional, preferidos por ambiente)

// URLs oficiais Asaas v3 (docs.asaas.com)
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
    let raw = req.body;
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    let body = {};
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw || '{}');
      } catch (_) {
        res.status(400).json({ error: 'JSON invalido no corpo da requisicao' });
        return;
      }
    } else if (raw && typeof raw === 'object') {
      body = raw;
    }
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
        'User-Agent': 'conforta-store/1.0',
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

    if (!asaasRes.ok && data && typeof data === 'object' && !data.message && !data.error) {
      if (Array.isArray(data.errors) && data.errors.length) {
        data.message = data.errors
          .map(function (e) {
            return e.description || e.code || '';
          })
          .filter(Boolean)
          .join('; ');
      }
    }

    res.status(asaasRes.status >= 100 && asaasRes.status < 600 ? asaasRes.status : 502).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
};
