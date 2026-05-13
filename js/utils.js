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
  let storeName = 'Conforta Colchoes';

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
        }
      }
    }
  } catch { /* silent */ }

  const year = new Date().getFullYear();
  const whatsLink = whatsapp ? `https://wa.me/${whatsapp}` : null;
  const formattedWhats = whatsapp
    ? whatsapp.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4')
    : '';

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
          <img src="assets/logo.png" alt="${escFooter(storeName)}">
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
