// Conforta Store — integração Asaas (Vercel Serverless)
// Variáveis na Vercel (ou .env.local com vercel dev):
//   ASAAS_API_KEY | ASAAS_API_KEY_SANDBOX | ASAAS_API_KEY_PRODUCTION
// O front envia environment: "sandbox" | "production".

const BASE_URLS = {
  sandbox: 'https://sandbox.asaas.com/api/v3',
  production: 'https://api.asaas.com/v3'
};

function stripAsaasKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (/^bearer\s+/i.test(s)) s = s.slice(7).trim();
  return s;
}

function normalizeEnv(environment) {
  if (environment == null || environment === '') return 'sandbox';
  let s = String(environment).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.toLowerCase();
  if (s === 'production' || s === 'prod') return 'production';
  return 'sandbox';
}

function pickKeyForEnv(envNorm) {
  const fallback = stripAsaasKey(process.env.ASAAS_API_KEY || '');
  const sand = stripAsaasKey(process.env.ASAAS_API_KEY_SANDBOX || '') || fallback;
  const prod = stripAsaasKey(process.env.ASAAS_API_KEY_PRODUCTION || '') || fallback;
  return envNorm === 'production' ? prod : sand;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const fallback = stripAsaasKey(process.env.ASAAS_API_KEY || '');
  const hasSand = stripAsaasKey(process.env.ASAAS_API_KEY_SANDBOX || '').length > 0;
  const hasProd = stripAsaasKey(process.env.ASAAS_API_KEY_PRODUCTION || '').length > 0;
  const configured = hasSand || hasProd || fallback.length > 0;

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      configured,
      hasSandboxKey: hasSand || !!fallback,
      hasProductionKey: hasProd || !!fallback
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { endpoint, method, body, environment } = (typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {}));

    if (!endpoint) {
      res.status(400).json({ error: 'Endpoint is required' });
      return;
    }

    const envNorm = normalizeEnv(environment);
    const asaasKey = pickKeyForEnv(envNorm);

    if (!asaasKey) {
      res.status(503).json({
        error: 'Pagamento nao configurado no servidor para este ambiente.',
        env: envNorm
      });
      return;
    }

    const baseUrl = BASE_URLS[envNorm];
    const url = baseUrl + endpoint;

    const fetchOptions = {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        access_token: asaasKey
      }
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }

    console.log('[conforta-asaas]', envNorm, endpoint, method || 'GET', response.status);

    if (!response.ok) {
      res.status(response.status).json({
        error: data.errors?.[0]?.description || data.error || 'Erro ao processar pagamento',
        status: response.status
      });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
