'use strict';

/** Rate limit simples em memória (adequado a serverless com tráfego baixo/médio). */
const buckets = new Map();

function rateLimitKey(req, prefix) {
  const xf = (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
  const ip = String(xf).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  return prefix + ':' + ip;
}

/**
 * @returns {boolean} true se permitido
 */
function allow(key, maxPerWindow, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > maxPerWindow) return false;
  return true;
}

function prune() {
  if (buckets.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now - v.start > 3600000) buckets.delete(k);
  }
}

module.exports = {
  rateLimitKey,
  allow,
  prune
};
