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
    console.warn('[cart] get_or_create_cart RPC falhou, tentando insert direto:', e && (e.message || e));
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
  } catch (e) {
    console.error('addProductToCart erro:', e);
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
      console.error('getCartItems supabase error:', error);
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
    console.error('Erro ao buscar carrinho:', e);
    return [];
  }
}

async function updateCartItemQuantity(itemId, quantity) {
  try {
    if (quantity < 1) return;
    showLoading(true);
    await supabaseUpdate('cart_items', { quantity }, { id: itemId });
    updateCartCount();
    renderCartSidebarItems();
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
    renderCartSidebarItems();
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
    renderCartSidebarItems();
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

function getItemName(item) {
  return item?.product?.name || item?.photo?.custom_label || 'Produto';
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

  return `
    <div class="cart-item" data-id="${safeId}">
      <div class="cart-item-image">
        <img src="${img}" alt="${name}" loading="lazy">
      </div>
      <div class="cart-item-info">
        <h4 class="cart-item-name">${name}</h4>
        ${colorHtml}
        <div class="cart-item-price">${formatPrice(price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateCartItemQuantity('${safeId}', ${qty - 1})" ${qty <= 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
          </button>
          <span class="qty-value">${qty}</span>
          <button class="qty-btn" onclick="updateCartItemQuantity('${safeId}', ${qty + 1})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div class="cart-item-total">${formatPrice(total)}</div>
      </div>
      <button class="cart-item-remove" onclick="removeCartItem('${safeId}')" title="Remover">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
}

async function renderCartSidebarItems() {
  const list = document.getElementById('cartSidebarItems');
  const totalEl = document.getElementById('cartSidebarTotal');
  const emptyEl = document.getElementById('cartSidebarEmpty');
  const footerEl = document.getElementById('cartSidebarFooter');
  if (!list) return;

  const items = await getCartItems();

  if (items.length === 0) {
    list.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (footerEl) footerEl.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (footerEl) footerEl.style.display = 'block';

  list.innerHTML = items.map(renderCartItem).join('');

  const total = items.reduce((acc, item) => {
    const q = parseInt(item.quantity, 10) || 1;
    return acc + getItemPrice(item) * q;
  }, 0);

  if (totalEl) totalEl.textContent = formatPrice(total);
}

function renderCartSidebar() {
  const html = `
    <div class="cart-sidebar-overlay" id="cartSidebarOverlay" onclick="closeCartSidebar()"></div>
    <div class="cart-sidebar" id="cartSidebar">
      <div class="cart-sidebar-header">
        <h3>Carrinho</h3>
        <button class="cart-sidebar-close" onclick="closeCartSidebar()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="cart-sidebar-body">
        <div class="cart-sidebar-empty" id="cartSidebarEmpty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--gray-300)">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
          </svg>
          <p>Seu carrinho esta vazio</p>
        </div>
        <div class="cart-sidebar-items" id="cartSidebarItems"></div>
      </div>
      <div class="cart-sidebar-footer" id="cartSidebarFooter" style="display:none">
        <div class="cart-sidebar-subtotal">
          <span>Total</span>
          <span class="cart-sidebar-total" id="cartSidebarTotal">R$ 0,00</span>
        </div>
        <button class="btn btn-primary btn-block" onclick="handleCheckout()">
          Finalizar compra
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function openCartSidebar() {
  const overlay = document.getElementById('cartSidebarOverlay');
  const sidebar = document.getElementById('cartSidebar');
  if (!overlay || !sidebar) {
    renderCartSidebar();
  }
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
  closeCartSidebar();
  if (typeof siteNavigate === 'function') siteNavigate('checkout.html');
  else window.location.href = 'checkout.html';
}

window.addProductToCart = addProductToCart;

document.addEventListener('DOMContentLoaded', () => {
  renderCartSidebar();
  const cartBtn = document.getElementById('cartBtn');
  if (cartBtn) {
    cartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCartSidebar();
    });
  }
});
