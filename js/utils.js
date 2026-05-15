// Conforta Store - Utility Functions

/** Navega para outra pagina HTML na mesma pasta (funciona em subpastas e sem barra inicial). */
function siteNavigate(path) {
  try {
    window.location.assign(new URL(path, window.location.href).href);
  } catch {
    window.location.href = path;
  }
}

/** URL absoluta para asset relativo (evita /assets em subpastas). */
function assetUrl(relativePath) {
  try {
    return new URL(relativePath, window.location.href).href;
  } catch {
    return relativePath;
  }
}

/** Valida CPF (11 digitos) ou CNPJ (14 digitos); string so com numeros. */
function isValidBrazilTaxId(digits) {
  if (!digits) return false;
  if (digits.length === 11) return validaCPF(digits);
  if (digits.length === 14) return validaCNPJ(digits);
  return false;
}

function validaCPF(cpf) {
  if (!cpf || cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  var n = cpf.split('').map(function (x) { return parseInt(x, 10); });
  var s = 0;
  for (var i = 0; i < 9; i++) s += n[i] * (10 - i);
  var d1 = (s % 11) < 2 ? 0 : 11 - (s % 11);
  if (d1 !== n[9]) return false;
  s = 0;
  for (var j = 0; j < 10; j++) s += n[j] * (11 - j);
  var d2 = (s % 11) < 2 ? 0 : 11 - (s % 11);
  return d2 === n[10];
}

function validaCNPJ(cnpj) {
  if (!cnpj || cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  var n = cnpj.split('').map(function (x) { return parseInt(x, 10); });
  var w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  var s = 0;
  for (var i = 0; i < 12; i++) s += n[i] * w1[i];
  var d1 = s % 11 < 2 ? 0 : 11 - (s % 11);
  if (d1 !== n[12]) return false;
  var w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  s = 0;
  for (var j = 0; j < 13; j++) s += n[j] * w2[j];
  var d2 = s % 11 < 2 ? 0 : 11 - (s % 11);
  return d2 === n[13];
}

// Format price
function formatPrice(value) {
  if (value === null || value === undefined || value === '') return 'R$ 0,00';
  const n = (typeof value === 'number') ? value : parseFloat(value);
  if (!isFinite(n)) return 'R$ 0,00';
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

// Format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Format date time
function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Debounce
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Truncate text
function truncate(str, max = 100) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// Slugify
function slugify(str) {
  return str.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Generate order number
function generateOrderNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `CONF-${date}-${rand}`;
}

// Toast notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    const c = document.createElement('div');
    c.id = 'toastContainer';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  const containerEl = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = message;
  containerEl.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; }, 3000);
  setTimeout(() => toast.remove(), 3500);
}

// Loading overlay
function showLoading(show = true) {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay && show) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(overlay);
    overlay.classList.add('active');
  } else if (overlay) {
    if (show) overlay.classList.add('active');
    else overlay.classList.remove('active');
  }
}

// Toggle modal
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('open');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('open');
}

// Get cart count
async function updateCartCount() {
  const badge = document.getElementById('cartCount');
  function resetBadge() {
    if (badge) {
      badge.textContent = '0';
      badge.style.display = 'none';
      badge.classList.remove('visible');
    }
  }
  try {
    const sb = getSupabase();
    if (!sb) {
      resetBadge();
      return;
    }
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      resetBadge();
      return;
    }
    const { data: cart } = await sb.from('carts').select('id').eq('user_id', user.id).maybeSingle();
    if (!cart) {
      resetBadge();
      return;
    }
    const { count, error } = await sb.from('cart_items').select('*', { count: 'exact', head: true }).eq('cart_id', cart.id);
    if (error) {
      resetBadge();
      return;
    }
    const n = typeof count === 'number' ? count : 0;
    if (badge) {
      badge.textContent = String(n);
      if (n > 0) {
        badge.style.display = 'flex';
        badge.classList.add('visible');
      } else {
        badge.style.display = 'none';
        badge.classList.remove('visible');
      }
    }
  } catch (e) {
    resetBadge();
  }
}

// Get settings
async function getSetting(key) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('site_settings').select('value').eq('key', key).maybeSingle();
    if (error) return null;
    if (!data) return null;
    let v = data.value;
    // value pode estar guardado como string JSON (ex: '"texto"') por causa do jsonb
    if (typeof v === 'string' && v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
      try { v = JSON.parse(v); } catch { /* keep original */ }
    }
    return v;
  } catch { return null; }
}

// Calculate installments
function calcInstallments(price, maxParcelas = 12, minValor = 20) {
  const parcelas = [];
  for (let i = 1; i <= maxParcelas; i++) {
    const valor = price / i;
    if (valor >= minValor) {
      parcelas.push({ qtd: i, valor: valor });
    }
  }
  return parcelas;
}

// Countdown timer
function startCountdown(element, endDateStr) {
  const end = new Date(endDateStr).getTime();
  if (!element || isNaN(end)) return;

  function update() {
    const now = new Date().getTime();
    const diff = end - now;
    if (diff <= 0) {
      element.textContent = 'Oferta encerrada';
      return;
    }
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    element.textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  update();
  return setInterval(update, 1000);
}

// Render compact footer (called by each page on load)
// opts.variant: 'footer' (default) | 'strip' — faixa compacta com contato + copyright
async function renderCompactFooter(targetSelector, opts = {}) {
  const el = typeof targetSelector === 'string'
    ? document.querySelector(targetSelector)
    : targetSelector;
  if (!el) return;

  const variant = (opts && opts.variant) || 'footer';

  let email = 'contato@confortacolchoes.com.br';
  let phone = '(27) 3333-3333';
  let whatsapp = '';
  let storeName = 'Conforta Colchões';
  let instagramHandle = '';

  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from('site_settings').select('key, value');
      if (data) {
        for (const s of data) {
          const v = s.value;
          if (s.key === 'admin_emails' && Array.isArray(v) && v[0]) email = v[0];
          if (s.key === 'contact_email' && typeof v === 'string') email = v;
          if (s.key === 'contact_phone' && typeof v === 'string') phone = v;
          if (s.key === 'whatsapp_number' && typeof v === 'string') whatsapp = v.replace(/\D/g, '');
          if (s.key === 'store_name' && typeof v === 'string') storeName = v;
          if (s.key === 'instagram_handle' && typeof v === 'string') instagramHandle = v.trim();
        }
      }
    }
  } catch { /* silent */ }

  const year = new Date().getFullYear();
  const whatsLink = whatsapp ? `https://wa.me/${whatsapp}` : null;
  const formattedWhats = whatsapp
    ? whatsapp.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4')
    : '';
  const igHandle = instagramHandle.replace(/^@+/, '').trim();
  const instagramLink = igHandle ? `https://www.instagram.com/${encodeURIComponent(igHandle)}/` : null;
  const igDisplay = igHandle ? (instagramHandle.indexOf('@') >= 0 ? instagramHandle : '@' + igHandle) : '';

  if (variant === 'strip') {
    const phoneBlock = whatsLink
      ? `<a class="hcs-item" href="${whatsLink}" target="_blank" rel="noopener">${escFooter(formattedWhats || phone)}</a>`
      : `<span class="hcs-item hcs-muted">${escFooter(phone)}</span>`;
    el.innerHTML = `
      <div class="container hcs-inner">
        <a class="hcs-item" href="mailto:${escFooter(email)}">${escFooter(email)}</a>
        <span class="hcs-sep" aria-hidden="true">|</span>
        ${phoneBlock}
        <span class="hcs-sep" aria-hidden="true">|</span>
        <span class="hcs-copy">&copy; ${year} ${escFooter(storeName)}</span>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="container">
      <div class="footer-compact">
        <a href="index.html" class="footer-brand-mini" aria-label="${escFooter(storeName)}">
          <img src="assets/footer-logo.png" alt="${escFooter(storeName)}" style="height:74px;width:auto;max-width:min(360px,90vw);object-fit:contain;">
        </a>
        <div class="footer-contacts">
          <a class="footer-contact-item" href="mailto:${escFooter(email)}" aria-label="Email">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            <span>${escFooter(email)}</span>
          </a>
          ${whatsLink
            ? `<a class="footer-contact-item" href="${whatsLink}" target="_blank" rel="noopener" aria-label="WhatsApp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.7 4.2 1.6.7 2.3.7 3.1.6.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20m5.5-15.5A7.7 7.7 0 0 0 12 4a7.7 7.7 0 0 0-7.8 7.8c0 1.4.4 2.7 1.1 3.9L4.2 20l4.4-1.1c1.2.7 2.5 1 3.9 1a7.7 7.7 0 0 0 7.8-7.8c0-2-.8-4-2.3-5.6"/></svg>
                <span>${escFooter(formattedWhats || phone)}</span>
              </a>`
            : `<span class="footer-contact-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>${escFooter(phone)}</span>
              </span>`
          }
          ${instagramLink
            ? `<a class="footer-contact-item" href="${instagramLink}" target="_blank" rel="noopener" aria-label="Instagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 7.2c-2.65 0-4.8 2.15-4.8 4.8S9.35 16.8 12 16.8s4.8-2.15 4.8-4.8S14.65 7.2 12 7.2zm0 7.85a3.05 3.05 0 1 1 0-6.1 3.05 3.05 0 0 1 0 6.1zm5.95-8.35a1.12 1.12 0 1 1-2.24 0 1.12 1.12 0 0 1 2.24 0zM12 2c2.67 0 3 .01 4.05.06 1.1.05 1.85.24 2.5.51.68.27 1.26.64 1.84 1.22.58.58.95 1.16 1.22 1.84.27.65.46 1.4.51 2.5.05 1.05.06 1.38.06 4.05s-.01 3-.06 4.05c-.05 1.1-.24 1.85-.51 2.5-.27.68-.64 1.26-1.22 1.84-.58.58-1.16.95-1.84 1.22-.65.27-1.4.46-2.5.51-1.05.05-1.38.06-4.05.06s-3-.01-4.05-.06c-1.1-.05-1.85-.24-2.5-.51-.68-.27-1.26-.64-1.84-1.22-.58-.58-.95-1.16-1.22-1.84-.27-.65-.46-1.4-.51-2.5C2.01 15 2 14.67 2 12s.01-3 .06-4.05c.05-1.1.24-1.85.51-2.5.27-.68.64-1.26 1.22-1.84.58-.58 1.16-.95 1.84-1.22.65-.27 1.4-.46 2.5-.51C9 2.01 9.33 2 12 2zm0 1.8H8.1c-1.02.05-1.57.22-1.94.37-.49.19-.84.42-1.2.78-.36.36-.59.71-.78 1.2-.15.37-.32.92-.37 1.94C4.01 9.1 4 9.42 4 12c0 2.58.01 2.9.06 3.91.05 1.02.22 1.57.37 1.94.19.49.42.84.78 1.2.36.36.71.59 1.2.78.37.15.92.32 1.94.37 1.01.05 1.33.06 3.91.06s2.9-.01 3.91-.06c1.02-.05 1.57-.22 1.94-.37.49-.19.84-.42 1.2-.78.36-.36.59-.71.78-1.2.15-.37.32-.92.37-1.94.05-1.01.06-1.33.06-3.91s-.01-2.9-.06-3.91c-.05-1.02-.22-1.57-.37-1.94-.19-.49-.42-.84-.78-1.2-.36-.36-.71-.59-1.2-.78-.37-.15-.92-.32-1.94-.37-.73-.04-1.01-.05-3.09-.06z"/></svg>
                <span>${escFooter(igDisplay)}</span>
              </a>`
            : ''
          }
        </div>
        <div class="footer-bottom-mini">&copy; ${year} ${escFooter(storeName)}. Todos os direitos reservados.</div>
      </div>
    </div>
  `;
}

function escFooter(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', function() {
  applyConfortaPolish();
});

function applyConfortaPolish() {
  const page = getCurrentPageName();
  document.body.classList.add('cc-page-' + page.replace('.html', '').replace('index', 'home'));
  document.body.classList.add('cc-polished');
  injectConfortaPolishStyles();
  enhanceGlobalHeader(page);
  enhanceGlobalFooter();
  injectPageQuickNavTop(page);
  injectGlobalMobileBottomNav(page);
  configureGlobalWhatsappLinks();
}

function getCurrentPageName() {
  const raw = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  const segments = raw.split('/').filter(Boolean);
  let last = segments.length ? segments[segments.length - 1] : '';
  if (!last) return 'index.html';
  if (!last.includes('.')) return last.toLowerCase() + '.html';
  return last;
}

function enhanceGlobalHeader(page) {
  const header = document.querySelector('header.header');
  if (!header || page === 'checkout.html' || page === 'carrinho.html') return;

  const logo = header.querySelector('.logo');
  const hasNav = header.querySelector('.main-nav');
  const search = header.querySelector('.search-bar');

  if (!hasNav) {
    const nav = document.createElement('nav');
    nav.className = 'main-nav cc-main-nav';
    nav.setAttribute('aria-label', 'Navegacao principal');
    nav.innerHTML = getGlobalNavHtml(page);
    if (search && page !== 'produtos.html') {
      search.replaceWith(nav);
    } else if (logo && logo.parentNode) {
      logo.insertAdjacentElement('afterend', nav);
    }
  }

  const actions = header.querySelector('.header-actions');
  if (actions && !actions.querySelector('.header-whatsapp')) {
    const mobileBtn = actions.querySelector('#mobileMenuBtn');
    const whats = document.createElement('a');
    whats.href = '#';
    whats.className = 'header-whatsapp js-global-whatsapp';
    whats.setAttribute('data-message', 'Ola! Quero atendimento da Conforta Colchões.');
    whats.setAttribute('aria-label', 'Falar no WhatsApp');
    whats.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.7 4.2 1.6.7 2.3.7 3.1.6.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20m5.5-15.5A7.7 7.7 0 0 0 12 4a7.7 7.7 0 0 0-7.8 7.8c0 1.4.4 2.7 1.1 3.9L4.2 20l4.4-1.1c1.2.7 2.5 1 3.9 1a7.7 7.7 0 0 0 7.8-7.8c0-2-.8-4-2.3-5.6"/></svg><span>WhatsApp</span>';
    if (mobileBtn) actions.insertBefore(whats, mobileBtn);
    else actions.appendChild(whats);
  }

  const mobileMenu = header.querySelector('#mobileMenu');
  if (mobileMenu && !mobileMenu.dataset.polished) {
    if (page === 'index.html') {
      mobileMenu.innerHTML = [
        '<a href="index.html">INICIO</a>',
        '<a href="produtos.html">PRODUTOS</a>',
        '<a href="carrinho.html">CARRINHO</a>',
        '<a href="perfil.html">PERFIL</a>'
      ].join('');
    } else {
      mobileMenu.innerHTML = [
        '<a href="index.html">Inicio</a>',
        '<a href="produtos.html">Produtos</a>',
        '<a href="produtos.html?ofertas=1">Ofertas</a>',
        '<a href="perfil.html">Meu Perfil</a>',
        '<a href="#" class="js-global-whatsapp" data-message="Ola! Quero atendimento da Conforta Colchões.">Atendimento</a>'
      ].join('');
    }
    mobileMenu.dataset.polished = 'true';
  }

  if (page === 'index.html') {
    const homeNav = header.querySelector('.main-nav');
    if (homeNav) {
      homeNav.classList.add('cc-home-four-nav');
      homeNav.setAttribute('aria-label', 'Navegacao principal');
      homeNav.innerHTML = getHomeFourNavInnerHtml(page);
    }
  }
}

function enhanceGlobalFooter() {
  const footer = document.querySelector('footer.footer');
  if (!footer || footer.querySelector('.footer-compact')) return;
  if (typeof renderCompactFooter === 'function') {
    renderCompactFooter(footer);
  }
}

function getGlobalNavHtml(page) {
  const active = page === 'index.html' ? 'home' : page === 'produtos.html' || page === 'produto.html' ? 'products' : '';
  return [
    '<a href="index.html"' + (active === 'home' ? ' class="active" aria-current="page"' : '') + '>Inicio</a>',
    '<a href="produtos.html"' + (active === 'products' ? ' class="active" aria-current="page"' : '') + '>Produtos</a>',
    '<a href="produtos.html?ofertas=1">Ofertas</a>',
    '<a href="#" class="js-global-whatsapp" data-message="Ola! Quero atendimento da Conforta Colchões.">Atendimento</a>'
  ].join('');
}

function getHomeFourNavInnerHtml(page) {
  const a = getQuickNavActive(page);
  const h = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>';
  const p = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
  const c = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h3l2.4 12.3a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 2-1.6L21 7H6"/></svg>';
  const u = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  return (
    '<a href="index.html"' + (a.home ? ' class="active" aria-current="page"' : '') + '>' + h + '<span>INICIO</span></a>' +
    '<a href="produtos.html"' + (a.products ? ' class="active" aria-current="page"' : '') + '>' + p + '<span>PRODUTOS</span></a>' +
    '<a href="carrinho.html"' + (a.cart ? ' class="active" aria-current="page"' : '') + '>' + c + '<span>CARRINHO</span></a>' +
    '<a href="perfil.html"' + (a.profile ? ' class="active" aria-current="page"' : '') + '>' + u + '<span>PERFIL</span></a>'
  );
}

function getQuickNavActive(page) {
  return {
    home: page === 'index.html',
    products: page === 'produtos.html' || page === 'produto.html',
    cart: page === 'carrinho.html',
    profile: page === 'perfil.html'
  };
}

function injectPageQuickNavTop(page) {
  if (page === 'index.html' || page === 'simulador.html') {
    document.querySelectorAll('.cc-page-quick-nav-top').forEach(function(el) {
      el.remove();
    });
    return;
  }
  if (document.querySelector('.cc-page-quick-nav-top')) return;
  const host =
    document.querySelector('main.main') ||
    document.querySelector('main') ||
    document.querySelector('.main-content') ||
    document.body;
  if (!host) return;

  const a = getQuickNavActive(page);
  const nav = document.createElement('nav');
  nav.className = 'cc-page-quick-nav-top';
  nav.setAttribute('aria-label', 'Atalhos: inicio, produtos, carrinho e perfil');
  nav.innerHTML = `
    <a href="index.html" class="${a.home ? 'active' : ''}" aria-current="${a.home ? 'page' : 'false'}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>
      <span>INICIO</span>
    </a>
    <a href="produtos.html" class="${a.products ? 'active' : ''}" aria-current="${a.products ? 'page' : 'false'}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <span>PRODUTOS</span>
    </a>
    <a href="carrinho.html" class="${a.cart ? 'active' : ''}" aria-current="${a.cart ? 'page' : 'false'}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h3l2.4 12.3a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 2-1.6L21 7H6"/></svg>
      <span>CARRINHO</span>
    </a>
    <a href="perfil.html" class="${a.profile ? 'active' : ''}" aria-current="${a.profile ? 'page' : 'false'}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span>PERFIL</span>
    </a>`;
  nav.querySelectorAll('a').forEach(function(link) {
    if (link.getAttribute('aria-current') === 'false') link.removeAttribute('aria-current');
  });
  host.insertBefore(nav, host.firstChild);
}

function injectGlobalMobileBottomNav(page) {
  if (document.querySelector('.mobile-bottom-nav, .cc-mobile-bottom-nav')) {
    syncGlobalBottomCartCount();
    return;
  }

  const active = page === 'index.html' ? 'home' : page === 'produtos.html' || page === 'produto.html' ? 'products' : page === 'perfil.html' ? 'profile' : page === 'carrinho.html' ? 'cart' : '';
  const nav = document.createElement('nav');
  nav.className = 'cc-mobile-bottom-nav';
  nav.setAttribute('aria-label', 'Navegacao mobile');
  nav.innerHTML = `
    <a href="index.html" class="${active === 'home' ? 'active' : ''}" aria-label="Inicio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>
      <span class="cc-mbn-lbl">INICIO</span>
    </a>
    <a href="produtos.html" class="${active === 'products' ? 'active' : ''}" aria-label="Produtos">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <span class="cc-mbn-lbl">PRODUTOS</span>
    </a>
    <a href="carrinho.html" class="${active === 'cart' ? 'active' : ''}" aria-label="Carrinho">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h3l2.4 12.3a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 2-1.6L21 7H6"/></svg>
      <span class="cc-mbn-lbl">CARRINHO</span>
      <small class="cart-count" id="globalBottomCartCount">0</small>
    </a>
    <a href="perfil.html" class="${active === 'profile' ? 'active' : ''}" aria-label="Perfil">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span class="cc-mbn-lbl">PERFIL</span>
    </a>`;
  document.body.appendChild(nav);
  document.body.classList.add('cc-has-mobile-bottom');

  syncGlobalBottomCartCount();
}

function syncGlobalBottomCartCount() {
  const source = document.getElementById('cartCount');
  const targets = [
    document.getElementById('globalBottomCartCount'),
    document.getElementById('bottomCartCount')
  ].filter(Boolean);
  if (!source || targets.length === 0) return;

  const sync = function() {
    targets.forEach(function(target) {
      target.textContent = source.textContent || '0';
      const visible = source.classList.contains('visible') || source.style.display === 'flex';
      target.classList.toggle('visible', visible);
      target.style.display = visible ? 'flex' : 'none';
    });
  };
  sync();
  if (!source.dataset.ccObserved) {
    new MutationObserver(sync).observe(source, { attributes: true, childList: true, characterData: true, subtree: true });
    source.dataset.ccObserved = 'true';
  }
}

async function configureGlobalWhatsappLinks() {
  try {
    let phone = '';
    if (typeof getSetting === 'function') phone = await getSetting('whatsapp_number');
    if (!phone && typeof getSetting === 'function') phone = await getSetting('contact_phone');
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits) {
      const normalized = (digits.length === 10 || digits.length === 11) ? '55' + digits : digits;
      window.CONFORTA_WHATSAPP_URL = window.CONFORTA_WHATSAPP_URL || `https://wa.me/${normalized}`;
    }
  } catch { /* silent */ }

  document.querySelectorAll('.js-global-whatsapp').forEach(function(link) {
    const message = link.getAttribute('data-message') || 'Ola! Quero atendimento da Conforta Colchões.';
    if (window.CONFORTA_WHATSAPP_URL) {
      link.href = `${window.CONFORTA_WHATSAPP_URL}?text=${encodeURIComponent(message)}`;
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.addEventListener('click', function(e) {
      if (window.CONFORTA_WHATSAPP_URL) return;
      e.preventDefault();
      if (typeof window.openChatWidget === 'function') window.openChatWidget();
      else if (typeof window.toggleChat === 'function') window.toggleChat();
      else if (typeof showToast === 'function') showToast('Atendimento indisponivel no momento', 'info');
    });
  });
}

function injectConfortaPolishStyles() {
  if (document.getElementById('cc-polish-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-polish-styles';
  style.textContent = `
    body.cc-polished { --cc-brand:#1a56db; --cc-brand-dark:#0f3a8e; --cc-ink:#0f172a; --cc-line:#e2e8f0; }
    body.cc-polished .header { background: rgba(15,23,42,0.97) !important; border-bottom: 1px solid #1e293b !important; box-shadow: 0 10px 28px rgba(15,23,42,0.12) !important; backdrop-filter: blur(14px); }
    body.cc-polished .header-inner { min-height: 68px !important; height: auto !important; display: flex !important; align-items: center !important; gap: 18px !important; }
    body.cc-polished .logo { flex-shrink: 0 !important; gap: 10px !important; }
    body.cc-polished .header .logo img { display: none !important; }
    body.cc-polished .logo-text { color:#fff !important; font-weight:900 !important; line-height:1.05 !important; letter-spacing:-0.02em !important; }
    body.cc-polished .logo-text small { color:#9fd3b6 !important; font-weight:800 !important; letter-spacing:0.16em !important; }
    body.cc-polished .main-nav { display:flex; align-items:center; justify-content:center; gap:4px; flex:1; min-width:0; }
    body.cc-polished .main-nav a { position:relative; display:inline-flex; align-items:center; min-height:68px; padding:0 12px; color:#cbd5e1; font-size:0.9rem; font-weight:900; text-decoration:none !important; }
    body.cc-polished .main-nav a:hover, body.cc-polished .main-nav a.active { color:#fff; }
    body.cc-polished .main-nav a.active::after { display:none !important; }
    body.cc-page-home .cc-home-four-nav { flex-wrap:nowrap; gap:2px; justify-content:center; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
    body.cc-page-home .cc-home-four-nav a { min-height:56px; padding:0 10px; font-size:0.68rem; letter-spacing:0.06em; gap:6px; white-space:nowrap; }
    body.cc-page-home .cc-home-four-nav a svg { flex-shrink:0; }
    body.cc-polished .header-actions { flex-shrink:0; gap:8px !important; }
    body.cc-polished .header-actions button, body.cc-polished .header-actions a { border-radius:12px !important; background:rgba(255,255,255,0.06); color:#cbd5e1; min-width:42px; min-height:42px; transition:background .2s ease,color .2s ease,transform .2s ease; }
    body.cc-polished .header-actions button:hover, body.cc-polished .header-actions a:hover { background:rgba(255,255,255,0.12); color:#fff; transform:translateY(-1px); }
    body.cc-polished .header-whatsapp { width:auto !important; min-width:auto !important; padding:0 14px !important; gap:8px !important; background:#16a34a !important; color:#fff !important; font-size:.84rem !important; font-weight:900 !important; white-space:nowrap; }
    body.cc-polished .main { background:#fff; }
    body.cc-polished:not(.cc-page-home) header.header { display:none !important; }
    body.cc-polished:not(.cc-page-home) .main { margin-top:0 !important; min-height:100vh !important; }
    body.cc-page-home .main { margin-top:0 !important; min-height:0 !important; background:#fff !important; }
    body.cc-page-produto .main { background:#f8fafc !important; }
    body.cc-page-perfil .main { background:#f8fafc !important; }
    body.cc-page-checkout .main, body.cc-page-carrinho .main { background:#f8fafc !important; }
    body.cc-page-produto .product-shell { padding-top:20px !important; }
    body.cc-page-produtos .catalog-hero { margin-top:0 !important; padding-top:28px !important; padding-bottom:24px !important; }
    body.cc-page-produtos .control-bar { top:0 !important; }
    body.cc-page-perfil .profile-page { padding-top:24px !important; }
    body.cc-page-perfil .account-title-card { color:#fff !important; background:radial-gradient(circle at top right, rgba(59,130,246,.35), transparent 30%), linear-gradient(135deg,#0f172a 0%,#0f3a8e 62%,#1a56db 100%) !important; border-color:rgba(255,255,255,.14) !important; box-shadow:0 18px 42px rgba(15,23,42,.12) !important; }
    body.cc-page-perfil .account-title-card h1 { color:#fff !important; }
    body.cc-page-perfil .account-title-card p { color:#dbeafe !important; }
    body.cc-page-perfil .account-microcopy span { background:rgba(255,255,255,.12) !important; border:1px solid rgba(255,255,255,.16); color:#fff !important; }
    body.cc-polished .footer { margin-top:34px !important; padding:38px 0 24px !important; background:#0f172a !important; }
    body.cc-polished .footer-compact { gap:16px !important; }
    body.cc-polished .footer-brand-mini img { height:78px !important; width:auto !important; max-width:min(380px,90vw) !important; object-fit:contain !important; border-radius:0 !important; }
    body.cc-polished .footer-contacts { gap:18px 24px !important; align-items:center; }
    body.cc-polished .footer-bottom-mini { padding-top:14px !important; color:#94a3b8 !important; }
    .cc-page-quick-nav-top {
      display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px 12px;
      width:100%; box-sizing:border-box;
      padding:10px 14px 12px; margin:0 0 14px 0;
      background:#fff; border-bottom:1px solid #e2e8f0;
    }
    .cc-page-quick-nav-top a {
      display:inline-flex; align-items:center; gap:7px;
      padding:8px 14px; border-radius:12px;
      font-size:0.74rem; font-weight:900; letter-spacing:0.04em;
      color:#475569; text-decoration:none !important;
      border:1px solid transparent;
    }
    .cc-page-quick-nav-top a:hover { background:#f8fafc; border-color:#e2e8f0; color:var(--cc-ink); }
    .cc-page-quick-nav-top a.active { background:#eff6ff; color:#1a56db; border-color:#bfdbfe; }
    .cc-page-quick-nav-top svg { flex-shrink:0; }
    @media (max-width: 768px) {
      .cc-page-quick-nav-top { display:none !important; }
    }
    body.cc-page-admin .cc-page-quick-nav-top { background:#1e293b; border-bottom-color:#334155; }
    body.cc-page-admin .cc-page-quick-nav-top a { color:#cbd5e1; }
    body.cc-page-admin .cc-page-quick-nav-top a:hover { background:#334155; border-color:#475569; color:#fff; }
    body.cc-page-admin .cc-page-quick-nav-top a.active { background:rgba(26,86,219,0.25); color:#93c5fd; border-color:#3b82f6; }
    .cc-mobile-bottom-nav { display:none; }
    @media (max-width: 768px) {
      body.cc-polished .main-nav, body.cc-polished .header-whatsapp { display:none !important; }
      body.cc-polished .header-inner { min-height:62px !important; }
      body.cc-polished .header .logo img { display:none !important; }
      body.cc-polished .mobile-menu-btn { display:none !important; }
      body.cc-polished .mobile-menu, body.cc-polished .mobile-menu.open { display:none !important; visibility:hidden !important; pointer-events:none !important; }
      body.cc-has-mobile-bottom { padding-bottom:82px; }
      body.cc-page-produto { padding-bottom:150px; }
      .cc-mobile-bottom-nav { position:fixed; left:0; right:0; bottom:0; z-index:850; display:grid; grid-template-columns:repeat(4,1fr); min-height:58px; padding:8px 8px calc(8px + env(safe-area-inset-bottom)); background:rgba(255,255,255,.98); border-top:1px solid #e2e8f0; box-shadow:0 -12px 30px rgba(15,23,42,.10); backdrop-filter:blur(14px); }
      body.cc-page-produto .cc-mobile-bottom-nav { bottom:72px; }
      .cc-mobile-bottom-nav .cc-mbn-lbl {
        position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;
      }
      .cc-mobile-bottom-nav a, .cc-mobile-bottom-nav button { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; color:#64748b; font-size:.68rem; font-weight:900; border-radius:14px; background:transparent; border:0; min-height:48px; }
      .cc-mobile-bottom-nav svg { width:24px; height:24px; }
      .cc-mobile-bottom-nav .active { color:#1a56db; background:#eff6ff; }
      .cc-mobile-bottom-nav .cart-count { position:absolute; top:4px; right:calc(50% - 24px); min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:#dc2626; color:#fff; font-size:.65rem; font-weight:900; display:none; align-items:center; justify-content:center; }
      .cc-mobile-bottom-nav .cart-count.visible { display:flex; }
      body.cc-polished .chat-widget { bottom:86px !important; right:14px !important; }
      body.cc-page-produto .chat-widget { bottom:154px !important; }
      body.cc-page-checkout .chat-widget { bottom:18px !important; }
      body.cc-polished .footer { padding-bottom:28px !important; }
      body.cc-polished .footer-contacts { flex-direction:column; gap:10px !important; }
      body.cc-polished .footer-brand-mini img { height:68px !important; }
      body.cc-page-produtos .catalog-hero { margin-top:0 !important; padding-top:24px !important; padding-bottom:20px !important; }
    }
    @media (max-width: 430px) {
      body.cc-polished .header .logo-text { display:block !important; }
      body.cc-polished .header-actions button, body.cc-polished .header-actions a { min-width:36px !important; width:36px !important; min-height:36px !important; height:36px !important; }
    }
  `;
  document.head.appendChild(style);
}
