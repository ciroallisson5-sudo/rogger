// Conforta Store — Image-to-3D (Tripo) + Supabase Storage (Vercel Serverless)
//
// Env:
//   TRIPO_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Opcional: SUPABASE_IMAGE_BUCKET (default public), SUPABASE_IMAGE_KEY_PREFIX (default imagens),
//   SUPABASE_MODEL_BUCKET (default modelos-3d), TRIPO_BASE_URL, TRIPO_MODEL_VERSION
//
// GET ?productId=uuid + Authorization Bearer (admin) → { hasGlb }
// GET sem productId → { configured }
// POST phases: create | poll (Authorization Bearer admin JWT)

const TRIPO_DEFAULT_BASE = 'https://api.tripo3d.ai/v2/openapi';

const TERMINAL_TRIPO = new Set(['success', 'failed', 'cancelled', 'banned', 'expired']);

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

function extractGlbUrl(taskData) {
  const out = taskData && taskData.output;
  if (!out || typeof out !== 'object') return '';
  return String(out.model || out.glb || out.model_url || '').trim();
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const productIdCheck = getQueryParam(req, 'productId');
    const jwt = getBearer(req);

    if (productIdCheck) {
      if (!jwt) {
        res.status(401).json({ error: 'Authorization Bearer obrigatorio' });
        return;
      }
      let admin;
      try {
        admin = await verifySupabaseAdmin(jwt);
      } catch (e) {
        res.status(500).json({ error: e.message || 'Erro ao validar admin' });
        return;
      }
      if (!admin) {
        res.status(403).json({ error: 'Acesso negado (apenas admin)' });
        return;
      }
      const modelBucket = process.env.SUPABASE_MODEL_BUCKET || 'modelos-3d';
      const glbPublic = publicObjectUrl(modelBucket, productIdCheck + '.glb');
      try {
        const headRes = await fetch(glbPublic, { method: 'HEAD', redirect: 'follow' });
        res.status(200).json({
          ok: true,
          productId: productIdCheck,
          hasGlb: headRes.ok
        });
      } catch (_) {
        res.status(200).json({ ok: true, productId: productIdCheck, hasGlb: false });
      }
      return;
    }

    const configured = !!(
      process.env.TRIPO_API_KEY &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    res.status(200).json({ ok: true, configured: configured });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const jwt = getBearer(req);
  if (!jwt) {
    res.status(401).json({ error: 'Authorization Bearer obrigatorio' });
    return;
  }

  let admin;
  try {
    admin = await verifySupabaseAdmin(jwt);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Erro ao validar admin' });
    return;
  }
  if (!admin) {
    res.status(403).json({ error: 'Acesso negado (apenas admin)' });
    return;
  }

  const body = parseBody(req);
  const phase = String(body.phase || 'create').toLowerCase();
  const productId = String(body.productId || '').trim();

  if (!productId) {
    res.status(400).json({ error: 'productId obrigatorio' });
    return;
  }

  try {
    if (phase === 'create') {
      let imageUrl = String(body.imageUrl || '').trim();
      if (!imageUrl || !/^https:\/\//i.test(imageUrl)) {
        res.status(400).json({ error: 'imageUrl https obrigatoria na fase create' });
        return;
      }
      imageUrl = await ensureImageOnServer(productId, imageUrl);
      const tripTaskId = await tripoCreateTask(imageUrl);
      res.status(200).json({
        ok: true,
        phase: 'create',
        tripTaskId: tripTaskId,
        standardizedImageUrl: imageUrl
      });
      return;
    }

    if (phase === 'poll') {
      const tripTaskId = String(body.tripTaskId || '').trim();
      if (!tripTaskId) {
        res.status(400).json({ error: 'tripTaskId obrigatorio na fase poll' });
        return;
      }

      const taskData = await tripoGetTask(tripTaskId);
      const status = String((taskData && taskData.status) || '').toLowerCase();

      if (!TERMINAL_TRIPO.has(status)) {
        res.status(200).json({
          ok: true,
          done: false,
          tripoStatus: status,
          progress: taskData.progress
        });
        return;
      }

      if (status !== 'success') {
        res.status(200).json({
          ok: false,
          done: true,
          tripoStatus: status,
          error: (taskData && taskData.error) || 'Tarefa Tripo nao concluida com sucesso'
        });
        return;
      }

      const glbUrl = extractGlbUrl(taskData);
      if (!glbUrl) {
        res.status(502).json({ error: 'Tripo nao retornou URL do modelo (.glb)' });
        return;
      }

      const glbRes = await fetch(glbUrl);
      if (!glbRes.ok) {
        res.status(502).json({ error: 'Falha ao baixar GLB da Tripo' });
        return;
      }
      const glbBuf = Buffer.from(await glbRes.arrayBuffer());
      const modelBucket = process.env.SUPABASE_MODEL_BUCKET || 'modelos-3d';
      const objectPath = productId + '.glb';
      await supabaseStorageUpload(modelBucket, objectPath, glbBuf, 'model/gltf-binary');

      const glbPublicUrl = publicObjectUrl(modelBucket, objectPath);
      res.status(200).json({
        ok: true,
        done: true,
        tripoStatus: status,
        glbPublicUrl: glbPublicUrl
      });
      return;
    }

    res.status(400).json({ error: 'phase invalida (use create ou poll)' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
};
