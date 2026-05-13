// Conforta Store - Asaas API Proxy (Vercel Serverless Function)
// Deploy as: /api/asaas-proxy.js on Vercel
// Environment variable: ASAAS_API_KEY

const BASE_URLS = {
  sandbox: 'https://sandbox.asaas.com/api/v3',
  production: 'https://api.asaas.com/v3'
};

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Probe leve usado pelo front para saber se o proxy esta configurado
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, configured: !!process.env.ASAAS_API_KEY });
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

    // A chave SEMPRE vem do ambiente do servidor. Nunca do cliente.
    const asaasKey = process.env.ASAAS_API_KEY;
    if (!asaasKey) {
      res.status(503).json({ error: 'Asaas API Key not configured on server' });
      return;
    }

    const baseUrl = BASE_URLS[environment || 'sandbox'] || BASE_URLS.sandbox;
    const url = baseUrl + endpoint;

    const fetchOptions = {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'access_token': asaasKey
      }
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data.errors?.[0]?.description || 'Asaas API error',
        details: data
      });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
