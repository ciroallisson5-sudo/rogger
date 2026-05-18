'use strict';

/**
 * CORS com allowlist (sem "*" em rotas sensíveis ao browser).
 * Rotas só servidor (webhook) não chamam applyBrowserCors.
 */
function parseAllowedOrigins() {
  const raw =
    process.env.ALLOWED_ORIGINS ||
    process.env.APP_URL ||
    process.env.SITE_URL ||
    process.env.SITE_PUBLIC_URL ||
    '';
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

/**
 * Corpo JSON em POST (Vercel costuma preencher req.body; em alguns runtimes vem vazio até ler o stream).
 */
function readJsonBody(req) {
  return new Promise(function (resolve) {
    if (req.body !== undefined && req.body !== null) {
      resolve(parseBody(req.body));
      return;
    }
    if (!req || typeof req.on !== 'function') {
      resolve({});
      return;
    }
    const chunks = [];
    req.on('data', function (c) {
      chunks.push(c);
    });
    req.on('end', function () {
      try {
        resolve(parseBody(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', function () {
      resolve({});
    });
  });
}

module.exports = {
  parseAllowedOrigins,
  applyBrowserCors,
  handleOptions,
  parseBody,
  readJsonBody
};
