// Conforta Store - Cart
// Nome da API: addProductToCart — evita conflito com window.addToCart em produto.html.

async function getOrCreateCart() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');

  try {
    const cartId = await supabaseRpc('get_or_create_cart', { p_user_id: user.id });
    if (cartId) return cartId;
  } catch (e) {
    void e;
  }

  const { data: existing } = await sb.from('carts').select('id').eq('user_id', user.id).maybeSingle();
  if (existing && existing.id) return existing.id;

  const { data: inserted, error } = await sb.from('carts').insert({ user_id: user.id }).select('id').single();
  if (error) throw error;
  if (!inserted || !inserted.id) throw new Error('Nao foi possivel criar o carrinho');
  return inserted.id;
}

async function addProductToCart(productId, photoId, quantity, unitPrice) {
  try {
    if (!productId) throw new Error('Produto invalido');

    const sb = getSupabase();
    if (!sb) throw new Error('Servico indisponivel');

    // Default values
    photoId = photoId || null;
    quantity = quantity || 1;

    // Verifica autenticacao
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      showToast('Faca login para adicionar ao carrinho', 'warning');
      setTimeout(() => {
        if (typeof siteNavigate === 'function') siteNavigate('perfil.html');
        else window.location.href = 'perfil.html';
      }, 1200);
      return;
    }

    // Busca preco se nao foi passado
    if (unitPrice === undefined || unitPrice === null || isNaN(parseFloat(unitPrice))) {
      const { data: prod } = await sb.from('products')
        .select('discount_price, base_price')
        .eq('id', productId)
        .maybeSingle();
      if (prod) {
        unitPrice = parseFloat(prod.discount_price || prod.base_price) || 0;
      } else {
        throw new Error('Produto nao encontrado');
      }
    }

    showLoading(true);
    const cartId = await getOrCreateCart();

    let existingQuery = sb.from('cart_items')
      .select('*')
      .eq('cart_id', cartId)
      .eq('product_id', productId);
    if (photoId) {
      existingQuery = existingQuery.eq('photo_id', photoId);
    } else {
      existingQuery = existingQuery.is('photo_id', null);
    }
    const { data: existing } = await existingQuery;

    if (existing && existing.length > 0) {
      const prevQty = parseInt(existing[0].quantity, 10) || 0;
      const addQty = parseInt(quantity, 10) || 0;
      const newQty = prevQty + addQty;
      const { error: updErr } = await sb.from('cart_items')
        .update({ quantity: newQty })
        .eq('id', existing[0].id);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await sb.from('cart_items').insert({
        cart_id: cartId,
        product_id: productId,
        photo_id: photoId,
        quantity: quantity,
        unit_price: unitPrice
      });
      if (insErr) throw insErr;
    }
    updateCartCount();
    showToast('Produto adicionado ao carrinho', 'success');
    refreshCartViews();
  } catch (e) {
    var msg = (e && (e.message || e.error_description)) || 'Erro ao adicionar ao carrinho';
    showToast(msg, 'error');
  } finally {
    showLoading(false);
  }
}

async function enrichCartItems(sb, items) {
  if (!items || items.length === 0) return items;
  const needProdIds = [];
  const needPhotoIds = [];
  items.forEach(function(it) {
    if (it.product_id && !it.product) needProdIds.push(it.product_id);
    if (it.photo_id && !it.photo) needPhotoIds.push(it.photo_id);
  });
  const uniq = function(arr) {
    var s = {};
    return arr.filter(function(id) {
      var k = String(id);
      if (s[k]) return false;
      s[k] = true;
      return true;
    });
  };
  var prodMap = {};
  var photoMap = {};
  if (needProdIds.length > 0) {
    const { data: prows } = await sb.from('products')
      .select('id, name, slug, base_price, discount_price')
      .in('id', uniq(needProdIds));
    (prows || []).forEach(function(p) {
      prodMap[String(p.id)] = p;
    });
  }
  if (needPhotoIds.length > 0) {
    const { data: phrows } = await sb.from('product_photos')
      .select('id, url, thumb_url, color_name, color_hex, price, discount_price, custom_label')
      .in('id', uniq(needPhotoIds));
    (phrows || []).forEach(function(ph) {
      photoMap[String(ph.id)] = ph;
    });
  }
  return items.map(function(it) {
    var pid = it.product_id != null ? String(it.product_id) : '';
    var phid = it.photo_id != null ? String(it.photo_id) : '';
    return {
      ...it,
      product: it.product || (pid ? prodMap[pid] : null) || null,
      photo: it.photo || (phid ? photoMap[phid] : null) || null
    };
  });
}

async function getCartItems() {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return [];
    const { data: cart } = await sb.from('carts').select('id').eq('user_id', user.id).maybeSingle();
    if (!cart) return [];
    const { data: items, error } = await sb
      .from('cart_items')
      .select(`
        id,
        cart_id,
        product_id,
        photo_id,
        quantity,
        unit_price,
        created_at,
        product:products (
          id,
          name,
          slug,
          base_price,
          discount_price
        ),
        photo:product_photos (
          id,
          url,
          thumb_url,
          color_name,
          color_hex,
          price,
          discount_price,
          custom_label
        )
      `)
      .eq('cart_id', cart.id)
      .order('created_at', { ascending: false });
    if (error) {
      // Fallback: busca sem join se algo na relacao falhar
      const fb = await sb
        .from('cart_items')
        .select('*')
        .eq('cart_id', cart.id)
        .order('created_at', { ascending: false });
      if (fb.error) throw fb.error;
      const raw = (fb.data || []).map(function(it) { return { ...it, product: null, photo: null }; });
      return await enrichCartItems(sb, raw);
    }
    return await enrichCartItems(sb, items || []);
  } catch (e) {
    return [];
  }
}

async function updateCartItemQuantity(itemId, quantity) {
  try {
    if (quantity < 1) return;
    showLoading(true);
    await supabaseUpdate('cart_items', { quantity }, { id: itemId });
    updateCartCount();
    refreshCartViews();
  } catch (e) {
    showToast('Erro ao atualizar quantidade', 'error');
    throw e;
  } finally {
    showLoading(false);
  }
}

async function removeCartItem(itemId) {
  try {
    showLoading(true);
    await supabaseDelete('cart_items', { id: itemId });
    updateCartCount();
    showToast('Item removido do carrinho', 'success');
    refreshCartViews();
  } catch (e) {
    showToast('Erro ao remover item', 'error');
    throw e;
  } finally {
    showLoading(false);
  }
}

async function getCartTotal() {
  const items = await getCartItems();
  return items.reduce((acc, item) => {
    const q = parseInt(item.quantity, 10) || 1;
    return acc + getItemPrice(item) * q;
  }, 0);
}

async function clearCart() {
  try {
    showLoading(true);
    const { data: { user } } = await getSupabase().auth.getUser();
    if (!user) return;
    const { data: cart } = await getSupabase().from('carts').select('id').eq('user_id', user.id).maybeSingle();
    if (cart) {
      await supabaseDelete('cart_items', { cart_id: cart.id });
    }
    updateCartCount();
    showToast('Carrinho limpo', 'success');
    refreshCartViews();
  } catch (e) {
    showToast('Erro ao limpar carrinho', 'error');
    throw e;
  } finally {
    showLoading(false);
  }
}

function getItemPrice(item) {
  if (!item) return 0;
  const ph = item.photo || {};
  const pr = item.product || {};
  const photoSale = ph.discount_price != null ? parseFloat(ph.discount_price) : null;
  const photoBase = ph.price != null ? parseFloat(ph.price) : null;
  const prodSale = pr.discount_price != null ? parseFloat(pr.discount_price) : null;
  const prodBase = pr.base_price != null ? parseFloat(pr.base_price) : null;
  const fallback = item.unit_price != null ? parseFloat(item.unit_price) : 0;
  return (photoSale || photoBase || prodSale || prodBase || fallback) || 0;
}

function getItemImage(item) {
  if (item?.photo?.thumb_url) return item.photo.thumb_url;
  if (item?.photo?.url) return item.photo.url;
  return (typeof assetUrl === 'function') ? assetUrl('assets/logo.png') : 'assets/logo.png';
}

function normalizeColchaoDisplay(name) {
  const s = String(name || '');
  return s
    .replace(/\bCOLCHAO\b/g, 'COLCHÃO')
    .replace(/\bColchao\b/g, 'Colchão')
    .replace(/\bcolchao\b/g, 'colchão');
}

function getItemName(item) {
  const raw = item?.product?.name || item?.photo?.custom_label || 'Produto';
  return normalizeColchaoDisplay(raw);
}

function getItemProductUrl(item) {
  return item && item.product_id ? `produto.html?id=${encodeURIComponent(item.product_id)}` : 'produtos.html';
}

function getItemVariantText(item) {
  const parts = [];
  const colorName = getItemColor(item);
  if (colorName) parts.push(colorName);
  if (item?.photo?.custom_label) parts.push(item.photo.custom_label);
  return parts.filter(Boolean).join(' • ');
}

function getItemColor(item) {
  return item?.photo?.color_name || null;
}

function getItemColorHex(item) {
  return item?.photo?.color_hex || null;
}

function escCart(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cartInstallmentText(total) {
  const installments = typeof calcInstallments === 'function' ? calcInstallments(total, 12, 20) : [];
  if (installments && installments.length > 0) {
    const best = installments[installments.length - 1];
    return `ou ${best.qtd}x de ${formatPrice(best.valor)} sem juros`;
  }
  return 'Pagamento facilitado';
}

function cartWhatsappHref(message) {
  const text = message || 'Ola! Tenho duvidas sobre meu carrinho na Conforta Colchões. Pode me ajudar?';
  if (window.CONFORTA_WHATSAPP_URL) return `${window.CONFORTA_WHATSAPP_URL}?text=${encodeURIComponent(text)}`;
  return '#';
}

function navigateToCartPage() {
  if (typeof siteNavigate === 'function') siteNavigate('carrinho.html');
  else window.location.href = 'carrinho.html';
}

function refreshCartViews() {
  renderCartSidebarItems();
  if (typeof window.__refreshFullCart === 'function') window.__refreshFullCart();
}

function openCartWhatsapp(e) {
  if (window.CONFORTA_WHATSAPP_URL) return;
  if (e) e.preventDefault();
  if (typeof window.openChatWidget === 'function') window.openChatWidget();
  else if (typeof window.toggleChat === 'function') window.toggleChat();
  else if (typeof showToast === 'function') showToast('Atendimento indisponivel no momento', 'info');
}

function updateCartWhatsappLinks() {
  document.querySelectorAll('.js-cart-whatsapp').forEach(function(link) {
    link.href = cartWhatsappHref(link.getAttribute('data-message'));
    if (window.CONFORTA_WHATSAPP_URL) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
  });
}

async function configureCartWhatsapp() {
  if (window.CONFORTA_WHATSAPP_URL) {
    updateCartWhatsappLinks();
    return;
  }
  try {
    let phone = '';
    if (typeof getSetting === 'function') phone = await getSetting('whatsapp_number');
    if (!phone && typeof getSetting === 'function') phone = await getSetting('contact_phone');
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits) {
      window.CONFORTA_WHATSAPP_URL = `https://wa.me/${(digits.length === 10 || digits.length === 11) ? '55' + digits : digits}`;
      updateCartWhatsappLinks();
    }
  } catch (e) {}
}

function renderCartSkeleton() {
  return `
    <div class="cart-skeleton">
      <div class="cart-skeleton-item">
        <span class="cart-sk cart-sk-img"></span>
        <div class="cart-sk-body">
          <span class="cart-sk cart-sk-line"></span>
          <span class="cart-sk cart-sk-line short"></span>
          <span class="cart-sk cart-sk-qty"></span>
        </div>
      </div>
      <div class="cart-skeleton-item">
        <span class="cart-sk cart-sk-img"></span>
        <div class="cart-sk-body">
          <span class="cart-sk cart-sk-line"></span>
          <span class="cart-sk cart-sk-line short"></span>
          <span class="cart-sk cart-sk-qty"></span>
        </div>
      </div>
    </div>
  `;
}

function renderCartItem(item) {
  const qty = parseInt(item.quantity, 10) || 1;
  const price = getItemPrice(item);
  const total = price * qty;
  const colorName = getItemColor(item);
  const colorHex = getItemColorHex(item);
  const colorHtml = colorName
    ? `<span class="cart-item-color">
        <span class="color-swatch" style="background:${escCart(colorHex || '#ccc')}"></span>
        ${escCart(colorName)}
      </span>`
    : '';
  const safeId = escCart(item.id);
  const name = escCart(getItemName(item));
  const img = escCart(getItemImage(item));
  const variantText = escCart(getItemVariantText(item));
  const productUrl = escCart(getItemProductUrl(item));

  return `
    <article class="cart-item" data-id="${safeId}">
      <div class="cart-item-image">
        <img src="${img}" alt="${name}" loading="lazy">
      </div>
      <div class="cart-item-info">
        <div class="cart-item-top">
          <div>
            <h4 class="cart-item-name">${name}</h4>
            ${variantText ? `<p class="cart-item-variant">${variantText}</p>` : colorHtml}
          </div>
          <button class="cart-item-remove" onclick="removeCartItem('${safeId}')" aria-label="Remover ${name}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="cart-delivery-note">Entrega rapida na regiao</p>
        <div class="cart-item-bottom">
          <div>
            <span class="cart-item-label">Preco unitario</span>
            <strong class="cart-item-price">${formatPrice(price)}</strong>
            <a class="cart-product-link" href="${productUrl}">Ver produto</a>
          </div>
          <div class="cart-item-qty" aria-label="Quantidade">
            <button class="qty-btn" onclick="updateCartItemQuantity('${safeId}', ${qty - 1})" ${qty <= 1 ? 'disabled' : ''} aria-label="Diminuir quantidade">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
          </button>
          <span class="qty-value">${qty}</span>
            <button class="qty-btn" onclick="updateCartItemQuantity('${safeId}', ${qty + 1})" aria-label="Aumentar quantidade">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          </div>
          <div class="cart-item-subtotal">
            <span class="cart-item-label">Subtotal</span>
            <strong>${formatPrice(total)}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

async function renderCartSidebarItems() {
  const list = document.getElementById('cartSidebarItems');
  const totalEl = document.getElementById('cartSidebarTotal');
  const emptyEl = document.getElementById('cartSidebarEmpty');
  const footerEl = document.getElementById('cartSidebarFooter');
  const panelEl = document.getElementById('cartProductsPanel');
  const mobileBarEl = document.getElementById('cartMobileBar');
  if (!list) return;

  list.innerHTML = renderCartSkeleton();
  if (emptyEl) emptyEl.style.display = 'none';
  if (footerEl) footerEl.style.display = 'none';
  if (panelEl) panelEl.style.display = 'grid';
  if (mobileBarEl) mobileBarEl.style.display = 'none';

  let items = [];
  try {
    items = await getCartItems();
  } catch (e) {
    list.innerHTML = `
      <div class="cart-state-card">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 17h.01"/></svg>
        <h4>Nao foi possivel carregar seu carrinho</h4>
        <p>Tente novamente ou fale com nossa equipe para finalizar sua compra pelo WhatsApp.</p>
        <button class="btn btn-primary btn-block" onclick="renderCartSidebarItems()">Tentar novamente</button>
        <a class="btn btn-outline btn-block js-cart-whatsapp" href="${cartWhatsappHref()}">Falar no WhatsApp</a>
      </div>
    `;
    updateCartWhatsappLinks();
    if (footerEl) footerEl.style.display = 'none';
    if (mobileBarEl) mobileBarEl.style.display = 'none';
    return;
  }

  if (items.length === 0) {
    list.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    if (footerEl) footerEl.style.display = 'none';
    if (panelEl) panelEl.style.display = 'none';
    if (mobileBarEl) mobileBarEl.style.display = 'none';
    renderCartComplements([]);
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (footerEl) footerEl.style.display = 'grid';
  if (panelEl) panelEl.style.display = 'grid';
  if (mobileBarEl) mobileBarEl.style.display = '';

  list.innerHTML = items.map(renderCartItem).join('');

  const total = items.reduce((acc, item) => {
    const q = parseInt(item.quantity, 10) || 1;
    return acc + getItemPrice(item) * q;
  }, 0);

  if (totalEl) totalEl.textContent = formatPrice(total);
  const subtotalEl = document.getElementById('cartSidebarSubtotal');
  const installmentEl = document.getElementById('cartSidebarInstallments');
  const mobileTotalEl = document.getElementById('cartMobileTotal');
  if (subtotalEl) subtotalEl.textContent = formatPrice(total);
  if (installmentEl) installmentEl.textContent = cartInstallmentText(total);
  if (mobileTotalEl) mobileTotalEl.textContent = formatPrice(total);
  renderCartComplements(items);
  updateCartWhatsappLinks();
}

async function renderCartComplements(cartItems) {
  const section = document.getElementById('cartComplements');
  const grid = document.getElementById('cartComplementGrid');
  if (!section || !grid) return;
  if (!cartItems || cartItems.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  try {
    const sb = getSupabase();
    if (!sb) return;
    const currentIds = {};
    cartItems.forEach(function(item) {
      if (item.product_id) currentIds[String(item.product_id)] = true;
    });

    const { data, error } = await sb.from('products')
      .select('id, name, base_price, discount_price, category_id, product_photos(id, url, thumb_url)')
      .eq('active', true)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(8);

    if (error || !data) {
      section.style.display = 'none';
      return;
    }

    const products = data.filter(function(product) {
      return !currentIds[String(product.id)];
    }).slice(0, 4);

    if (products.length === 0) {
      section.style.display = 'none';
      return;
    }

    grid.innerHTML = products.map(function(product) {
      const photo = product.product_photos && product.product_photos.length ? product.product_photos[0] : null;
      const price = parseFloat(product.discount_price || product.base_price || 0) || 0;
      const img = photo && (photo.thumb_url || photo.url);
      return `
        <article class="cart-complement-card">
          <a class="cart-complement-img" href="produto.html?id=${encodeURIComponent(product.id)}">
            ${img ? `<img src="${escCart(img)}" alt="${escCart(product.name)}" loading="lazy">` : `<span>Conforta</span>`}
          </a>
          <div class="cart-complement-body">
            <h5>${escCart(product.name)}</h5>
            <strong>${formatPrice(price)}</strong>
            <div class="cart-complement-actions">
          <button class="btn btn-primary btn-sm" onclick="addProductToCart('${escCart(product.id)}', null, 1, ${price}).then(function(){ renderCartSidebarItems(); })">Adicionar</button>
              <a class="btn btn-outline btn-sm" href="produto.html?id=${encodeURIComponent(product.id)}">Ver produto</a>
            </div>
          </div>
        </article>
      `;
    }).join('');
    section.style.display = 'block';
  } catch (e) {
    section.style.display = 'none';
  }
}

function renderCartSidebar() {
  if (document.body.classList.contains('cc-page-checkout')) return;
  if (document.getElementById('cartSidebar')) return;
  const html = `
    <div class="cart-sidebar-overlay" id="cartSidebarOverlay" onclick="closeCartSidebar()"></div>
    <div class="cart-sidebar" id="cartSidebar">
      <div class="cart-sidebar-header">
        <div>
          <h3>Meu Carrinho</h3>
          <p>Confira seus produtos antes de finalizar a compra.</p>
          <div class="cart-benefits">
            <span>Compra segura</span>
            <span>WhatsApp</span>
            <span>Entrega rapida</span>
            <span>Ate 12x sem juros</span>
          </div>
        </div>
        <button class="cart-sidebar-close" onclick="closeCartSidebar()" aria-label="Fechar carrinho">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cart-sidebar-body">
        <div class="cart-sidebar-empty" id="cartSidebarEmpty">
          <svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
          </svg>
          <h4>Seu carrinho esta vazio</h4>
          <p>Veja nossas ofertas e encontre o colchao ideal para dormir melhor.</p>
          <div class="cart-empty-actions">
            <a class="btn btn-primary" href="produtos.html">Ver produtos</a>
            <a class="btn btn-outline js-cart-whatsapp" href="${cartWhatsappHref()}">Falar no WhatsApp</a>
          </div>
        </div>
        <section class="cart-products-panel" id="cartProductsPanel" aria-label="Produtos no carrinho">
          <div class="cart-panel-heading">
            <h4>Produtos escolhidos</h4>
            <span>Voce esta a poucos passos de dormir melhor.</span>
          </div>
          <div class="cart-sidebar-items" id="cartSidebarItems"></div>
          <div class="cart-complements" id="cartComplements" style="display:none">
            <div class="cart-panel-heading">
              <h4>Complete seu quarto</h4>
              <span>Produtos selecionados para complementar sua compra.</span>
            </div>
            <div class="cart-complement-grid" id="cartComplementGrid"></div>
          </div>
        </section>
      </div>
      <div class="cart-sidebar-footer" id="cartSidebarFooter" style="display:none">
        <h4>Resumo do pedido</h4>
        <div class="cart-summary-lines">
          <div><span>Subtotal</span><strong id="cartSidebarSubtotal">R$ 0,00</strong></div>
          <div><span>Desconto</span><strong>R$ 0,00</strong></div>
          <div><span>Frete</span><strong>A confirmar</strong></div>
          <div class="cart-summary-total"><span>Total</span><strong class="cart-sidebar-total" id="cartSidebarTotal">R$ 0,00</strong></div>
        </div>
        <div class="cart-installments" id="cartSidebarInstallments">Pagamento facilitado</div>
        <div class="cart-delivery-box">
          <strong>Entrega rapida em Serra, Vitoria e regiao.</strong>
          <span>Frete e prazo podem ser confirmados no checkout ou pelo WhatsApp.</span>
        </div>
        <button class="btn btn-primary btn-block cart-checkout-btn" onclick="handleCheckout()">Finalizar compra</button>
        <a class="btn btn-secondary btn-block" href="produtos.html">Continuar comprando</a>
        <a class="btn btn-outline btn-block js-cart-whatsapp" href="${cartWhatsappHref()}">Tirar duvida no WhatsApp</a>
        <p class="cart-secure-copy">Finalize sua compra com seguranca. Pagamento facilitado.</p>
      </div>
      <div class="cart-mobile-bar" id="cartMobileBar" style="display:none">
        <div><span>Total</span><strong id="cartMobileTotal">R$ 0,00</strong></div>
        <button class="btn btn-primary" onclick="handleCheckout()">Finalizar compra</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  updateCartWhatsappLinks();
}

function openCartSidebar() {
  const overlay = document.getElementById('cartSidebarOverlay');
  const sidebar = document.getElementById('cartSidebar');
  if (!overlay || !sidebar) {
    renderCartSidebar();
  }
  configureCartWhatsapp();
  document.getElementById('cartSidebarOverlay').classList.add('open');
  document.getElementById('cartSidebar').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderCartSidebarItems();
}

function closeCartSidebar() {
  const overlay = document.getElementById('cartSidebarOverlay');
  const sidebar = document.getElementById('cartSidebar');
  if (overlay) overlay.classList.remove('open');
  if (sidebar) sidebar.classList.remove('open');
  document.body.style.overflow = '';
}

function handleCheckout() {
  if (document.getElementById('cartSidebar')) closeCartSidebar();
  if (typeof siteNavigate === 'function') siteNavigate('checkout.html');
  else window.location.href = 'checkout.html';
}

async function initFullCartPage() {
  const root = document.getElementById('fullCartApp');
  if (!root) return;

  async function renderFull() {
    root.innerHTML = '<p class="cc-full-cart-loading">Carregando seu carrinho...</p>';
    const user = typeof checkAuth === 'function' ? await checkAuth() : null;
    if (!user) {
      root.innerHTML =
        '<div class="cc-full-cart-state">' +
        '<h2>Faca login para ver o carrinho</h2>' +
        '<p>Entre na sua conta para salvar itens e finalizar com seguranca.</p>' +
        '<div class="cc-full-cart-actions">' +
        '<a class="btn btn-primary" href="perfil.html">Fazer login</a>' +
        '<a class="btn btn-outline" href="produtos.html">Ver colchões</a>' +
        '</div></div>';
      return;
    }

    let items = [];
    try {
      items = await getCartItems();
    } catch (e) {
      root.innerHTML =
        '<div class="cc-full-cart-state"><h2>Nao foi possivel carregar</h2>' +
        '<p>Tente novamente em instantes.</p>' +
        '<button type="button" class="btn btn-primary" onclick="location.reload()">Recarregar</button></div>';
      return;
    }

    if (!items.length) {
      root.innerHTML =
        '<div class="cc-full-cart-state">' +
        '<h2>Seu carrinho esta vazio</h2>' +
        '<p>Adicione colchões, bases e acessorios antes de finalizar.</p>' +
        '<div class="cc-full-cart-actions">' +
        '<a class="btn btn-primary" href="produtos.html">Ver colchões</a>' +
        '</div></div>';
      return;
    }

    const total = items.reduce(function(acc, item) {
      const q = parseInt(item.quantity, 10) || 1;
      return acc + getItemPrice(item) * q;
    }, 0);

    root.innerHTML =
      '<div class="cc-full-cart-stack">' +
      '<section class="cc-full-cart-items-card" aria-label="Itens no carrinho">' +
      '<header class="cc-full-cart-items-head"><h2>Itens selecionados</h2><span>' + items.length + ' produto(s)</span></header>' +
      '<div class="cc-full-cart-items">' + items.map(renderCartItem).join('') + '</div>' +
      '</section>' +
      '<aside class="cc-full-cart-summary" aria-label="Resumo do pedido">' +
      '<h2>Resumo do pedido</h2>' +
      '<div class="cc-full-cart-lines">' +
      '<div><span>Subtotal</span><strong>' + formatPrice(total) + '</strong></div>' +
      '<div><span>Desconto</span><strong>R$ 0,00</strong></div>' +
      '<div><span>Frete</span><strong>A confirmar</strong></div>' +
      '</div>' +
      '<div class="cc-full-cart-total"><span>Total</span><strong>' + formatPrice(total) + '</strong></div>' +
      '<p class="cc-full-cart-install">' + escCart(cartInstallmentText(total)) + '</p>' +
      '<div class="cc-full-cart-delivery">' +
      '<strong>Entrega rapida em Serra, Vitoria e regiao.</strong>' +
      '<span>Frete e prazo sao confirmados no checkout.</span>' +
      '</div>' +
      '<button type="button" class="btn btn-primary btn-block btn-lg" onclick="handleCheckout()">Finalizar compra</button>' +
      '<a class="btn btn-secondary btn-block" href="produtos.html">Continuar comprando</a>' +
      '</aside></div>';

    updateCartCount();
  }

  await renderFull();
  window.__refreshFullCart = renderFull;
}

window.addProductToCart = addProductToCart;

document.addEventListener('DOMContentLoaded', () => {
  renderCartSidebar();
  configureCartWhatsapp();
  const cartBtn = document.getElementById('cartBtn');
  if (cartBtn) {
    cartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (document.body.classList.contains('cc-page-carrinho')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      navigateToCartPage();
    });
  }
  if (document.getElementById('fullCartApp')) {
    initFullCartPage();
  }
});
