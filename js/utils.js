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

/** Escapa texto para uso em HTML (evita XSS). */
function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  toast.textContent = typeof message === 'string' ? message : String(message);
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
    const localItems = (typeof window.getConfortaLocalCartItems === 'function') ? window.getConfortaLocalCartItems() : [];
    const sb = getSupabase();
    if (!sb) {
      const nLocal = localItems.length;
      if (badge) {
        badge.textContent = String(nLocal);
        badge.style.display = nLocal > 0 ? 'flex' : 'none';
        badge.classList.toggle('visible', nLocal > 0);
      }
      return;
    }
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      const nLocal = localItems.length;
      if (badge) {
        badge.textContent = String(nLocal);
        badge.style.display = nLocal > 0 ? 'flex' : 'none';
        badge.classList.toggle('visible', nLocal > 0);
      }
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
  if (!element) return null;
  const prev = element.getAttribute('data-cc-countdown-interval');
  if (prev) {
    clearInterval(parseInt(prev, 10));
    element.removeAttribute('data-cc-countdown-interval');
  }
  const end = new Date(endDateStr).getTime();
  if (isNaN(end)) {
    element.textContent = '';
    element.setAttribute('hidden', 'true');
    return null;
  }

  function update() {
    const now = new Date().getTime();
    const diff = end - now;
    if (diff <= 0) {
      element.textContent = 'Promoção encerrada';
      const id = element.getAttribute('data-cc-countdown-interval');
      if (id) {
        clearInterval(parseInt(id, 10));
        element.removeAttribute('data-cc-countdown-interval');
      }
      return;
    }
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    element.textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  update();
  const intervalId = setInterval(update, 1000);
  element.setAttribute('data-cc-countdown-interval', String(intervalId));
  return intervalId;
}

// Footer: renderCompactFooter em js/components/site-footer.js

document.addEventListener('DOMContentLoaded', function() {
  applyConfortaPolish();
});

function applyConfortaPolish() {
  const page = getCurrentPageName();
  if (typeof applyConfortaRegionalSeo === 'function') {
    applyConfortaRegionalSeo(page);
  }
  document.body.classList.add('cc-page-' + page.replace('.html', '').replace('index', 'home'));
  document.body.classList.add('cc-polished');
  injectConfortaPolishStyles();
  if (typeof enhanceGlobalHeader === 'function') {
    enhanceGlobalHeader(page);
  }
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

// Cabeçalho global: js/components/site-header.js (enhanceGlobalHeader, …)

function enhanceGlobalFooter() {
  const footer = document.querySelector('footer.footer');
  if (!footer || footer.querySelector('.footer-compact')) return;
  if (typeof renderCompactFooter === 'function') {
    renderCompactFooter(footer);
  }
}

function injectPageQuickNavTop(page) {
  void page;
  document.querySelectorAll('.cc-page-quick-nav-top').forEach(function (el) {
    el.remove();
  });
}

function injectGlobalMobileBottomNav(page) {
  if (document.querySelector('.mobile-bottom-nav, .cc-mobile-bottom-nav')) {
    syncGlobalBottomCartCount();
    return;
  }

  const active = page === 'index.html' ? 'home' : page === 'produtos.html' || page === 'produto.html' ? 'products' : page === 'perfil.html' ? 'profile' : page === 'carrinho.html' ? 'cart' : '';
  const nav = document.createElement('nav');
  nav.className = 'cc-mobile-bottom-nav';
  nav.setAttribute('aria-label', 'Navegação mobile');
  nav.innerHTML = `
    <a href="index.html" class="${active === 'home' ? 'active' : ''}" aria-label="Início">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>
      <span class="cc-mbn-lbl">INÍCIO</span>
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
  function normalizeWa(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    return (digits.length === 10 || digits.length === 11) ? '55' + digits : digits;
  }
  try {
    var cfgDigits = '';
    var cfgEmergencyDigits = '';
    if (typeof CONFORTA_STORE_EDITABLE !== 'undefined' && CONFORTA_STORE_EDITABLE) {
      if (CONFORTA_STORE_EDITABLE.whatsappE164) cfgDigits = normalizeWa(CONFORTA_STORE_EDITABLE.whatsappE164);
      if (CONFORTA_STORE_EDITABLE.emergencyWhatsappE164) cfgEmergencyDigits = normalizeWa(CONFORTA_STORE_EDITABLE.emergencyWhatsappE164);
    }
    if (cfgDigits) {
      window.CONFORTA_WHATSAPP_NORMAL_URL = window.CONFORTA_WHATSAPP_NORMAL_URL || `https://wa.me/${cfgDigits}`;
      window.CONFORTA_WHATSAPP_URL = window.CONFORTA_WHATSAPP_URL || window.CONFORTA_WHATSAPP_NORMAL_URL;
    }
    if (cfgEmergencyDigits) {
      window.CONFORTA_WHATSAPP_EMERGENCY_URL = window.CONFORTA_WHATSAPP_EMERGENCY_URL || `https://wa.me/${cfgEmergencyDigits}`;
    }
    let normalPhone = '';
    let emergencyPhone = '';
    if (typeof getSetting === 'function') normalPhone = await getSetting('whatsapp_number');
    if (!normalPhone && typeof getSetting === 'function') normalPhone = await getSetting('contact_phone');
    if (typeof getSetting === 'function') emergencyPhone = await getSetting('whatsapp_emergency_number');
    const normalDigits = normalizeWa(normalPhone);
    const emergencyDigits = normalizeWa(emergencyPhone) || cfgEmergencyDigits || '5527998108962';
    if (normalDigits) {
      window.CONFORTA_WHATSAPP_NORMAL_URL = `https://wa.me/${normalDigits}`;
      window.CONFORTA_WHATSAPP_URL = window.CONFORTA_WHATSAPP_NORMAL_URL;
    }
    if (emergencyDigits) window.CONFORTA_WHATSAPP_EMERGENCY_URL = `https://wa.me/${emergencyDigits}`;
  } catch { /* silent */ }

  function bindWaLinks(selector, url, fallbackMessage) {
    document.querySelectorAll(selector).forEach(function(link) {
      if (link.dataset.ccWaGlobalBound === '1') return;
      link.dataset.ccWaGlobalBound = '1';
      const message = link.getAttribute('data-message') || fallbackMessage;
      if (url) {
        link.href = `${url}?text=${encodeURIComponent(message)}`;
        link.target = '_blank';
        link.rel = 'noopener';
      }
      link.addEventListener('click', function(e) {
        if (url) return;
        e.preventDefault();
        if (typeof window.openChatWidget === 'function') window.openChatWidget();
        else if (typeof window.toggleChat === 'function') window.toggleChat();
        else if (typeof showToast === 'function') showToast('Atendimento indisponível no momento', 'info');
      });
    });
  }

  bindWaLinks('.js-global-whatsapp', window.CONFORTA_WHATSAPP_URL, 'Olá! Quero atendimento da Conforta Colchões.');
  bindWaLinks('.js-global-whatsapp-emergency', window.CONFORTA_WHATSAPP_EMERGENCY_URL, 'Olá! Preciso de atendimento urgente na Conforta Colchões.');
}

function injectConfortaPolishStyles() {
  if (document.getElementById('cc-polish-styles')) return;
  const style = document.createElement('style');
  style.id = 'cc-polish-styles';
  style.textContent = `
    body.cc-polished { --cc-brand:#1a56db; --cc-brand-dark:#0f3a8e; --cc-ink:#0f172a; --cc-line:#e2e8f0; --cc-header-h: 68px; }
    body.cc-polished header.header { position: fixed !important; top: 0; left: 0; right: 0; z-index: 1000 !important; }
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
    body.cc-polished .cc-home-four-nav { flex-wrap:nowrap; gap:2px; justify-content:center; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:thin; }
    body.cc-polished .cc-home-four-nav a { min-height:56px; padding:0 10px; font-size:0.68rem; letter-spacing:0.06em; gap:6px; white-space:nowrap; }
    body.cc-polished .cc-home-four-nav a svg { flex-shrink:0; }
    body.cc-polished .header-actions { flex-shrink:0; gap:8px !important; }
    body.cc-polished .header-actions button, body.cc-polished .header-actions a { border-radius:12px !important; background:rgba(255,255,255,0.06); color:#cbd5e1; min-width:42px; min-height:42px; transition:background .2s ease,color .2s ease,transform .2s ease; }
    body.cc-polished .header-actions button:hover, body.cc-polished .header-actions a:hover { background:rgba(255,255,255,0.12); color:#fff; transform:translateY(-1px); }
    body.cc-polished .header-whatsapp { width:auto !important; min-width:auto !important; padding:0 14px !important; gap:8px !important; background:#16a34a !important; color:#fff !important; font-size:.84rem !important; font-weight:900 !important; white-space:nowrap; }
    body.cc-polished .main { background:#fff; }
    body.cc-page-home .main { margin-top:0 !important; min-height:0 !important; background:#fff !important; }
    body.cc-page-produto .main { background:#f8fafc !important; }
    body.cc-page-perfil .main { background:#f8fafc !important; }
    body.cc-page-checkout .main, body.cc-page-carrinho .main { background:#f8fafc !important; }
    body.cc-page-produto .product-shell { padding-top:20px !important; }
    body.cc-page-produtos .catalog-hero { margin-top:0 !important; padding-top:28px !important; padding-bottom:24px !important; }
    body.cc-page-produtos .control-bar { top: var(--cc-header-h) !important; }
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
    .cc-mobile-bottom-nav { display:none; }
    @media (max-width: 768px) {
      body.cc-polished .main-nav, body.cc-polished .header-whatsapp { display:none !important; }
      body.cc-polished .header-inner { min-height:62px !important; }
      body.cc-polished .header .logo img { display:none !important; }
      body.cc-polished .mobile-menu-btn { display:flex !important; align-items:center; justify-content:center; }
      body.cc-polished .mobile-menu:not(.open) { display:none !important; visibility:hidden !important; pointer-events:none !important; }
      body.cc-polished .mobile-menu.open { display:block !important; visibility:visible !important; pointer-events:auto !important; }
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
      body.cc-polished .chat-widget { bottom:22px !important; right:14px !important; }
      body.cc-page-produto .chat-widget { bottom:96px !important; }
      body.cc-page-checkout .chat-widget { bottom:18px !important; }
      body.cc-polished .footer { padding-bottom:28px !important; }
      body.cc-polished .footer-contacts { flex-direction:column; gap:10px !important; }
      body.cc-polished .footer-brand-mini img { height:68px !important; }
      body.cc-page-produtos .catalog-hero { margin-top:0 !important; padding-top:24px !important; padding-bottom:20px !important; }
    }
    .cc-header-profile-aux { opacity: 0.78 !important; transform: scale(0.92); min-width: 38px !important; width: 38px !important; }
    .mobile-menu a.cc-mobile-menu-secondary { opacity: 0.88; font-size: 0.88rem; }
    @media (max-width: 430px) {
      body.cc-polished .header .logo-text { display:block !important; }
      body.cc-polished .header-actions button, body.cc-polished .header-actions a { min-width:36px !important; width:36px !important; min-height:36px !important; height:36px !important; }
    }
  `;
  document.head.appendChild(style);
}
