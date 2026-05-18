/**
 * Card de produto — home (grid simples), dimensões fixas de imagem e CTAs acessíveis.
 */
(function (global) {
  'use strict';

  var IMG_W = 800;
  var IMG_H = 800;

  function esc(s) {
    return typeof global.escapeHTML === 'function' ? global.escapeHTML(s) : String(s || '');
  }

  function escAttrUrl(u) {
    return String(u || '').replace(/"/g, '%22');
  }

  global.absolutizeConfortaPhotoUrl = function absolutizeConfortaPhotoUrl(u) {
    if (u == null || u === '') return '';
    var s = String(u).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (typeof SUPABASE_CONFIG !== 'undefined' && SUPABASE_CONFIG && SUPABASE_CONFIG.url) {
      try {
        var base = String(SUPABASE_CONFIG.url).replace(/\/$/, '');
        return new URL(s.startsWith('/') ? s : '/' + s, base + '/').href;
      } catch (_) {
        /* ignore */
      }
    }
    try {
      return new URL(s, global.location.origin).href;
    } catch (_) {
      return s;
    }
  };

  function productImageTag(url, productName, loading) {
    var abs = global.absolutizeConfortaPhotoUrl(url);
    var name =
      typeof normalizeConfortaBranding === 'function'
        ? normalizeConfortaBranding(productName || 'Produto')
        : productName || 'Produto';
    var alt =
      'Foto do colchão ou móvel: ' +
      name +
      ' — Conforta Colchões (Serra, Vitória e ES)';
    return (
      '<img src="' +
      escAttrUrl(abs) +
      '" alt="' +
      esc(alt) +
      '" width="' +
      IMG_W +
      '" height="' +
      IMG_H +
      '" loading="' +
      (loading || 'lazy') +
      '" decoding="async" sizes="(max-width: 768px) 50vw, 25vw">'
    );
  }

  /**
   * Card usado na home (index): grid .product-card.
   * @param {object} p produto
   * @param {{ countdownId?: string }} opts
   */
  global.buildConfortaHomeProductCardHtml = function buildConfortaHomeProductCardHtml(p, opts) {
    opts = opts || {};
    var categoryNames = { 1: 'Colchões', 2: 'Sofás', 3: 'Box baú', 4: 'Cabeceiras', 5: 'Kits' };
    var img = '';
    if (p.product_photos && p.product_photos.length > 0 && p.product_photos[0].url) {
      img = productImageTag(p.product_photos[0].url, p.name, 'lazy');
    }
    var catName = categoryNames[p.category_id] || (p.category && p.category.name) || 'Produtos';

    var basePrice = parseFloat(p.base_price ?? p.price) || 0;
    var discountPrice = p.discount_price ?? p.sale_price;
    discountPrice =
      discountPrice === null || discountPrice === undefined || discountPrice === ''
        ? null
        : parseFloat(discountPrice);
    var displayPrice = discountPrice && discountPrice > 0 ? discountPrice : basePrice;
    var hasDiscount = !!(discountPrice && discountPrice > 0 && discountPrice < basePrice);

    var maxParcelas = parseInt(String(p.installment || p.max_installments || 12), 10);
    var installmentValue = displayPrice > 0 && maxParcelas > 0 ? displayPrice / maxParcelas : 0;
    var installmentHtml =
      installmentValue >= 20
        ? '<span class="product-installment">' +
          maxParcelas +
          'x de R$ ' +
          installmentValue.toFixed(2).replace('.', ',') +
          ' sem juros</span>'
        : '';

    var href = 'produto.html?id=' + encodeURIComponent(p.id);
    var countdownHtml = '';
    if (opts.countdownId) {
      countdownHtml =
        '<span class="product-countdown" data-countdown="' +
        esc(opts.countdownId) +
        '"></span>';
    }
    var safeId = String(p.id).replace(/'/g, "\\'");
    var displayName =
      typeof normalizeConfortaBranding === 'function' ? normalizeConfortaBranding(p.name) : p.name;

    var sizeLine = '';
    var dim = (p.dimensions != null && String(p.dimensions).trim()) || (p.size != null && String(p.size).trim()) || '';
    if (dim) {
      sizeLine = '<span class="product-size" title="Tamanho / dimensões informados no cadastro">' + esc(dim) + '</span>';
    }

    var waMsg =
      'Olá! Tenho interesse em ' +
      String(displayName || 'um produto').replace(/'/g, '') +
      ' e quero tirar uma dúvida antes de comprar.';
    var waHref = '#';
    return (
      '<div class="product-card" data-id="' +
      esc(String(p.id)) +
      '" onclick="if(event.target.closest(\'a,button\'))return;window.location.href=\'' +
      href +
      '\';">' +
      '<a href="' +
      href +
      '" class="product-image" onclick="event.stopPropagation()">' +
      img +
      '<span class="product-delivery-badge" aria-hidden="true">Entrega na região</span>' +
      '</a>' +
      '<div class="product-body">' +
      '<span class="product-category">' +
      esc(catName) +
      '</span>' +
      '<a href="' +
      href +
      '" style="color:inherit;text-decoration:none;flex:1;" onclick="event.stopPropagation()"><h3 class="product-name">' +
      esc(displayName) +
      '</h3></a>' +
      sizeLine +
      countdownHtml +
      (hasDiscount
        ? '<span class="product-flash"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Oferta</span>'
        : '') +
      (hasDiscount
        ? '<span class="product-old-price">R$ ' + basePrice.toFixed(2).replace('.', ',') + '</span>'
        : '') +
      '<span class="product-price-label">À vista</span>' +
      '<span class="product-price">R$ ' + displayPrice.toFixed(2).replace('.', ',') + '</span>' +
      installmentHtml +
      '<div class="product-card-actions">' +
      '<a class="btn-product-buy" href="' +
      href +
      '" onclick="event.stopPropagation()">Comprar</a>' +
      '<button type="button" class="btn-add-cart" aria-label="Adicionar ' +
      esc(displayName) +
      ' ao carrinho" onclick="event.stopPropagation();addProductToCart(\'' +
      safeId +
      '\')">Carrinho</button>' +
      '<a class="btn-product-wa js-home-product-whatsapp" href="' +
      escAttrUrl(waHref) +
      '" data-wa-message="' +
      esc(waMsg) +
      '" onclick="event.stopPropagation()" aria-label="Tirar dúvida sobre o colchão ideal no WhatsApp">WhatsApp</a>' +
      '</div>' +
      '</div></div>'
    );
  };
})(typeof window !== 'undefined' ? window : globalThis);
