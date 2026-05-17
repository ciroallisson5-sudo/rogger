'use strict';

/**
 * Assistente IA só para administradores (painel).
 * POST { mode: "plan" | "execute", ... }
 *
 * plan: { message, messages?, image_base64?, image_mime? } → { reply, actions }
 * execute: { actions: [...], image_base64?, image_mime?, attach_image_to? }
 *   - Opcional: envia a mesma imagem do plano → upload bucket `public/imagens/ai-assistant/*` + insert em product_photos.
 *   - attach_image_to: uuid do produto | omitir → usa ultimo insert do lote ou unico update_product.
 */

const { randomUUID } = require('crypto');
const { verifySupabaseAdmin } = require('./_supabase-admin');
const { applyBrowserCors, handleOptions } = require('./_http');
const { rateLimitKey, allow, prune } = require('./_rate-limit');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_B64 = 3 * 1024 * 1024; // ~2.2MB binário em base64

const PRODUCT_KEYS = [
  'name',
  'slug',
  'description',
  'category_id',
  'base_price',
  'discount_price',
  'stock',
  'tags',
  'featured',
  'active',
  'material',
  'dimensions',
  'weight',
  'warranty',
  'seo_title',
  'seo_description'
];

function parseBody(raw) {
  if (raw == null) return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '{}');
    } catch (_) {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function verifyAdminWithDevFallback(jwt) {
  let adminOk = jwt && (await verifySupabaseAdmin(jwt));
  if (!adminOk) {
    const dev = (process.env.ADMIN_EMAIL_ALLOW || '').trim();
    if (dev && jwt) {
      const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
      const anon = process.env.SUPABASE_ANON_KEY || '';
      if (base && anon) {
        try {
          const userRes = await fetch(base + '/auth/v1/user', {
            headers: { Authorization: 'Bearer ' + jwt, apikey: anon }
          });
          const u = await userRes.json().catch(function () {
            return {};
          });
          if (userRes.ok && String((u.email || '').toLowerCase()) === dev.toLowerCase()) adminOk = true;
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
  return !!adminOk;
}

function slugifyName(name) {
  return String(name || 'produto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'produto';
}

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

function pickProductPatch(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (let i = 0; i < PRODUCT_KEYS.length; i++) {
    const k = PRODUCT_KEYS[i];
    if (obj[k] === undefined) continue;
    out[k] = obj[k];
  }
  if (Object.keys(out).length === 0) return null;
  if (out.name != null) out.name = String(out.name).trim().slice(0, 500);
  if (out.slug != null) out.slug = String(out.slug).trim().toLowerCase().slice(0, 120);
  if (out.description != null) out.description = String(out.description).slice(0, 20000);
  if (out.seo_title != null) out.seo_title = String(out.seo_title).slice(0, 200);
  if (out.seo_description != null) out.seo_description = String(out.seo_description).slice(0, 500);
  if (out.material != null) out.material = String(out.material).slice(0, 500);
  if (out.dimensions != null) out.dimensions = String(out.dimensions).slice(0, 200);
  if (out.warranty != null) out.warranty = String(out.warranty).slice(0, 200);
  if (out.category_id != null && out.category_id !== '' && !isUuid(out.category_id)) delete out.category_id;
  if (out.category_id === '') out.category_id = null;
  if (out.base_price != null) out.base_price = Math.max(0, parseFloat(out.base_price)) || 0;
  if (out.discount_price !== undefined) {
    if (out.discount_price === null || out.discount_price === '') out.discount_price = null;
    else {
      const d = parseFloat(out.discount_price);
      out.discount_price = isNaN(d) ? null : d;
    }
  }
  if (out.stock != null) out.stock = Math.max(0, parseInt(out.stock, 10) || 0);
  if (out.weight !== undefined) {
    if (out.weight === null || out.weight === '') out.weight = null;
    else {
      const w = parseFloat(out.weight);
      out.weight = isNaN(w) ? null : w;
    }
  }
  if (out.tags != null) {
    if (!Array.isArray(out.tags)) out.tags = String(out.tags).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    out.tags = out.tags.map(function (t) { return String(t).slice(0, 80); }).slice(0, 40);
  }
  if (out.featured != null) out.featured = !!out.featured;
  if (out.active != null) out.active = !!out.active;
  return out;
}

function pickProductRow(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (let i = 0; i < PRODUCT_KEYS.length; i++) {
    const k = PRODUCT_KEYS[i];
    if (obj[k] === undefined) continue;
    out[k] = obj[k];
  }
  if (!out.name || String(out.name).trim() === '') return null;
  out.name = String(out.name).trim().slice(0, 500);
  if (out.slug != null) out.slug = String(out.slug).trim().toLowerCase().slice(0, 120);
  if (out.description != null) out.description = String(out.description).slice(0, 20000);
  if (out.seo_title != null) out.seo_title = String(out.seo_title).slice(0, 200);
  if (out.seo_description != null) out.seo_description = String(out.seo_description).slice(0, 500);
  if (out.material != null) out.material = String(out.material).slice(0, 500);
  if (out.dimensions != null) out.dimensions = String(out.dimensions).slice(0, 200);
  if (out.warranty != null) out.warranty = String(out.warranty).slice(0, 200);
  if (out.category_id != null && out.category_id !== '' && !isUuid(out.category_id)) delete out.category_id;
  if (out.category_id === '') out.category_id = null;
  if (out.base_price != null) out.base_price = Math.max(0, parseFloat(out.base_price)) || 0;
  if (out.discount_price != null && out.discount_price !== '') {
    const d = parseFloat(out.discount_price);
    out.discount_price = isNaN(d) ? null : d;
  } else if (out.discount_price === '' || out.discount_price === undefined) {
    /* keep */
  }
  if (out.stock != null) out.stock = Math.max(0, parseInt(out.stock, 10) || 0);
  if (out.weight != null && out.weight !== '') {
    const w = parseFloat(out.weight);
    out.weight = isNaN(w) ? null : w;
  }
  if (out.tags != null) {
    if (!Array.isArray(out.tags)) out.tags = String(out.tags).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    out.tags = out.tags.map(function (t) { return String(t).slice(0, 80); }).slice(0, 40);
  }
  if (out.featured != null) out.featured = !!out.featured;
  if (out.active != null) out.active = !!out.active;
  if (!out.slug) out.slug = slugifyName(out.name);
  return out;
}

function validPhotoUrl(url) {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith('https://')) return false;
  if (/[\s<>\"]/.test(u)) return false;
  return u.length < 2000;
}

async function supabaseRest(method, path, body) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const url = base + path;
  const headers = {
    apikey: svc,
    Authorization: 'Bearer ' + svc,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const opt = { method: method, headers: headers };
  if (body != null && method !== 'GET' && method !== 'HEAD') opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json: json };
}

async function fetchAdminContext() {
  const cats = await supabaseRest('GET', '/rest/v1/categories?select=id,name,slug&order=name.asc&limit=200', null);
  const prods = await supabaseRest(
    'GET',
    '/rest/v1/products?select=id,name,slug,base_price,stock,active&order=updated_at.desc&limit=100',
    null
  );
  const categories = cats.ok && Array.isArray(cats.json) ? cats.json : [];
  const products = prods.ok && Array.isArray(prods.json) ? prods.json : [];
  return { categories, products };
}

function buildPlannerSystem(ctx) {
  const catLines = ctx.categories.map(function (c) {
    return '- id: ' + c.id + ' | nome: ' + (c.name || '') + ' | slug: ' + (c.slug || '');
  });
  const prodLines = ctx.products.map(function (p) {
    return '- id: ' + p.id + ' | ' + (p.name || '') + ' | slug: ' + (p.slug || '') + ' | R$' + (p.base_price != null ? p.base_price : '?');
  });
  return (
    'Voce e assistente do painel administrativo (Conforta). Seja RAPIDO e LOGICO.\n\n' +
    'Raciocinio (curto, mental — nao escreva passo a passo no JSON):\n' +
    '1) Qual a intencao? (criar produto / atualizar / tirar duvida)\n' +
    '2) Quais dados sao CERTOS na mensagem ou imagem vs inferencia fraca? Na reply, 1 linha sobre lacunas se houver.\n' +
    '3) Monte o minimo de actions necessarias. Prefira patch pequeno a reescrever tudo.\n\n' +
    'Responda SOMENTE JSON valido (sem markdown) no formato:\n' +
    '{"reply":"pt-BR: resumo CURTO (ate ~8 linhas). Seja direto.","actions":[]}\n\n' +
    'actions: vazio se for so orientacao. Objetos permitidos:\n' +
    '1) {"type":"insert_product","product":{...}}\n' +
    '2) {"type":"update_product","id":"<uuid>","patch":{...}}\n' +
    '3) {"type":"insert_product_photo",...} — SO se existir URL https REAL na mensagem do usuario. ' +
    'NUNCA invente URL. Se o usuario anexou foto da vitrine mas nao ha URL publica, OMITA insert_product_photo; o painel envia a foto ao clicar Aplicar.\n\n' +
    'Regras:\n' +
    '- category_id: um UUID da lista abaixo ou null.\n' +
    '- update: use id exato da lista de produtos.\n' +
    '- Precos em reais (numero). tags = array de strings.\n' +
    '- insert_product seguido de foto do MESMO item sem URL: omita insert_product_photo (upload separado no painel).\n' +
    '- Imagem anexada: extraia nome, descricao, preco, dimensoes/material quando LEGIVEL; nao alucine codigo de barras ou SKU se ilegivel.\n\n' +
    'Categorias:\n' +
    (catLines.length ? catLines.join('\n') : '(nenhuma)') +
    '\n\nProdutos (amostra recente):\n' +
    (prodLines.length ? prodLines.join('\n') : '(nenhum)')
  );
}

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (let i = 0; i < messages.length && out.length < 24; i++) {
    const m = messages[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const c = String(m.content || '').slice(0, 8000);
    if (!c.trim()) continue;
    out.push({ role: m.role, content: c });
  }
  return out;
}

async function openAiPlan(systemText, userText, imageB64, imageMime, history) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');

  const userParts = [];
  userParts.push({ type: 'text', text: String(userText || '').trim().slice(0, 12000) || 'O que posso fazer?' });
  if (imageB64 && imageMime) {
    const mime = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(imageMime) ? imageMime.toLowerCase().replace('jpg', 'jpeg') : 'image/jpeg';
    userParts.push({
      type: 'image_url',
      image_url: { url: 'data:' + mime + ';base64,' + imageB64 }
    });
  }

  const msgs = [{ role: 'system', content: systemText }];
  const hist = sanitizeHistory(history);
  for (let i = 0; i < hist.length; i++) msgs.push(hist[i]);
  const userContent =
    userParts.length === 1 ? userParts[0].text : userParts;
  msgs.push({ role: 'user', content: userContent });

  const model = process.env.OPENAI_ADMIN_ASSISTANT_MODEL || 'gpt-4o-mini';
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      temperature: 0.12,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: msgs
    })
  });
  const data = await res.json().catch(function () {
    return {};
  });
  if (!res.ok) {
    const err = (data.error && data.error.message) || JSON.stringify(data).slice(0, 400);
    throw new Error('OpenAI: ' + err);
  }
  const txt = (((data.choices || [])[0] || {}).message || {}).content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch (_) {
    parsed = { reply: txt, actions: [] };
  }
  const reply = typeof parsed.reply === 'string' ? parsed.reply : 'Sem resposta estruturada.';
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  return { reply: reply, actions: actions };
}

function validateActions(actions) {
  const clean = [];
  if (!Array.isArray(actions)) return clean;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!a || typeof a !== 'object') continue;
    const t = String(a.type || '').trim();
    if (t === 'insert_product') {
      const row = pickProductRow(a.product);
      if (row) clean.push({ type: 'insert_product', product: row });
    } else if (t === 'update_product' && isUuid(a.id)) {
      const patch = pickProductPatch(a.patch || {});
      if (patch && Object.keys(patch).length) clean.push({ type: 'update_product', id: a.id, patch: patch });
    } else if (t === 'insert_product_photo') {
      const url = a.url;
      if (!validPhotoUrl(url)) continue;
      const sort = parseInt(a.sort_order, 10);
      clean.push({
        type: 'insert_product_photo',
        product_id: a.product_id && isUuid(a.product_id) ? a.product_id : null,
        url: url.trim(),
        sort_order: isNaN(sort) ? 0 : Math.max(0, sort),
        alt_text: a.alt_text != null ? String(a.alt_text).slice(0, 500) : ''
      });
    }
  }
  return clean;
}

async function executeActions(actions) {
  const results = [];
  let lastInsertedProductId = null;
  const updatedProductIds = [];

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.type === 'insert_product') {
      const r = await supabaseRest('POST', '/rest/v1/products', a.product);
      if (!r.ok || !Array.isArray(r.json) || !r.json[0]) {
        results.push({
          ok: false,
          type: 'insert_product',
          error: (r.json && (r.json.message || r.json.error_description)) || 'insert falhou',
          status: r.status
        });
        lastInsertedProductId = null;
        continue;
      }
      lastInsertedProductId = r.json[0].id;
      results.push({ ok: true, type: 'insert_product', id: lastInsertedProductId });
    } else if (a.type === 'update_product') {
      const patch = pickProductPatch(a.patch || {});
      if (!patch || !Object.keys(patch).length) {
        results.push({ ok: false, type: 'update_product', id: a.id, error: 'patch vazio' });
        continue;
      }
      const r = await supabaseRest('PATCH', '/rest/v1/products?id=eq.' + encodeURIComponent(a.id), patch);
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'update_product',
          id: a.id,
          error: (r.json && (r.json.message || r.json.hint)) || 'update falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'update_product', id: a.id });
        updatedProductIds.push(a.id);
      }
    } else if (a.type === 'insert_product_photo') {
      const pid = a.product_id || lastInsertedProductId;
      if (!pid || !isUuid(pid)) {
        results.push({ ok: false, type: 'insert_product_photo', error: 'product_id invalido' });
        continue;
      }
      const row = {
        product_id: pid,
        url: a.url,
        sort_order: a.sort_order,
        alt_text: a.alt_text || '',
        is_video: false,
        active: true
      };
      const r = await supabaseRest('POST', '/rest/v1/product_photos', row);
      if (!r.ok || !Array.isArray(r.json) || !r.json[0]) {
        results.push({
          ok: false,
          type: 'insert_product_photo',
          error: (r.json && r.json.message) || 'insert foto falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'insert_product_photo', id: r.json[0].id, product_id: pid });
      }
    }
  }
  return { results: results, lastInsertedProductId: lastInsertedProductId, updatedProductIds: updatedProductIds };
}

function extFromImageMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('png') >= 0) return 'png';
  if (m.indexOf('webp') >= 0) return 'webp';
  if (m.indexOf('gif') >= 0) return 'gif';
  return 'jpg';
}

function normalizeExecuteImageB64(body) {
  const b64 = typeof body.image_base64 === 'string' ? body.image_base64.replace(/^data:image\/\w+;base64,/, '') : '';
  if (b64.length > MAX_B64) return { error: 'Imagem muito grande para executar.' };
  const mime = String(body.image_mime || 'image/jpeg').trim();
  const mimeOk = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime);
  return { b64: b64, mime: mimeOk ? mime.toLowerCase().replace('jpg', 'jpeg') : 'image/jpeg' };
}

function resolveAttachProductId(body, lastInsertedProductId, updatedProductIds) {
  const raw = body.attach_image_to;
  if (raw != null && String(raw).trim() !== '') {
    const str = String(raw).trim();
    if (isUuid(str)) return str;
    const s = str.toLowerCase();
    if (s === 'last_inserted' || s === 'last' || s === 'auto') {
      return lastInsertedProductId || null;
    }
  }
  if (lastInsertedProductId) return lastInsertedProductId;
  if (updatedProductIds && updatedProductIds.length === 1) return updatedProductIds[0];
  return null;
}

async function storageUploadProductImage(baseUrl, serviceKey, buffer, contentType) {
  const ext = extFromImageMime(contentType);
  const objectPath = 'imagens/ai-assistant/' + randomUUID() + '.' + ext;
  const uploadUrl = baseUrl + '/storage/v1/object/public/' + objectPath;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + serviceKey,
      apikey: serviceKey,
      'Content-Type': contentType || 'image/jpeg',
      'x-upsert': 'true'
    },
    body: buffer
  });
  const txt = await res.text().catch(function () {
    return '';
  });
  let j;
  try {
    j = txt ? JSON.parse(txt) : {};
  } catch (_) {
    j = { message: txt };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: (j && (j.message || j.error)) || 'upload storage falhou',
      status: res.status
    };
  }
  const publicUrl = baseUrl + '/storage/v1/object/public/' + objectPath;
  return { ok: true, publicUrl: publicUrl, objectPath: objectPath };
}

async function attachUploadedImageToProduct(baseUrl, serviceKey, productId, b64, mime) {
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch (_) {
    return { ok: false, type: 'storage_photo', error: 'Base64 invalido' };
  }
  if (!buffer || buffer.length < 32) {
    return { ok: false, type: 'storage_photo', error: 'Imagem vazia ou invalida' };
  }
  if (buffer.length > 4 * 1024 * 1024) {
    return { ok: false, type: 'storage_photo', error: 'Arquivo muito grande apos decode' };
  }
  const ct = /^image\/(jpeg|png|webp|gif)$/i.test(mime) ? mime.toLowerCase().replace('jpg', 'jpeg') : 'image/jpeg';
  const up = await storageUploadProductImage(baseUrl, serviceKey, buffer, ct);
  if (!up.ok) {
    return { ok: false, type: 'storage_photo', error: up.error, status: up.status };
  }
  const row = {
    product_id: productId,
    url: up.publicUrl,
    sort_order: 0,
    alt_text: 'Enviado pelo Assistente IA',
    is_video: false,
    active: true
  };
  const r = await supabaseRest('POST', '/rest/v1/product_photos', row);
  if (!r.ok || !Array.isArray(r.json) || !r.json[0]) {
    return {
      ok: false,
      type: 'storage_photo',
      error: (r.json && r.json.message) || 'insert product_photos falhou',
      product_id: productId,
      url: up.publicUrl
    };
  }
  return {
    ok: true,
    type: 'storage_photo',
    id: r.json[0].id,
    product_id: productId,
    url: up.publicUrl
  };
}

module.exports = async function handler(req, res) {
  prune();
  applyBrowserCors(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = String(req.headers.authorization || '').trim();
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!(await verifyAdminWithDevFallback(jwt))) {
    res.status(jwt ? 403 : 401).json({ error: 'Acesso restrito ao admin.' });
    return;
  }

  const body = parseBody(req.body);
  const mode = String(body.mode || 'plan').toLowerCase() === 'execute' ? 'execute' : 'plan';

  const key = rateLimitKey(req, 'admin-ai') + ':' + mode;
  if (!allow(key, mode === 'execute' ? 25 : 12, 60000)) {
    res.status(429).json({ error: 'Muitas requisicoes. Aguarde um minuto.' });
    return;
  }

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!svc || !base) {
    res.status(503).json({ error: 'Supabase service role nao configurado no servidor.' });
    return;
  }

  try {
    if (mode === 'execute') {
      const imgNorm = normalizeExecuteImageB64(body);
      if (imgNorm.error) {
        res.status(400).json({ error: imgNorm.error });
        return;
      }
      const hasImage = !!(imgNorm.b64 && String(imgNorm.b64).length);
      const raw = body.actions;
      const actionsList = Array.isArray(raw) ? validateActions(raw) : [];

      if (!actionsList.length && !hasImage) {
        if (Array.isArray(raw) && raw.length > 0) {
          res.status(400).json({ error: 'Nenhuma acao valida apos validacao. Revise o plano da IA.' });
        } else {
          res.status(400).json({
            error:
              'Envie actions (array) ou image_base64. Sem actions, use attach_image_to com UUID do produto para so anexar foto.'
          });
        }
        return;
      }
      if (actionsList.length > 15) {
        res.status(400).json({ error: 'No maximo 15 acoes por vez.' });
        return;
      }

      const execOut = await executeActions(actionsList);
      const allResults = execOut.results.slice();

      if (hasImage) {
        const pid = resolveAttachProductId(body, execOut.lastInsertedProductId, execOut.updatedProductIds);
        if (!pid) {
          allResults.push({
            ok: false,
            type: 'storage_photo',
            error:
              'Defina o produto da foto: inclua insert_product nesta execucao, ou um unico update_product, ou attach_image_to com UUID.'
          });
        } else {
          const ph = await attachUploadedImageToProduct(base, svc, pid, imgNorm.b64, imgNorm.mime);
          allResults.push(ph);
        }
      }

      res.status(200).json({ ok: true, results: allResults });
      return;
    }

    /* plan */
    const msg = String(body.message || '').trim();
    const b64 = typeof body.image_base64 === 'string' ? body.image_base64.replace(/^data:image\/\w+;base64,/, '') : '';
    if (b64.length > MAX_B64) {
      res.status(400).json({ error: 'Imagem muito grande. Use JPEG comprimido ou ate ~2MB.' });
      return;
    }
    const mime = String(body.image_mime || 'image/jpeg').trim();
    if (!msg && !b64) {
      res.status(400).json({ error: 'message ou image_base64 obrigatorio' });
      return;
    }

    const ctx = await fetchAdminContext();
    const systemText = buildPlannerSystem(ctx);
    const plan = await openAiPlan(systemText, msg || 'Analise a imagem e sugira dados do produto.', b64, b64 ? mime : '', body.messages);
    const actions = validateActions(plan.actions);

    res.status(200).json({
      ok: true,
      reply: plan.reply,
      actions: actions
    });
  } catch (e) {
    console.error('[admin-ai-assistant]', e && e.message);
    res.status(500).json({ error: (e && e.message) || 'Erro interno' });
  }
};
