'use strict';

/**
 * Assistente IA só para administradores (painel).
 * POST { mode: "plan" | "execute", ... }
 *
 * plan: { message, messages?, image_base64?, image_mime? } → { reply, actions }
 * execute: { actions, image_base64?, ... } — produtos, fotos, fretes por CEP (delivery_cep_rates).
 *   - Opcional: envia a mesma imagem do plano → upload bucket `public/imagens/ai-assistant/*` + insert em product_photos.
 *   - attach_image_to: uuid do produto | omitir → usa ultimo insert do lote ou unico update_product.
 */

const { randomUUID } = require('crypto');
const { verifySupabaseAdmin } = require('./_supabase-admin');
const { applyBrowserCors, handleOptions } = require('./_http');
const { rateLimitKey, allow, prune } = require('./_rate-limit');
const { normalizeBrazilCepDigits } = require('./_cep');

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

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];

/** Chaves site_settings que o assistente pode alterar (evita chaves arbitrarias). */
const SITE_SETTING_KEYS = new Set([
  'store_name',
  'store_description',
  'whatsapp_number',
  'primary_color',
  'n8n_webhook_url',
  'home_hero_image_url',
  'home_carousel_product_ids',
  'home_flash_sale_product_ids',
  'home_flash_sale_ends_at',
  'home_weekly_offer_product_ids',
  'contact_email',
  'contact_phone',
  'cep_no_delivery_message'
]);

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

async function supabaseRest(method, path, body, preferHeader) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const url = base + path;
  const prefer = preferHeader != null ? preferHeader : 'return=representation';
  const headers = {
    apikey: svc,
    Authorization: 'Bearer ' + svc,
    'Content-Type': 'application/json',
    Prefer: prefer
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
  const cats = await supabaseRest('GET', '/rest/v1/categories?select=id,name,slug,sort_order&order=sort_order.asc,name.asc&limit=200', null);
  const prods = await supabaseRest(
    'GET',
    '/rest/v1/products?select=id,name,slug,base_price,stock,active&order=updated_at.desc&limit=100',
    null
  );
  const ceps = await supabaseRest(
    'GET',
    '/rest/v1/delivery_cep_rates?select=id,cep,freight_amount,label&order=cep.asc&limit=60',
    null
  );
  const bnr = await supabaseRest(
    'GET',
    '/rest/v1/banners?select=id,title,sort_order,active&order=sort_order.asc&limit=40',
    null
  );
  const categories = cats.ok && Array.isArray(cats.json) ? cats.json : [];
  const products = prods.ok && Array.isArray(prods.json) ? prods.json : [];
  const deliveryCeps = ceps.ok && Array.isArray(ceps.json) ? ceps.json : [];
  const banners = bnr.ok && Array.isArray(bnr.json) ? bnr.json : [];
  return { categories, products, deliveryCeps, banners };
}

const CATALOG_EXPORT_SELECT =
  'id,name,slug,description,base_price,discount_price,stock,featured,active,product_photos(id,url,thumb_url,sort_order,is_video,active)';

function stripHtmlLite(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayPriceExport(p) {
  const disc = p.discount_price != null && p.discount_price !== '' ? parseFloat(p.discount_price) : NaN;
  const base = parseFloat(p.base_price) || 0;
  if (isFinite(disc) && disc > 0 && disc < base) return disc;
  return base;
}

function firstPhotoForExport(product, preferThumb) {
  const photos = (product.product_photos || [])
    .filter(function (ph) {
      return ph && ph.active !== false && !ph.is_video;
    })
    .slice()
    .sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  const ph = photos[0];
  if (!ph) return { photo_url: null, thumb_url: null, photo_id: null, full_url: null };
  const thumb = ph.thumb_url && String(ph.thumb_url).trim().startsWith('http') ? String(ph.thumb_url).trim() : null;
  const full = ph.url && String(ph.url).trim().startsWith('http') ? String(ph.url).trim() : null;
  const photo_url = preferThumb && thumb ? thumb : full || thumb;
  return { photo_url: photo_url, thumb_url: thumb, photo_id: ph.id || null, full_url: full };
}

async function fetchProductsCatalogExport(limit) {
  const sel = encodeURIComponent(CATALOG_EXPORT_SELECT);
  const path =
    '/rest/v1/products?select=' + sel + '&active=eq.true&order=featured.desc,updated_at.desc&limit=' + encodeURIComponent(String(limit));
  const r = await supabaseRest('GET', path, null);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}

function buildCatalogExportJson(rows, opts) {
  const siteBase = String((opts && opts.siteBase) || process.env.SITE_PUBLIC_URL || '').replace(/\/$/, '');
  const preferThumb = opts && opts.prefer_thumb !== false;
  const template = String((opts && opts.template) || 'whatsapp').toLowerCase();
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const ph = firstPhotoForExport(p, preferThumb);
    const price = displayPriceExport(p);
    const descSrc = stripHtmlLite(p.description || '').slice(0, 400);
    const short_desc = descSrc.slice(0, 160) + (descSrc.length > 160 ? '…' : '');
    const product_url =
      siteBase && p.id
        ? siteBase + '/produto.html?id=' + encodeURIComponent(String(p.id))
        : 'produto.html?id=' + encodeURIComponent(String(p.id));
    const row = {
      id: p.id,
      name: p.name,
      slug: p.slug || null,
      base_price: parseFloat(p.base_price) || 0,
      discount_price: p.discount_price != null && p.discount_price !== '' ? parseFloat(p.discount_price) : null,
      price_display: price,
      price_formatted: 'R$ ' + price.toFixed(2).replace('.', ','),
      short_description: short_desc,
      photo_url: ph.photo_url,
      thumb_url: ph.thumb_url || null,
      high_res_photo_url: ph.full_url || ph.photo_url,
      product_page_url: product_url,
      stock: p.stock != null ? p.stock : null,
      featured: !!p.featured
    };
    if (template === 'n8n') {
      row.n8n_merge = {
        text: '*' + String(p.name || '') + '* — ' + row.price_formatted + (short_desc ? '\n' + short_desc : ''),
        media_url: ph.photo_url || ''
      };
    }
    items.push(row);
  }
  const out = {
    generated_at: new Date().toISOString(),
    template: template,
    source: 'supabase',
    note:
      template === 'whatsapp'
        ? 'Use photo_url (miniatura quando disponível) para envio mais leve. high_res_photo_url para qualidade.'
        : 'Cada item inclui n8n_merge para Message/WhatsApp nodes.',
    items: items
  };
  return out;
}

async function openAiEnrichCatalogBlurbs(itemsForModel, userMsg, imageB64, imageMime) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');

  const sys =
    'Voce ajuda o admin da loja Conforta Colchões. Recebe uma lista JSON de produtos com id, name, price_formatted, short_description (do banco), photo_url. ' +
    'Opcionalmente recebe uma IMAGEM de referencia (etiqueta, vitrine, briefing visual). ' +
    'Gere textos curtos em PT-BR para WhatsApp/n8n. NUNCA invente precos nem URLs: use apenas os ids listados. ' +
    'Responda SOMENTE JSON: {"blurbs":[{"id":"<uuid>","quick_pitch":"max 200 chars","whatsapp_line":"uma linha curta com emoji opcional"}]} — uma entrada por id na ordem enviada.';

  const userParts = [];
  userParts.push({
    type: 'text',
    text:
      String(userMsg || 'Gere textos curtos para divulgacao.').trim().slice(0, 4000) +
      '\n\nPRODUTOS (dados reais do Supabase):\n' +
      JSON.stringify(itemsForModel).slice(0, 28000)
  });
  if (imageB64 && imageMime) {
    const mime = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(imageMime) ? imageMime.toLowerCase().replace('jpg', 'jpeg') : 'image/jpeg';
    userParts.push({
      type: 'image_url',
      image_url: { url: 'data:' + mime + ';base64,' + imageB64 }
    });
  }
  const userContent = userParts.length === 1 ? userParts[0].text : userParts;
  const model = process.env.OPENAI_ADMIN_ASSISTANT_MODEL || 'gpt-4o-mini';
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      temperature: 0.25,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent }
      ]
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
    return {};
  }
  const arr = parsed.blurbs || parsed.items || [];
  if (!Array.isArray(arr)) return {};
  const byId = {};
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (!b || !isUuid(String(b.id || ''))) continue;
    byId[String(b.id)] = {
      quick_pitch: String(b.quick_pitch || b.pitch || '').slice(0, 220),
      whatsapp_line: String(b.whatsapp_line || b.line || '').slice(0, 280)
    };
  }
  return byId;
}

function buildPlannerSystem(ctx) {
  const catLines = ctx.categories.map(function (c) {
    return (
      '- id: ' +
      c.id +
      ' | ' +
      (c.name || '') +
      ' | slug ' +
      (c.slug || '') +
      (c.sort_order != null ? ' | ordem ' + c.sort_order : '')
    );
  });
  const prodLines = ctx.products.map(function (p) {
    return '- id: ' + p.id + ' | ' + (p.name || '') + ' | slug ' + (p.slug || '') + ' | R$' + (p.base_price != null ? p.base_price : '?');
  });
  const cepLines = (ctx.deliveryCeps || []).map(function (r) {
    return '- id: ' + r.id + ' | CEP ' + (r.cep || '') + ' | frete R$' + (r.freight_amount != null ? r.freight_amount : '?') + (r.label ? ' | ' + r.label : '');
  });
  const bannerLines = (ctx.banners || []).map(function (b) {
    return '- id: ' + b.id + ' | ' + (b.title || '(sem titulo)') + ' | ordem ' + (b.sort_order != null ? b.sort_order : '?');
  });
  const siteKeysHint = Array.from(SITE_SETTING_KEYS).join(', ');
  return (
    'Voce e o assistente COMPLETO do painel administrativo Conforta (o que o admin faz no site, voce ajuda via JSON). Seja RAPIDO e LOGICO.\n\n' +
    'Raciocinio: (1) Intencao — produto, categoria, banner, frete CEP, pedido/consulta, configuracao site. ' +
    '(2) "historico do cliente / pedidos da conta X" = use CONSULTAS abaixo com email ou id. ' +
    '(2b) JSON de catalogo com URLs/preços reais (WhatsApp, n8n, fotos leves) = aba Estudio IA no painel; nao use actions para isso. ' +
    '(3) Menos actions, mais precisao.\n\n' +
    'Responda SOMENTE JSON (sem markdown). Formato:\n' +
    '{"reply":"portugues direto, sem prefixo pt-BR:","actions":[]}\n\n' +
    '--- CONSULTAS (executam ao clicar Enviar; NAO precisam de Aplicar; max 5 por mensagem) ---\n' +
    '{"type":"fetch_orders_by_email","email":"cliente@email.com"}\n' +
    '{"type":"fetch_orders_by_profile_id","profile_id":"<uuid>"}\n' +
    '{"type":"fetch_order_by_number","order_number":"trecho do numero"}\n' +
    '{"type":"fetch_site_setting","key":"uma das chaves permitidas"}\n' +
    'Chaves permitidas: ' +
    siteKeysHint +
    '\n\n' +
    '--- PRODUTO ---\n' +
    '{"type":"insert_product","product":{name,slug?,description?,category_id?,base_price,dimensions?,material?,stock?,tags?...}}\n' +
    '{"type":"update_product","id":"<uuid>","patch":{...}}\n' +
    '{"type":"insert_product_photo",...} so com URL https real.\n\n' +
    '--- CATEGORIA ---\n' +
    '{"type":"insert_category","category":{name,slug?,description?,image_url?(https),active?}}\n' +
    '{"type":"update_category","id":"<uuid>","patch":{...}}\n' +
    '{"type":"delete_category","id":"<uuid>"}\n\n' +
    '--- BANNER (precisa URL de imagem https) ---\n' +
    '{"type":"insert_banner","banner":{image_url,title?,subtitle?,link_url?,product_id?}}\n' +
    '{"type":"update_banner","id":"<uuid>","patch":{...}}\n' +
    '{"type":"delete_banner","id":"<uuid>"}\n\n' +
    '--- FRETE CEP (cep sempre 8 digitos; 7 digitos completam com zero a esquerda; use ponto no JSON para numeros) ---\n' +
    '{"type":"upsert_delivery_cep","cep":"01310100","freight_amount":29.9,"label":"Regiao centro"}\n' +
    '{"type":"update_delivery_cep","id":"<uuid da lista>","freight_amount":29.9,"cep"?,"label"?}\n' +
    '{"type":"delete_delivery_cep","id":"<uuid>"} ou {"type":"delete_delivery_cep","cep":"01310100"}\n\n' +
    '--- PEDIDOS (mutacao; use com cuidado) ---\n' +
    '{"type":"update_order_status","id":"<uuid pedido>","status":"pending|confirmed|preparing|shipped|delivered|cancelled"}\n' +
    '{"type":"delete_order","id":"<uuid pedido>"}\n\n' +
    '--- CONFIG SITE ---\n' +
    '{"type":"upsert_site_setting","key":"contact_email","value":"texto ou json"}\n\n' +
    'Categorias:\n' +
    (catLines.length ? catLines.join('\n') : '(nenhuma)') +
    '\n\nProdutos:\n' +
    (prodLines.length ? prodLines.join('\n') : '(nenhum)') +
    '\n\nBanners:\n' +
    (bannerLines.length ? bannerLines.join('\n') : '(nenhum)') +
    '\n\nCEPs frete:\n' +
    (cepLines.length ? cepLines.join('\n') : '(nenhum)')
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
      max_tokens: 2400,
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
  const replyRaw = typeof parsed.reply === 'string' ? parsed.reply : 'Sem resposta estruturada.';
  const reply = String(replyRaw)
    .replace(/^\s*pt-br\s*:\s*/i, '')
    .trim();
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  return { reply: reply, actions: actions };
}

function basicEmailOk(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

async function executeOneReadAction(a) {
  const t = String(a.type || '').trim();
  try {
    if (t === 'fetch_orders_by_email') {
      const email = String(a.email || '').trim().toLowerCase();
      if (!basicEmailOk(email)) {
        return { type: t, ok: false, text: '[Consulta] Email inválido.' };
      }
      let r = await supabaseRest('GET', '/rest/v1/profiles?select=id,email,full_name&email=eq.' + encodeURIComponent(email), null);
      let rows = r.ok && Array.isArray(r.json) ? r.json : [];
      if (!rows.length) {
        const pat = '%' + email.replace(/%/g, '') + '%';
        r = await supabaseRest(
          'GET',
          '/rest/v1/profiles?select=id,email,full_name&email=ilike.' + encodeURIComponent(pat) + '&limit=5',
          null
        );
        rows = r.ok && Array.isArray(r.json) ? r.json : [];
      }
      if (!rows.length) {
        return { type: t, ok: true, text: '[Pedidos] Nenhum perfil encontrado para: ' + email + '.' };
      }
      const lines = [];
      for (let p = 0; p < Math.min(rows.length, 3); p++) {
        const prof = rows[p];
        const or = await supabaseRest(
          'GET',
          '/rest/v1/orders?select=id,order_number,status,total_amount,created_at,payment_status&user_id=eq.' +
            encodeURIComponent(prof.id) +
            '&order=created_at.desc&limit=15',
          null
        );
        const orders = or.ok && Array.isArray(or.json) ? or.json : [];
        lines.push('Perfil: ' + (prof.full_name || '—') + ' <' + prof.email + '> (id ' + prof.id + ')');
        if (!orders.length) lines.push('  — Nenhum pedido.');
        else {
          for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            lines.push(
              '  - #' +
                (o.order_number || o.id) +
                ' | ' +
                (o.status || '') +
                ' | R$' +
                (o.total_amount != null ? o.total_amount : '?') +
                ' | ' +
                String(o.created_at || '').slice(0, 16)
            );
          }
        }
      }
      return { type: t, ok: true, text: '[Pedidos por email]\n' + lines.join('\n') };
    }
    if (t === 'fetch_orders_by_profile_id') {
      const pid = String(a.profile_id || a.user_id || '').trim();
      if (!isUuid(pid)) return { type: t, ok: false, text: '[Consulta] profile_id UUID inválido.' };
      const or = await supabaseRest(
        'GET',
        '/rest/v1/orders?select=id,order_number,status,total_amount,created_at,payment_status&user_id=eq.' +
          encodeURIComponent(pid) +
          '&order=created_at.desc&limit=20',
        null
      );
      const orders = or.ok && Array.isArray(or.json) ? or.json : [];
      if (!orders.length) return { type: t, ok: true, text: '[Pedidos] Nenhum pedido para este perfil.' };
      const lines = orders.map(function (o) {
        return (
          '- #' +
          (o.order_number || o.id) +
          ' | ' +
          (o.status || '') +
          ' | R$' +
          (o.total_amount != null ? o.total_amount : '?') +
          ' | ' +
          String(o.created_at || '').slice(0, 16)
        );
      });
      return { type: t, ok: true, text: '[Pedidos do perfil]\n' + lines.join('\n') };
    }
    if (t === 'fetch_order_by_number') {
      const q = String(a.order_number || a.q || '').trim();
      if (!q) return { type: t, ok: false, text: '[Consulta] Informe order_number.' };
      const pat = '%' + q.replace(/%/g, '') + '%';
      const or = await supabaseRest(
        'GET',
        '/rest/v1/orders?select=id,order_number,status,total_amount,created_at,user_id,payment_status&order_number=ilike.' +
          encodeURIComponent(pat) +
          '&order=created_at.desc&limit=12',
        null
      );
      const orders = or.ok && Array.isArray(or.json) ? or.json : [];
      if (!orders.length) return { type: t, ok: true, text: '[Pedidos] Nenhum pedido encontrado para "' + q + '".' };
      const lines = orders.map(function (o) {
        return (
          '- #' +
          (o.order_number || '') +
          ' | ' +
          (o.status || '') +
          ' | R$' +
          (o.total_amount != null ? o.total_amount : '?') +
          ' | ' +
          String(o.created_at || '').slice(0, 16) +
          ' | id ' +
          o.id
        );
      });
      return { type: t, ok: true, text: '[Busca pedido]\n' + lines.join('\n') };
    }
    if (t === 'fetch_site_setting') {
      const key = String(a.key || '').trim();
      if (!SITE_SETTING_KEYS.has(key)) {
        return { type: t, ok: false, text: '[Config] Chave nao permitida. Use uma das chaves do painel (ex.: contact_email, whatsapp_number).' };
      }
      const sr = await supabaseRest(
        'GET',
        '/rest/v1/site_settings?select=key,value&key=eq.' + encodeURIComponent(key) + '&limit=1',
        null
      );
      const row = sr.ok && Array.isArray(sr.json) && sr.json[0] ? sr.json[0] : null;
      if (!row) return { type: t, ok: true, text: '[Config] Chave "' + key + '" não encontrada (vazia).' };
      const valStr =
        typeof row.value === 'object' ? JSON.stringify(row.value).slice(0, 800) : String(row.value || '').slice(0, 800);
      return { type: t, ok: true, text: '[Config] ' + key + ' = ' + valStr };
    }
    return { type: t, ok: false, text: '[Consulta] Tipo desconhecido: ' + t };
  } catch (err) {
    return { type: t, ok: false, text: '[Consulta] Erro: ' + ((err && err.message) || err) };
  }
}

async function splitReadAndMutating(rawActions) {
  const READ = {
    fetch_orders_by_email: true,
    fetch_orders_by_profile_id: true,
    fetch_order_by_number: true,
    fetch_site_setting: true
  };
  const reads = [];
  const mutating = [];
  if (!Array.isArray(rawActions)) return { mutating: [], readAppend: '', read_results: [] };
  for (let i = 0; i < rawActions.length; i++) {
    const a = rawActions[i];
    const t = a && String(a.type || '').trim();
    if (READ[t]) reads.push(a);
    else mutating.push(a);
  }
  const readResults = [];
  let append = '';
  const maxReads = 5;
  for (let i = 0; i < Math.min(reads.length, maxReads); i++) {
    const r = await executeOneReadAction(reads[i]);
    readResults.push(r);
    if (r && r.text) append += (append ? '\n\n' : '') + r.text;
  }
  if (reads.length > maxReads) {
    append += (append ? '\n\n' : '') + '(Limite: no maximo ' + maxReads + ' consultas por mensagem.)';
  }
  return { mutating: mutating, readAppend: append, read_results: readResults };
}

function pickCategoryInsert(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const name = String(obj.name || '').trim();
  if (!name) return null;
  const slug = String(obj.slug || '').trim().toLowerCase() || slugifyName(name);
  return {
    name: name.slice(0, 200),
    slug: slug.slice(0, 120),
    description: obj.description != null ? String(obj.description).slice(0, 5000) : null,
    image_url: obj.image_url && validPhotoUrl(String(obj.image_url)) ? String(obj.image_url).trim() : null,
    active: obj.active !== false
  };
}

function pickCategoryPatch(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  if (obj.name != null) out.name = String(obj.name).trim().slice(0, 200);
  if (obj.slug != null) out.slug = String(obj.slug).trim().toLowerCase().slice(0, 120);
  if (obj.description !== undefined) {
    out.description = obj.description == null ? null : String(obj.description).slice(0, 5000);
  }
  if (obj.image_url !== undefined) {
    out.image_url =
      obj.image_url == null || obj.image_url === ''
        ? null
        : validPhotoUrl(String(obj.image_url))
          ? String(obj.image_url).trim()
          : null;
  }
  if (obj.active != null) out.active = !!obj.active;
  return Object.keys(out).length ? out : null;
}

function pickBannerInsert(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const imageUrl = String(obj.image_url || '').trim();
  if (!validPhotoUrl(imageUrl)) return null;
  return {
    title: obj.title != null ? String(obj.title).trim().slice(0, 200) || null : null,
    subtitle: obj.subtitle != null ? String(obj.subtitle).trim().slice(0, 400) || null : null,
    image_url: imageUrl,
    link_url:
      obj.link_url && String(obj.link_url).trim().startsWith('http')
        ? String(obj.link_url).trim().slice(0, 2000)
        : null,
    product_id: obj.product_id != null && obj.product_id !== '' && isUuid(obj.product_id) ? obj.product_id : null,
    active: obj.active !== false
  };
}

function pickBannerPatch(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  if (obj.title !== undefined) out.title = obj.title == null ? null : String(obj.title).trim().slice(0, 200);
  if (obj.subtitle !== undefined) out.subtitle = obj.subtitle == null ? null : String(obj.subtitle).trim().slice(0, 400);
  if (obj.image_url !== undefined && obj.image_url != null && validPhotoUrl(String(obj.image_url))) {
    out.image_url = String(obj.image_url).trim();
  }
  if (obj.link_url !== undefined) {
    out.link_url = obj.link_url == null ? null : String(obj.link_url).trim().slice(0, 2000);
  }
  if (obj.product_id !== undefined) {
    out.product_id = obj.product_id && isUuid(obj.product_id) ? obj.product_id : null;
  }
  if (obj.active != null) out.active = !!obj.active;
  return Object.keys(out).length ? out : null;
}

/**
 * Normaliza acoes de frete por CEP vindas do modelo (campos e nomes de tipo variam).
 * O banco exige cep com 8 digitos (check constraint); alinhar com api/_cep.js.
 */
function extractDeliveryCepUpsert(a) {
  if (!a || typeof a !== 'object') return null;
  const t = String(a.type || '')
    .trim()
    .toLowerCase();
  if (t === 'update_delivery_cep' || t === 'delete_delivery_cep') return null;
  const upsertNames = new Set([
    'upsert_delivery_cep',
    'insert_delivery_cep',
    'add_delivery_cep',
    'insert_delivery_cep_rate',
    'delivery_cep_upsert',
    'set_delivery_cep',
    'frete_cep',
    'set_frete_cep'
  ]);
  const isUpsert =
    upsertNames.has(t) ||
    (t.indexOf('delivery') >= 0 && t.indexOf('cep') >= 0 && (t.indexOf('upsert') >= 0 || t.indexOf('add') >= 0));

  let cep =
    a.cep != null && a.cep !== ''
      ? a.cep
      : a.zip_code != null && a.zip_code !== ''
        ? a.zip_code
        : a.zip != null && a.zip !== ''
          ? a.zip
          : null;
  if (cep == null && a.rate && typeof a.rate === 'object') cep = a.rate.cep != null ? a.rate.cep : a.rate.zip_code;
  if (cep == null && a.row && typeof a.row === 'object') cep = a.row.cep;
  if (cep == null && a.delivery && typeof a.delivery === 'object') cep = a.delivery.cep;
  cep = normalizeBrazilCepDigits(cep);

  let amt =
    a.freight_amount != null && a.freight_amount !== ''
      ? a.freight_amount
      : a.amount != null && a.amount !== ''
        ? a.amount
        : a.freight != null && a.freight !== ''
          ? a.freight
          : a.valor_frete;
  if (amt == null && a.rate && typeof a.rate === 'object') {
    amt =
      a.rate.freight_amount != null && a.rate.freight_amount !== ''
        ? a.rate.freight_amount
        : a.rate.amount;
  }
  if (amt == null && a.row && typeof a.row === 'object') amt = a.row.freight_amount;
  if (amt == null && a.delivery && typeof a.delivery === 'object') {
    amt =
      a.delivery.freight_amount != null && a.delivery.freight_amount !== ''
        ? a.delivery.freight_amount
        : a.delivery.amount;
  }

  const n = parseFloat(amt);
  if (!cep || isNaN(n) || n < 0) return null;

  let lab = a.label;
  if (lab == null && a.rate && typeof a.rate === 'object') lab = a.rate.label;
  if (lab == null && a.row && typeof a.row === 'object') lab = a.row.label;
  if (lab == null && a.delivery && typeof a.delivery === 'object') lab = a.delivery.label;

  const freightNum = Math.round(n * 100) / 100;
  const labelStr = lab != null ? String(lab).trim().slice(0, 120) : '';

  if (!isUpsert) return null;
  return {
    type: 'upsert_delivery_cep',
    cep: cep,
    freight_amount: freightNum,
    label: labelStr || null
  };
}

function validateActions(actions) {
  const clean = [];
  if (!Array.isArray(actions)) return clean;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!a || typeof a !== 'object') continue;
    const extractedCep = extractDeliveryCepUpsert(a);
    if (extractedCep) {
      clean.push(extractedCep);
      continue;
    }
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
    } else if (t === 'update_delivery_cep' && isUuid(a.id)) {
      const amt = parseFloat(a.freight_amount);
      if (isNaN(amt) || amt < 0) continue;
      const item = { type: 'update_delivery_cep', id: a.id, freight_amount: amt };
      if (a.label !== undefined) {
        item.label = a.label === null ? null : String(a.label).trim().slice(0, 120) || null;
      }
      const nc = normalizeBrazilCepDigits(a.cep);
      if (nc) item.cep = nc;
      clean.push(item);
    } else if (t === 'delete_delivery_cep') {
      if (isUuid(a.id)) {
        clean.push({ type: 'delete_delivery_cep', id: a.id });
      } else {
        const cep = normalizeBrazilCepDigits(a.cep);
        if (cep) clean.push({ type: 'delete_delivery_cep', cep: cep });
      }
    } else if (t === 'insert_category') {
      const c = pickCategoryInsert(a.category);
      if (c) clean.push({ type: 'insert_category', category: c });
    } else if (t === 'update_category' && isUuid(a.id)) {
      const p = pickCategoryPatch(a.patch || {});
      if (p) clean.push({ type: 'update_category', id: a.id, patch: p });
    } else if (t === 'delete_category' && isUuid(a.id)) {
      clean.push({ type: 'delete_category', id: a.id });
    } else if (t === 'insert_banner') {
      const b = pickBannerInsert(a.banner);
      if (b) clean.push({ type: 'insert_banner', banner: b });
    } else if (t === 'update_banner' && isUuid(a.id)) {
      const p = pickBannerPatch(a.patch || {});
      if (p) clean.push({ type: 'update_banner', id: a.id, patch: p });
    } else if (t === 'delete_banner' && isUuid(a.id)) {
      clean.push({ type: 'delete_banner', id: a.id });
    } else if (t === 'upsert_site_setting') {
      const key = String(a.key || '').trim();
      if (!SITE_SETTING_KEYS.has(key)) continue;
      if (a.value === undefined) continue;
      clean.push({ type: 'upsert_site_setting', key: key, value: a.value });
    } else if (t === 'update_order_status' && isUuid(a.id)) {
      const st = String(a.status || '').trim();
      if (ORDER_STATUSES.indexOf(st) < 0) continue;
      clean.push({ type: 'update_order_status', id: a.id, status: st });
    } else if (t === 'delete_order' && isUuid(a.id)) {
      clean.push({ type: 'delete_order', id: a.id });
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
        results.push({ ok: false, type: 'insert_product_photo', error: 'product_id inválido' });
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
    } else if (a.type === 'upsert_delivery_cep' || a.type === 'insert_delivery_cep') {
      const row = {
        cep: a.cep,
        freight_amount: Math.round(Number(a.freight_amount) * 100) / 100,
        label: a.label != null ? a.label : null
      };
      const find = await supabaseRest(
        'GET',
        '/rest/v1/delivery_cep_rates?select=id,cep&cep=eq.' + encodeURIComponent(row.cep),
        null
      );
      const existing = find.ok && Array.isArray(find.json) && find.json[0] ? find.json[0] : null;
      let r;
      let rowData = null;
      if (existing && existing.id) {
        r = await supabaseRest(
          'PATCH',
          '/rest/v1/delivery_cep_rates?id=eq.' + encodeURIComponent(existing.id),
          { freight_amount: row.freight_amount, label: row.label },
          'return=representation'
        );
        if (r.ok) {
          if (Array.isArray(r.json) && r.json[0]) rowData = r.json[0];
          else if (r.json && r.json.id) rowData = r.json;
          else
            rowData = {
              id: existing.id,
              cep: row.cep,
              freight_amount: row.freight_amount,
              label: row.label
            };
        }
      } else {
        r = await supabaseRest('POST', '/rest/v1/delivery_cep_rates', row, 'return=representation');
        if (r.ok) {
          rowData = Array.isArray(r.json) ? r.json[0] : r.json && r.json.id ? r.json : null;
        }
      }
      if (!r.ok || !rowData) {
        results.push({
          ok: false,
          type: 'upsert_delivery_cep',
          cep: a.cep,
          error: (r.json && (r.json.message || r.json.hint || r.json.error_description || r.json.details)) || 'upsert CEP falhou',
          status: r.status
        });
      } else {
        results.push({
          ok: true,
          type: 'upsert_delivery_cep',
          id: rowData.id,
          cep: rowData.cep || row.cep,
          freight_amount: rowData.freight_amount != null ? rowData.freight_amount : row.freight_amount
        });
      }
    } else if (a.type === 'update_delivery_cep') {
      const patch = { freight_amount: a.freight_amount };
      if (a.label !== undefined) patch.label = a.label;
      if (a.cep) patch.cep = a.cep;
      const r = await supabaseRest('PATCH', '/rest/v1/delivery_cep_rates?id=eq.' + encodeURIComponent(a.id), patch);
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'update_delivery_cep',
          id: a.id,
          error: (r.json && (r.json.message || r.json.hint)) || 'update CEP falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'update_delivery_cep', id: a.id });
      }
    } else if (a.type === 'delete_delivery_cep') {
      let delId = a.id;
      if (!delId && a.cep) {
        const find = await supabaseRest(
          'GET',
          '/rest/v1/delivery_cep_rates?select=id&cep=eq.' + encodeURIComponent(a.cep),
          null
        );
        if (find.ok && Array.isArray(find.json) && find.json[0] && find.json[0].id) {
          delId = find.json[0].id;
        }
      }
      if (!isUuid(String(delId || ''))) {
        results.push({ ok: false, type: 'delete_delivery_cep', error: 'CEP ou id não encontrado' });
      } else {
        const r = await supabaseRest(
          'DELETE',
          '/rest/v1/delivery_cep_rates?id=eq.' + encodeURIComponent(delId),
          null,
          'return=minimal'
        );
        if (!r.ok) {
          results.push({
            ok: false,
            type: 'delete_delivery_cep',
            id: delId,
            error: (r.json && r.json.message) || 'delete CEP falhou',
            status: r.status
          });
        } else {
          results.push({ ok: true, type: 'delete_delivery_cep', id: delId });
        }
      }
    } else if (a.type === 'insert_category') {
      const r = await supabaseRest('POST', '/rest/v1/categories', a.category);
      if (!r.ok || !Array.isArray(r.json) || !r.json[0]) {
        results.push({
          ok: false,
          type: 'insert_category',
          error: (r.json && (r.json.message || r.json.hint)) || 'insert categoria falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'insert_category', id: r.json[0].id });
      }
    } else if (a.type === 'update_category') {
      const r = await supabaseRest('PATCH', '/rest/v1/categories?id=eq.' + encodeURIComponent(a.id), a.patch);
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'update_category',
          id: a.id,
          error: (r.json && r.json.message) || 'update categoria falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'update_category', id: a.id });
      }
    } else if (a.type === 'delete_category') {
      const r = await supabaseRest('DELETE', '/rest/v1/categories?id=eq.' + encodeURIComponent(a.id), null, 'return=minimal');
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'delete_category',
          id: a.id,
          error: (r.json && r.json.message) || 'delete categoria falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'delete_category', id: a.id });
      }
    } else if (a.type === 'insert_banner') {
      const maxR = await supabaseRest('GET', '/rest/v1/banners?select=sort_order&order=sort_order.desc&limit=1', null);
      let so = 0;
      if (maxR.ok && Array.isArray(maxR.json) && maxR.json[0]) so = parseInt(maxR.json[0].sort_order, 10) || 0;
      const row = Object.assign({}, a.banner, { sort_order: so + 1 });
      const r = await supabaseRest('POST', '/rest/v1/banners', row);
      if (!r.ok || !Array.isArray(r.json) || !r.json[0]) {
        results.push({
          ok: false,
          type: 'insert_banner',
          error: (r.json && r.json.message) || 'insert banner falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'insert_banner', id: r.json[0].id });
      }
    } else if (a.type === 'update_banner') {
      const r = await supabaseRest('PATCH', '/rest/v1/banners?id=eq.' + encodeURIComponent(a.id), a.patch);
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'update_banner',
          id: a.id,
          error: (r.json && r.json.message) || 'update banner falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'update_banner', id: a.id });
      }
    } else if (a.type === 'delete_banner') {
      const r = await supabaseRest('DELETE', '/rest/v1/banners?id=eq.' + encodeURIComponent(a.id), null, 'return=minimal');
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'delete_banner',
          id: a.id,
          error: (r.json && r.json.message) || 'delete banner falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'delete_banner', id: a.id });
      }
    } else if (a.type === 'upsert_site_setting') {
      const key = a.key;
      const valPayload = typeof a.value === 'object' && a.value !== null ? a.value : String(a.value);
      const ex = await supabaseRest('GET', '/rest/v1/site_settings?select=id&key=eq.' + encodeURIComponent(key), null);
      const exists = ex.ok && Array.isArray(ex.json) && ex.json[0];
      let r;
      if (exists) {
        r = await supabaseRest('PATCH', '/rest/v1/site_settings?key=eq.' + encodeURIComponent(key), { value: valPayload });
      } else {
        r = await supabaseRest('POST', '/rest/v1/site_settings', { key: key, value: valPayload });
      }
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'upsert_site_setting',
          key: key,
          error: (r.json && r.json.message) || 'upsert site_settings falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'upsert_site_setting', key: key });
      }
    } else if (a.type === 'update_order_status') {
      const r = await supabaseRest('PATCH', '/rest/v1/orders?id=eq.' + encodeURIComponent(a.id), { status: a.status });
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'update_order_status',
          id: a.id,
          error: (r.json && r.json.message) || 'update pedido falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'update_order_status', id: a.id, status: a.status });
      }
    } else if (a.type === 'delete_order') {
      const r = await supabaseRest('DELETE', '/rest/v1/orders?id=eq.' + encodeURIComponent(a.id), null, 'return=minimal');
      if (!r.ok) {
        results.push({
          ok: false,
          type: 'delete_order',
          id: a.id,
          error: (r.json && r.json.message) || 'delete pedido falhou',
          status: r.status
        });
      } else {
        results.push({ ok: true, type: 'delete_order', id: a.id });
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
    return { ok: false, type: 'storage_photo', error: 'Base64 inválido' };
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
  const modeRaw = String(body.mode || 'plan').toLowerCase();
  const mode =
    modeRaw === 'execute'
      ? 'execute'
      : modeRaw === 'catalog_export'
        ? 'catalog_export'
        : modeRaw === 'catalog_enrich'
          ? 'catalog_enrich'
          : 'plan';

  const key = rateLimitKey(req, 'admin-ai') + ':' + mode;
  const burst =
    mode === 'execute' ? 25 : mode === 'catalog_export' ? 35 : mode === 'catalog_enrich' ? 8 : 12;
  if (!allow(key, burst, 60000)) {
    res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
    return;
  }

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!svc || !base) {
    res.status(503).json({ error: 'Supabase service role não configurado no servidor.' });
    return;
  }

  try {
    if (mode === 'catalog_export') {
      const limit = Math.min(120, Math.max(1, parseInt(body.limit, 10) || 40));
      const template = String(body.template || 'whatsapp').toLowerCase() === 'n8n' ? 'n8n' : 'whatsapp';
      const preferThumb = body.prefer_thumb !== false;
      let siteBase = String(body.site_base_url || body.siteBase || '').trim().replace(/\/$/, '');
      if (!siteBase) siteBase = String(process.env.SITE_PUBLIC_URL || '').trim().replace(/\/$/, '');
      const rows = await fetchProductsCatalogExport(limit);
      const exportJson = buildCatalogExportJson(rows, {
        template: template,
        prefer_thumb: preferThumb,
        siteBase: siteBase
      });
      const n = exportJson.items.length;
      const reply =
        'Pronto: ' +
        n +
        ' produto(s) do Supabase. Cada item tem photo_url (prioriza miniatura para carregar mais rapido), preco e texto curto.';
      res.status(200).json({ ok: true, reply: reply, export_json: exportJson, actions: [] });
      return;
    }

    if (mode === 'catalog_enrich') {
      const msg = String(body.message || '').trim();
      const b64 = typeof body.image_base64 === 'string' ? body.image_base64.replace(/^data:image\/\w+;base64,/, '') : '';
      if (b64.length > MAX_B64) {
        res.status(400).json({ error: 'Imagem muito grande. Use JPEG comprimido.' });
        return;
      }
      if (!msg && !b64) {
        res.status(400).json({ error: 'Envie message (instrucao) e/ou imagem de referencia.' });
        return;
      }
      const limit = Math.min(25, Math.max(1, parseInt(body.limit, 10) || 12));
      const template = String(body.template || 'whatsapp').toLowerCase() === 'n8n' ? 'n8n' : 'whatsapp';
      const preferThumb = body.prefer_thumb !== false;
      let siteBase = String(body.site_base_url || body.siteBase || '').trim().replace(/\/$/, '');
      if (!siteBase) siteBase = String(process.env.SITE_PUBLIC_URL || '').trim().replace(/\/$/, '');
      const rows = await fetchProductsCatalogExport(limit);
      const exportJson = buildCatalogExportJson(rows, {
        template: template,
        prefer_thumb: preferThumb,
        siteBase: siteBase
      });
      const itemsForModel = exportJson.items.map(function (it) {
        return {
          id: it.id,
          name: it.name,
          price_formatted: it.price_formatted,
          short_description: it.short_description,
          photo_url: it.photo_url
        };
      });
      const blurbs = await openAiEnrichCatalogBlurbs(
        itemsForModel,
        msg || 'Gere textos curtos para divulgacao no WhatsApp.',
        b64,
        b64 ? String(body.image_mime || 'image/jpeg') : ''
      );
      for (let i = 0; i < exportJson.items.length; i++) {
        const it = exportJson.items[i];
        const b = blurbs[String(it.id)];
        if (b) {
          it.ai_quick_pitch = b.quick_pitch;
          it.ai_whatsapp_line = b.whatsapp_line;
          if (it.n8n_merge) {
            it.n8n_merge.text_ai = b.whatsapp_line || b.quick_pitch;
          }
        }
      }
      exportJson.enriched_with_ai = true;
      res.status(200).json({
        ok: true,
        reply:
          'Dados do Supabase (URLs e precos reais) + textos sugeridos pela IA em ai_quick_pitch / ai_whatsapp_line. Revise antes de publicar.',
        export_json: exportJson,
        actions: []
      });
      return;
    }

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
      if (actionsList.length > 25) {
        res.status(400).json({ error: 'No maximo 25 acoes por vez.' });
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
    const split = await splitReadAndMutating(plan.actions);
    const mergedReply = split.readAppend ? plan.reply + '\n\n' + split.readAppend : plan.reply;
    const actions = validateActions(split.mutating);

    res.status(200).json({
      ok: true,
      reply: mergedReply,
      actions: actions,
      read_results: split.read_results
    });
  } catch (e) {
    console.error('[admin-ai-assistant]', e && e.message);
    res.status(500).json({ error: (e && e.message) || 'Erro interno' });
  }
};
