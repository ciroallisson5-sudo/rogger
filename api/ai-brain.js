// Cérebro compartilhado: catálogo Supabase + prompt (site chat e n8n → /api/openai-chat)
// Chaves só em process.env na Vercel (nunca .env no navegador).

'use strict';

const CATALOG_TTL_MS = 90000;
let catalogCache = { at: 0, products: [] };

function supabaseHeaders() {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
}

function sortProductsByPrice(products) {
  return (products || []).slice().sort(function (a, b) {
    const pa = parseFloat(a.discount_price || a.base_price) || 999999999;
    const pb = parseFloat(b.discount_price || b.base_price) || 999999999;
    return pa - pb;
  });
}

function productPageUrl(siteBase, productId) {
  const base = String(siteBase || process.env.SITE_PUBLIC_URL || 'https://confortacolchoes.vercel.app').replace(
    /\/$/,
    ''
  );
  return base + '/produto.html?id=' + encodeURIComponent(productId);
}

function displayPrice(p) {
  const list = parseFloat(p.base_price) || 0;
  const disc =
    p.discount_price != null && p.discount_price !== '' ? parseFloat(p.discount_price) : null;
  if (disc != null && !isNaN(disc) && disc < list) return disc;
  return list;
}

async function fetchStoreCatalog() {
  if (Date.now() - catalogCache.at < CATALOG_TTL_MS && catalogCache.products.length) {
    return catalogCache.products;
  }

  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!base || !key) return [];

  const url =
    base +
    '/rest/v1/products?active=eq.true&select=id,name,slug,description,base_price,discount_price,category_id,tags,material,featured,stock&order=featured.desc,created_at.desc&limit=250';

  try {
    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) return catalogCache.products.length ? catalogCache.products : [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    catalogCache = { at: Date.now(), products: list };
    return list;
  } catch (_) {
    return catalogCache.products.length ? catalogCache.products : [];
  }
}

function buildCatalogSystemPrompt(sortedProducts, siteBase) {
  const lines = (sortedProducts || []).slice(0, 80).map(function (p) {
    const price = displayPrice(p);
    const name = String(p.name || 'Produto').slice(0, 100);
    const id = p.id || '';
    const slug = p.slug ? ' slug:' + p.slug : '';
    const link = id ? productPageUrl(siteBase, id) : '';
    return (
      '- [id:' +
      id +
      '] ' +
      name +
      ' | R$ ' +
      price.toFixed(2).replace('.', ',') +
      slug +
      (link ? ' | ' + link : '')
    );
  });

  let cheapestLine = '';
  if (sortedProducts && sortedProducts.length > 0) {
    const c = sortedProducts[0];
    const cp = displayPrice(c);
    const u = c.id ? productPageUrl(siteBase, c.id) : '';
    cheapestLine =
      'O item com MENOR preco no catalogo agora e: "' +
      (c.name || 'Produto') +
      '" (id:' +
      (c.id || '') +
      ') por R$ ' +
      cp.toFixed(2).replace('.', ',') +
      (u ? '. Link: ' + u : '') +
      '.\n';
  }

  return (
    'Voce e um atendente da Conforta Colchoes (colchoes, camas, sofas e moveis). Fale como pessoa prestativa da loja: natural, caloroso, portugues do Brasil.\n' +
    'Use SOMENTE o catalogo abaixo para nomes, precos, ids e links. Nao invente produtos nem valores.\n' +
    'Cada linha tem [id:...] — use esse id para identificar o produto certo quando o cliente perguntar por nome parecido.\n' +
    'Orcamento com frete: so no checkout; nao invente total fechado.\n' +
    'Parcelamento: referencia = preco a vista do catalogo dividido; condicao final no checkout.\n' +
    cheapestLine +
    '\nCatalogo oficial (menor ao maior preco):\n' +
    (lines.length ? lines.join('\n') : '(catalogo vazio — diga que o cliente confira no site)')
  );
}

function safeProductJson(product) {
  try {
    const s = JSON.stringify(product);
    if (s.length > 12000) return s.slice(0, 12000) + '\n...(truncado)';
    return s;
  } catch (_) {
    return '{}';
  }
}

function buildProductFocusBlock(product, siteBase) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) return '';
  const id = product.id || product.product_id || '';
  const link = id ? productPageUrl(siteBase, id) : product.product_page_url || '';
  return (
    '\n\n[PRODUTO EM FOCO — priorize estes dados para esta resposta; nao troque por outro item do catalogo]\n' +
    safeProductJson(product) +
    (link ? '\nLink oficial deste produto: ' + link : '')
  );
}

/** Monta messages finais: system com catalogo + historico + produto em foco. */
async function assembleBrainMessages(opts) {
  opts = opts || {};
  const siteBase = opts.siteBase || process.env.SITE_PUBLIC_URL || '';
  const includeCatalog = opts.includeCatalog !== false;
  const product = opts.product || null;

  let sorted = [];
  if (includeCatalog) {
    sorted = sortProductsByPrice(await fetchStoreCatalog());
  }

  let systemContent = includeCatalog
    ? buildCatalogSystemPrompt(sorted, siteBase)
  : 'Voce e o assistente da Conforta Colchoes. Responda em portugues do Brasil.';

  if (product) systemContent += buildProductFocusBlock(product, siteBase);

  if (opts.extraSystem && String(opts.extraSystem).trim()) {
    systemContent += '\n\n' + String(opts.extraSystem).trim();
  }

  const history = (opts.history || [])
    .filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant');
    })
    .map(function (m) {
      return { role: m.role, content: String(m.content == null ? '' : m.content) };
    })
    .slice(-14);

  const userMsg = String(opts.userMessage || '').trim();
  const out = [{ role: 'system', content: systemContent }].concat(history);
  if (userMsg) out.push({ role: 'user', content: userMsg });
  return { messages: out, catalogCount: sorted.length };
}

function isSupabaseConfigured() {
  const base = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return !!(base && key);
}

module.exports = {
  fetchStoreCatalog,
  sortProductsByPrice,
  buildCatalogSystemPrompt,
  assembleBrainMessages,
  isSupabaseConfigured,
  productPageUrl,
  safeProductJson
};
