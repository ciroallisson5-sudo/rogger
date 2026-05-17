'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] != null) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function createVercelRes(nodeRes) {
  const api = {
    statusCode: 200,
    setHeader: function (k, v) {
      nodeRes.setHeader(k, v);
      return api;
    },
    status: function (code) {
      api.statusCode = code;
      return api;
    },
    json: function (obj) {
      if (nodeRes.headersSent) return;
      nodeRes.statusCode = api.statusCode;
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
      nodeRes.end(JSON.stringify(obj));
    },
    end: function (data) {
      if (nodeRes.headersSent) return;
      nodeRes.statusCode = api.statusCode;
      nodeRes.end(data == null ? '' : data);
    }
  };
  return api;
}

function resolveApiModule(urlPath) {
  const aliases = {
    '/api/openai-chat': 'openai-chat',
    '/api/gerar-3d': 'gerar-3d',
    '/api/admin-ai-assistant': 'admin-ai-assistant'
  };
  let name = aliases[urlPath];
  if (!name) {
    const base = path.basename(urlPath).replace(/\.js$/, '');
    if (urlPath.startsWith('/api/') && base) name = base;
  }
  if (!name) return null;
  const file = path.join(ROOT, 'api', name + '.js');
  return fs.existsSync(file) ? file : null;
}

async function handleApi(urlPath, req, res) {
  const modulePath = resolveApiModule(urlPath);
  if (!modulePath) return false;

  delete require.cache[require.resolve(modulePath)];
  const handler = require(modulePath);
  const body = await readBody(req);
  const vercelReq = {
    method: req.method,
    headers: req.headers,
    body: body,
    query: {}
  };
  const vercelRes = createVercelRes(res);
  await handler(vercelReq, vercelRes);
  return true;
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(ROOT, normalized);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

function serveStatic(urlPath, res) {
  let filePath = safePath(urlPath);
  if (!filePath) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const index = path.join(filePath, 'index.html');
      if (fs.existsSync(index)) filePath = index;
      else {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
    }
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

loadEnvFile();

const server = http.createServer(async function (req, res) {
  const urlPath = (req.url || '/').split('?')[0] || '/';

  if (urlPath.startsWith('/api/')) {
    try {
      const handled = await handleApi(urlPath, req, res);
      if (handled) return;
    } catch (err) {
      console.error('[dev-server] API error', urlPath, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: err.message || 'Internal error' }));
      }
      return;
    }
  }

  const staticPath = urlPath === '/' ? '/index.html' : urlPath;
  serveStatic(staticPath, res);
});

server.listen(PORT, function () {
  const hasMp = !!(process.env.MERCADO_PAGO_ACCESS_TOKEN && process.env.APP_URL);
  console.log('Conforta dev server: http://localhost:' + PORT);
  console.log(
    'API routes: /api/mercadopago-create-preference, /api/mercadopago-webhook, /api/mercadopago-payment-status, /api/openai-chat, /api/gerar-3d, /api/cep-freight, /api/admin-delivery-ceps, /api/admin-ai-assistant, /api/n8n-products'
  );
  if (!hasMp) {
    console.warn('AVISO: MERCADO_PAGO_ACCESS_TOKEN ou APP_URL ausentes — checkout Mercado Pago nao funcionara ate configurar .env');
  }
});
