// Conforta Store — Image-to-3D (Tripo) + Supabase Storage (Vercel Serverless)
//
// Env:
//   TRIPO_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Opcional: SUPABASE_IMAGE_BUCKET (default public), SUPABASE_IMAGE_KEY_PREFIX (default imagens),
//   SUPABASE_MODEL_BUCKET (default modelos-3d), TRIPO_BASE_URL, TRIPO_MODEL_VERSION
//   TRIPO_SKIP_IMAGE_MIRROR=1 — nunca reenvia a imagem ao Storage; usa imageUrl direto na Tripo
// POST create: useDirectImageUrl: true — mesmo efeito pontual (URLs assinadas/expiráveis: prefira mirror)
//
// GET ?productId=uuid + Authorization Bearer (admin) → { hasGlb }
// GET sem productId → { configured }
// POST phases: create | poll (Authorization Bearer admin JWT)

const TRIPO_DEFAULT_BASE = 'https://api.tripo3d.ai/v2/openapi';

const TERMINAL_TRIPO = new Set(['success', 'failed', 'cancelled', 'banned', 'expired']);

/** Resposta JSON sem depender de res.status()/res.json() (compatível com Node puro na Vercel). */
function sendJson(res, statusCode, payload) {
  try {
    const body = JSON.stringify(payload);
    res.statusCode = statusCode;
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(body);
  } catch (_) {
    try {
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end('{}');
      }
    } catch (__) { /* ignore */ }
  }
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch (_) {
      return {};
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function getBearer(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string') return '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function getQueryParam(req, name) {
  const q = req.query && req.query[name];
  if (q != null && String(q).trim()) return String(q).trim();
  try {
    const raw = req.url || '/';
    const u = new URL(raw, 'http://localhost');
    const v = u.searchParams.get(name);
    return v ? String(v).trim() : '';
  } catch (_) {
    return '';
  }
}

async function verifySupabaseAdmin(jwt) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !anon || !service) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios');
  }

  const userRes = await fetch(base + '/auth/v1/user', {
    headers: {
      Authorization: 'Bearer ' + jwt,
      apikey: anon
    }
  });
  if (!userRes.ok) return null;
  const userJson = await userRes.json().catch(function() { return {}; });
  const email = String((userJson && userJson.email) || '').toLowerCase();
  if (!email) return null;

  const rpcRes = await fetch(base + '/rest/v1/rpc/get_admin_emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + service,
      apikey: service,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: '{}'
  });
  const admins = await rpcRes.json().catch(function() { return []; });
  const list = Array.isArray(admins) ? admins : [];
  const ok = list.some(function(e) {
    return String(e || '').toLowerCase() === email;
  });
  return ok ? { email: email } : null;
}

function tripoUnwrap(json) {
  if (!json || typeof json !== 'object') return null;
  if (typeof json.code === 'number' && json.code !== 0) {
    const msg = json.message || json.msg || 'Tripo erro codigo ' + json.code;
    const err = new Error(msg);
    err.tripoCode = json.code;
    throw err;
  }
  return json.data !== undefined ? json.data : json;
}

async function tripoCreateTask(imageUrl) {
  const key = process.env.TRIPO_API_KEY;
  const base = (process.env.TRIPO_BASE_URL || TRIPO_DEFAULT_BASE).replace(/\/$/, '');
  if (!key) throw new Error('TRIPO_API_KEY nao configurada');

  const lower = String(imageUrl || '').toLowerCase();
  const fileType = lower.indexOf('.png') !== -1 || lower.indexOf('image/png') !== -1 ? 'png' : 'jpg';

  const body = {
    type: 'image_to_model',
    file: { type: fileType, url: String(imageUrl) },
    model_version: process.env.TRIPO_MODEL_VERSION || 'v2.5-20250123',
    texture: true,
    pbr: true
  };

  const res = await fetch(base + '/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    const msg = json.message || json.msg || json.error || 'Falha ao criar tarefa Tripo';
    throw new Error(msg);
  }
  const data = tripoUnwrap(json) || json;
  const taskId = (data && (data.task_id || data.taskId)) || json.task_id || json.taskId || '';
  if (!taskId) throw new Error('Tripo nao retornou task_id');
  return String(taskId);
}

async function tripoGetTask(taskId) {
  const key = process.env.TRIPO_API_KEY;
  const base = (process.env.TRIPO_BASE_URL || TRIPO_DEFAULT_BASE).replace(/\/$/, '');
  const res = await fetch(base + '/task/' + encodeURIComponent(taskId), {
    headers: { Authorization: 'Bearer ' + key }
  });
  const json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    const msg = json.message || json.msg || 'Falha ao consultar tarefa Tripo';
    throw new Error(msg);
  }
  const inner = tripoUnwrap(json) || json;
  return inner && typeof inner === 'object' ? inner : {};
}

function isLikelyModelUrl(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  if (/\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(t)) return false;
  if (/\.glb(\?|#|$)/i.test(t)) return true;
  if (/tripo3d\.ai/i.test(t)) return true;
  return false;
}

/** Tripo task.output: model, pbr_model, base_model; URLs assinadas muitas vezes sem sufixo .glb. */
function extractGlbUrl(taskData) {
  const out = taskData && taskData.output;
  if (!out || typeof out !== 'object') return '';

  const directKeys = [
    'model',
    'pbr_model',
    'base_model',
    'glb',
    'model_url',
    'pbr_model_url',
    'base_model_url',
    'download_url',
    'url',
    'result',
    'mesh',
    'geometry'
  ];
  for (let i = 0; i < directKeys.length; i++) {
    const v = out[directKeys[i]];
    if (typeof v === 'string' && isLikelyModelUrl(v)) return v.trim();
  }

  function walk(node, depth) {
    if (depth > 12 || node == null) return '';
    if (typeof node === 'string') return isLikelyModelUrl(node) ? node.trim() : '';
    if (Array.isArray(node)) {
      for (let j = 0; j < node.length; j++) {
        const u = walk(node[j], depth + 1);
        if (u) return u;
      }
      return '';
    }
    if (typeof node !== 'object') return '';
    const keys = Object.keys(node);
    for (let k = 0; k < keys.length; k++) {
      const u = walk(node[keys[k]], depth + 1);
      if (u) return u;
    }
    return '';
  }

  return walk(out, 0);
}

async function fetchGlbBinary(glbUrl) {
  const key = process.env.TRIPO_API_KEY || '';
  const headersTripo = {};
  if (key && /tripo3d\.ai/i.test(glbUrl)) {
    headersTripo.Authorization = 'Bearer ' + key;
  }
  let glbRes = await fetch(glbUrl, { headers: headersTripo, redirect: 'follow' });
  if (!glbRes.ok && key && /tripo3d\.ai/i.test(glbUrl)) {
    glbRes = await fetch(glbUrl, { redirect: 'follow' });
  }
  if (!glbRes.ok) {
    const err = new Error('Falha ao baixar GLB da Tripo (HTTP ' + glbRes.status + ')');
    err.httpStatus = glbRes.status;
    throw err;
  }
  return Buffer.from(await glbRes.arrayBuffer());
}

function encodeStorageObjectPath(objectPath) {
  return String(objectPath || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function supabaseStorageUpload(bucket, objectPath, bodyBuffer, contentType) {
  const supabaseBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const url =
    supabaseBase +
    '/storage/v1/object/' +
    encodeURIComponent(bucket) +
    '/' +
    encodeStorageObjectPath(objectPath);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + service,
      apikey: service,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: bodyBuffer
  });
  if (!res.ok) {
    const t = await res.text().catch(function() { return ''; });
    throw new Error('Storage upload falhou: ' + res.status + ' ' + t.slice(0, 200));
  }
}

function publicObjectUrl(bucket, objectPath) {
  const supabaseBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return (
    supabaseBase +
    '/storage/v1/object/public/' +
    encodeURIComponent(bucket) +
    '/' +
    encodeStorageObjectPath(objectPath)
  );
}

async function ensureImageOnServer(productId, imageUrl) {
  const imgBucket = process.env.SUPABASE_IMAGE_BUCKET || 'public';
  const prefix = (process.env.SUPABASE_IMAGE_KEY_PREFIX || 'imagens').replace(/^\/+|\/+$/g, '');
  const objectPath = (prefix ? prefix + '/' : '') + productId + '.jpg';

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error('Nao foi possivel baixar a imagem do produto');
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || 'image/jpeg';
  await supabaseStorageUpload(imgBucket, objectPath, buf, ct);
  return publicObjectUrl(imgBucket, objectPath);
}

function envFlagTruthy(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Fotos já em /storage/v1/object/public/... no mesmo SUPABASE_URL são públicas e estáveis:
 * envia direto para a Tripo sem baixar e gravar de novo em imagens/{id}.jpg.
 */
function shouldUseDirectImageUrl(imageUrl, body) {
  if (body && (body.useDirectImageUrl === true || body.useDirectImageUrl === 'true' || body.useDirectImageUrl === 1)) {
    return true;
  }
  if (body && (body.directImage === true || body.directImage === 'true' || body.directImage === 1)) {
    return true;
  }
  if (envFlagTruthy('TRIPO_SKIP_IMAGE_MIRROR')) return true;

  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !imageUrl) return false;
  try {
    const u = new URL(imageUrl);
    const b = new URL(base);
    if (u.origin !== b.origin) return false;
    return /\/storage\/v1\/object\/public\//i.test(u.pathname || '');
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET') {
      const productIdCheck = getQueryParam(req, 'productId');
      const jwt = getBearer(req);

      if (productIdCheck) {
        if (!jwt) {
          sendJson(res, 401, { error: 'Authorization Bearer obrigatorio' });
          return;
        }
        let admin;
        try {
          admin = await verifySupabaseAdmin(jwt);
        } catch (e) {
          sendJson(res, 500, { error: e.message || 'Erro ao validar admin' });
          return;
        }
        if (!admin) {
          sendJson(res, 403, { error: 'Acesso negado (apenas admin)' });
          return;
        }
        const modelBucket = process.env.SUPABASE_MODEL_BUCKET || 'modelos-3d';
        const glbPublic = publicObjectUrl(modelBucket, productIdCheck + '.glb');
        try {
          const headRes = await fetch(glbPublic, { method: 'HEAD', redirect: 'follow' });
          sendJson(res, 200, {
            ok: true,
            productId: productIdCheck,
            hasGlb: headRes.ok
          });
        } catch (_) {
          sendJson(res, 200, { ok: true, productId: productIdCheck, hasGlb: false });
        }
        return;
      }

      const configured = !!(
        process.env.TRIPO_API_KEY &&
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_ANON_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      sendJson(res, 200, { ok: true, configured: configured });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const jwt = getBearer(req);
    if (!jwt) {
      sendJson(res, 401, { error: 'Authorization Bearer obrigatorio' });
      return;
    }

    let admin;
    try {
      admin = await verifySupabaseAdmin(jwt);
    } catch (e) {
      sendJson(res, 500, { error: e.message || 'Erro ao validar admin' });
      return;
    }
    if (!admin) {
      sendJson(res, 403, { error: 'Acesso negado (apenas admin)' });
      return;
    }

    const body = parseBody(req);
    const phase = String(body.phase || 'create').toLowerCase();
    const productId = String(body.productId || '').trim();

    if (!productId) {
      sendJson(res, 400, { error: 'productId obrigatorio' });
      return;
    }

    if (phase === 'create') {
      let imageUrl = String(body.imageUrl || '').trim();
      if (!imageUrl || !/^https:\/\//i.test(imageUrl)) {
        sendJson(res, 400, { error: 'imageUrl https obrigatoria na fase create' });
        return;
      }
      const direct = shouldUseDirectImageUrl(imageUrl, body);
      if (!direct) {
        imageUrl = await ensureImageOnServer(productId, imageUrl);
      }
      const tripTaskId = await tripoCreateTask(imageUrl);
      sendJson(res, 200, {
        ok: true,
        phase: 'create',
        tripTaskId: tripTaskId,
        standardizedImageUrl: imageUrl,
        imageSource: direct ? 'direct' : 'mirrored'
      });
      return;
    }

    if (phase === 'poll') {
      const tripTaskId = String(body.tripTaskId || '').trim();
      if (!tripTaskId) {
        sendJson(res, 400, { error: 'tripTaskId obrigatorio na fase poll' });
        return;
      }

      const taskData = await tripoGetTask(tripTaskId);
      const status = String((taskData && taskData.status) || '').toLowerCase();

      if (!TERMINAL_TRIPO.has(status)) {
        sendJson(res, 200, {
          ok: true,
          done: false,
          tripoStatus: status,
          progress: taskData.progress
        });
        return;
      }

      if (status !== 'success') {
        sendJson(res, 200, {
          ok: false,
          done: true,
          tripoStatus: status,
          error: (taskData && taskData.error) || 'Tarefa Tripo nao concluida com sucesso'
        });
        return;
      }

      const glbUrl = extractGlbUrl(taskData);
      if (!glbUrl) {
        const out = taskData && taskData.output;
        sendJson(res, 200, {
          ok: false,
          done: true,
          tripoStatus: status,
          error: 'Tripo nao retornou URL do modelo (.glb) no JSON da tarefa.',
          outputKeys: out && typeof out === 'object' ? Object.keys(out) : []
        });
        return;
      }

      let glbBuf;
      try {
        glbBuf = await fetchGlbBinary(glbUrl);
      } catch (fetchErr) {
        let host = '';
        try {
          host = new URL(glbUrl).host;
        } catch (_) { /* ignore */ }
        sendJson(res, 200, {
          ok: false,
          done: true,
          tripoStatus: status,
          error: fetchErr.message || 'Falha ao baixar GLB da Tripo',
          glbUrlHost: host
        });
        return;
      }

      const modelBucket = process.env.SUPABASE_MODEL_BUCKET || 'modelos-3d';
      const objectPath = productId + '.glb';
      await supabaseStorageUpload(modelBucket, objectPath, glbBuf, 'model/gltf-binary');

      const glbPublicUrl = publicObjectUrl(modelBucket, objectPath);
      sendJson(res, 200, {
        ok: true,
        done: true,
        tripoStatus: status,
        glbPublicUrl: glbPublicUrl
      });
      return;
    }

    sendJson(res, 400, { error: 'phase invalida (use create ou poll)' });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Erro interno' });
  }
};
