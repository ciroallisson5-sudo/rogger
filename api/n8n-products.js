'use strict';

/**
 * Catalogo JSON para n8n / integracoes server-side.
 * GET /api/n8n-products
 * Autenticacao: header x-n8n-products-secret (ou Authorization: Bearer <mesmo valor>).
 */

const { applyBrowserCors, handleOptions } = require('./_http');
const { rateLimitKey, allow, prune } = require('./_rate-limit');

const SECRET = (process.env.N8N_PRODUCTS_SECRET || '').trim();

const SELECT =
  'id,name,slug,description,active,base_price,discount_price,stock,featured,tags,weight,dimensions,material,warranty,created_at,categories(name,slug),product_photos(id,url,thumb_url,sort_order,is_video,video_url,color_name,color_hex,size,price,discount_price,custom_label,stock_override,active)';

function mapProduct(p) {
  const photos = (p.product_photos || []).filter(function (ph) {
    return ph && ph.active !== false;
  });
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    category: p.categories ? p.categories.name : null,
    category_slug: p.categories ? p.categories.slug : null,
    base_price: parseFloat(p.base_price) || 0,
    discount_price: p.discount_price != null && p.discount_price !== '' ? parseFloat(p.discount_price) : null,
    stock: p.stock,
    featured: p.featured,
    tags: p.tags,
    weight: p.weight,
    dimensions: p.dimensions,
    material: p.material,
    warranty: p.warranty,
    photos: photos.map(function (ph) {
      return {
        id: ph.id,
        url: ph.url,
        thumb_url: ph.thumb_url || null,
        sort_order: ph.sort_order != null ? Number(ph.sort_order) : 0,
        is_video: !!ph.is_video,
        video_url: ph.video_url || null,
        color_name: ph.color_name,
        color_hex: ph.color_hex,
        size: ph.size,
        price: ph.price != null ? parseFloat(ph.price) : null,
        discount_price: ph.discount_price != null ? parseFloat(ph.discount_price) : null,
        custom_label: ph.custom_label,
        stock_override: ph.stock_override
      };
    }),
    created_at: p.created_at
  };
}

module.exports = async function handler(req, res) {
  prune();
  applyBrowserCors(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = rateLimitKey(req, 'n8n-prod');
  if (!allow(key, 40, 60000)) {
    res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    return;
  }

  if (process.env.VERCEL_ENV === 'production' && !SECRET) {
    res.status(503).json({
      error: 'Em producao e obrigatorio definir N8N_PRODUCTS_SECRET na Vercel.'
    });
    return;
  }

  if (SECRET) {
    const h = String(req.headers['x-n8n-products-secret'] || req.headers['X-N8n-Products-Secret'] || '').trim();
    const auth = String(req.headers.authorization || '');
    const tok = auth.replace(/^Bearer\s+/i, '').trim();
    const ok = (h && h === SECRET) || tok === SECRET;
    if (!ok) {
      res.status(401).json({
        error: 'Credencial invalida ou ausente. Envie o header x-n8n-products-secret.'
      });
      return;
    }
  }

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!svc || !base) {
    res.status(503).json({ error: 'Supabase não configurado no servidor.' });
    return;
  }

  let flatImages = false;
  let onePerProduct = false;
  let allPhotos = false;
  try {
    const u = new URL(req.url || '', 'http://localhost');
    const explicitOne = u.searchParams.get('one_per_product') === '1';
    flatImages = u.searchParams.get('flat_images') === '1' || explicitOne;
    allPhotos = u.searchParams.get('all_photos') === '1';
    if (explicitOne) flatImages = true;
    onePerProduct = explicitOne || (flatImages && !allPhotos);
  } catch (_) {
    /**/
  }

  const url =
    base + '/rest/v1/products?active=eq.true&select=' + encodeURIComponent(SELECT) + '&order=name.asc&limit=500';

  try {
    const fetchRes = await fetch(url, {
      headers: {
        apikey: svc,
        Authorization: 'Bearer ' + svc
      }
    });
    const raw = await fetchRes.json().catch(function () {
      return [];
    });
    if (!fetchRes.ok) {
      res.status(fetchRes.status >= 400 ? fetchRes.status : 502).json({
        error: 'Falha ao ler produtos no Supabase'
      });
      return;
    }
    const rows = Array.isArray(raw) ? raw : [];
    const products = rows.map(mapProduct);

    if (flatImages) {
      const images = [];
      products.forEach(function (p) {
        const list = (p.photos || [])
          .filter(function (ph) {
            return ph && !ph.is_video && ph.url;
          })
          .slice()
          .sort(function (a, b) {
            return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
          });
        if (onePerProduct) {
          const ph = list[0];
          if (ph) {
            images.push({
              product_id: p.id,
              product_name: p.name,
              url: ph.url,
              thumb_url: ph.thumb_url || null
            });
          }
          return;
        }
        list.forEach(function (ph) {
          images.push({
            product_id: p.id,
            product_name: p.name,
            url: ph.url,
            thumb_url: ph.thumb_url || null
          });
        });
      });
      res.status(200).json({
        mode: onePerProduct ? 'one_image_per_product' : 'all_photos_per_product',
        total_images: images.length,
        exported_at: new Date().toISOString(),
        images: images
      });
      return;
    }

    res.status(200).json({
      total: products.length,
      exported_at: new Date().toISOString(),
      products: products
    });
  } catch (err) {
    void err;
    res.status(500).json({ error: 'Erro interno' });
  }
};
