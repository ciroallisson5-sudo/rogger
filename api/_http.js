'use strict';

/**
 * CORS com allowlist (sem "*" em rotas sensíveis ao browser).
 * Rotas só servidor (webhook) não chamam applyBrowserCors.
 */
function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.APP_URL || '';
  return raw
    .split(/[,;\s]+/)
    .map(function (s) {
      return String(s || '')
        .trim()
        .replace(/\/$/, '');
    })
    .filter(Boolean);
}

function applyBrowserCors(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  const list = parseAllowedOrigins();
  if (origin && list.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key, x-n8n-products-secret, x-openai-route-secret, X-Openai-Route-Secret, X-N8n-Products-Secret');
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    applyBrowserCors(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}

function parseBody(raw) {
  if (raw == null) return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw.trim() || '{}');
    } catch (_) {
      return {};
    }
  }
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  return {};
}

module.exports = {
  parseAllowedOrigins,
  applyBrowserCors,
  handleOptions,
  parseBody
};
