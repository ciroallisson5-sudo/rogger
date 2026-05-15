'use strict';

/**
 * Catálogo JSON para n8n / WhatsApp (não oficial): produtos ativos + fotos (URLs Supabase Storage).
 *
 * GET /api/n8n-products
 * Segurança (recomendado em produção): header
 *   Authorization: Bearer <N8N_PRODUCTS_SECRET>
 * ou query ?secret=<N8N_PRODUCTS_SECRET>
 *
 * Opções (lista plana = JSON com array `images` para loop WhatsApp):
 *   ?flat_images=1 — por defeito **1 foto por produto** (hero: primeira imagem por sort_order, sem vídeo).
 *   ?flat_images=1&all_photos=1 — **todas** as fotos de cada produto (comportamento antigo).
 *   ?one_per_product=1 — igual a flat com 1 foto (podes usar sem flat_images).
 *
 * Mesma chave sempre: N8N_PRODUCTS_SECRET (Bearer ou ?secret=).
 */

const SECRET = process.env.N8N_PRODUCTS_SECRET || '';

function checkAuth(req) {
  if (!SECRET) return true;
  const auth = req.headers.authorization || '';
  const tok = auth.replace(/^Bearer\s+/i, '').trim();
  if (tok && tok === SECRET) return true;
  try {
    const u = new URL(req.url || '', 'http://localhost');
    const q = u.searchParams.get('secret');
    if (q && q === SECRET) return true;
  } catch (_) {
    /**/
  }
  return false;
}

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (process.env.VERCEL_ENV === 'production' && !SECRET) {
    res.status(503).json({
      error:
        'Em producao e obrigatorio definir N8N_PRODUCTS_SECRET na Vercel (Bearer ou ?secret=).'
    });
    return;
  }

  if (!checkAuth(req)) {
    res.status(401).json({
      error:
        'Token invalido ou ausente. Envie Authorization: Bearer <N8N_PRODUCTS_SECRET> ou ?secret=<valor>'
    });
    return;
  }

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!svc || !base) {
    res.status(503).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nao configurados' });
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
    /* flat_images só: predefinição = cardápio WhatsApp (1 hero por SKU). all_photos=1 volta a listar todas. */
    onePerProduct = explicitOne || (flatImages && !allPhotos);
  } catch (_) {
    /**/
  }

  const url =
    base +
    '/rest/v1/products?active=eq.true&select=*,categories(name,slug),product_photos(*)&order=name.asc&limit=500';

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
        error: 'Falha ao ler produtos no Supabase',
        detail: raw
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
    console.error('[n8n-products]', err);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
};
