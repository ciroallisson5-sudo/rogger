/**
 * Footer compacto Conforta — contato institucional e CLS estável no logo.
 */
(function () {
  'use strict';

  function escFooter(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var INSTITUTIONAL =
    (typeof window !== 'undefined' && window.CONFORTA_INSTITUTIONAL_EMAIL) ||
    'contato@confortacolchoes.site';

  window.renderCompactFooter = async function renderCompactFooter(targetSelector, opts) {
    var el =
      typeof targetSelector === 'string'
        ? document.querySelector(targetSelector)
        : targetSelector;
    if (!el) return;

    var variant = (opts && opts.variant) || 'footer';
    if (variant === 'strip') {
      el.classList.remove('footer--site-compact');
    } else {
      el.classList.add('footer--site-compact');
    }

    var email = INSTITUTIONAL;
    var phone = '(27) 3333-3333';
    var whatsapp = '';
    var whatsappEmergency = '5527998108962';
    var storeName = 'Conforta Colchões';
    var instagramHandle = '';

    try {
      var sb = typeof getSupabase === 'function' ? getSupabase() : null;
      if (sb) {
        var res = await sb.from('site_settings').select('key, value');
        if (res.data) {
          for (var i = 0; i < res.data.length; i++) {
            var row = res.data[i];
            var v = row.value;
            if (row.key === 'contact_phone' && typeof v === 'string') phone = v;
            if (row.key === 'whatsapp_number' && typeof v === 'string') {
              whatsapp = String(v).replace(/\D/g, '');
            }
            if (row.key === 'whatsapp_emergency_number' && typeof v === 'string') {
              var ed = String(v).replace(/\D/g, '');
              if (ed) whatsappEmergency = ed.length === 10 || ed.length === 11 ? '55' + ed : ed;
            }
            if (row.key === 'store_name' && typeof v === 'string') {
              storeName =
                typeof normalizeConfortaBranding === 'function'
                  ? normalizeConfortaBranding(v)
                  : v;
            }
            if (row.key === 'instagram_handle' && typeof v === 'string') instagramHandle = v.trim();
          }
        }
      }
    } catch (_) {
      /* silent */
    }

    var year = new Date().getFullYear();
    var whatsLink = whatsapp ? 'https://wa.me/' + whatsapp : null;
    var emergencyWhatsLink = whatsappEmergency ? 'https://wa.me/' + whatsappEmergency : null;
    var formattedWhats = whatsapp
      ? whatsapp.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4')
      : '';
    var formattedEmergencyWhats = whatsappEmergency
      ? whatsappEmergency.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4')
      : '';
    var igHandle = instagramHandle.replace(/^@+/, '').trim();
    var instagramLink = igHandle
      ? 'https://www.instagram.com/' + encodeURIComponent(igHandle) + '/'
      : null;
    var igDisplay = igHandle
      ? instagramHandle.indexOf('@') >= 0
        ? instagramHandle
        : '@' + igHandle
      : '';

    var mpHelp = 'https://www.mercadopago.com.br/ajuda';
    var mpTrustBlock =
      '<div class="footer-mp-trust" role="region" aria-label="Pagamentos com Mercado Pago">' +
      '<span class="footer-mp-trust-icon" aria-hidden="true">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
      '</svg></span>' +
      '<div class="footer-mp-trust-body">' +
      '<strong class="footer-mp-trust-title">Pagamentos com Mercado Pago</strong>' +
      '<p class="footer-mp-trust-text">O checkout do pagamento é aberto no ambiente seguro do Mercado Pago. A Conforta não recebe nem guarda dados do seu cartão, senha ou conta bancária — quem processa e protege essa etapa é o Mercado Pago.</p>' +
      '<a class="footer-mp-trust-link" href="' +
      escFooter(mpHelp) +
      '" target="_blank" rel="noopener noreferrer">Central de ajuda e segurança Mercado Pago</a>' +
      '</div></div>';

    if (variant === 'strip') {
      var phoneBlock = whatsLink
        ? '<a class="hcs-item" href="' +
          whatsLink +
          '" target="_blank" rel="noopener">' +
          escFooter(formattedWhats || phone) +
          '</a>'
        : '<span class="hcs-item hcs-muted">' + escFooter(phone) + '</span>';
      el.innerHTML =
        '<div class="container hcs-inner">' +
        '<a class="hcs-item" href="mailto:' +
        escFooter(email) +
        '" aria-label="Enviar e-mail para contato institucional Conforta Colchões">' +
        escFooter(email) +
        '</a>' +
        '<span class="hcs-sep" aria-hidden="true">|</span>' +
        phoneBlock +
        '<span class="hcs-sep" aria-hidden="true">|</span>' +
        (emergencyWhatsLink ? '<a class="hcs-item" href="' + emergencyWhatsLink + '" target="_blank" rel="noopener">Urgência: ' + escFooter(formattedEmergencyWhats) + '</a><span class="hcs-sep" aria-hidden="true">|</span>' : '') +
        '<span class="hcs-item hcs-muted" title="Checkout Pro Mercado Pago">Pagamentos Mercado Pago</span>' +
        '<span class="hcs-sep" aria-hidden="true">|</span>' +
        '<span class="hcs-copy">&copy; ' +
        year +
        ' ' +
        escFooter(storeName) +
        '</span>' +
        '</div>';
      return;
    }

    el.innerHTML =
      '<div class="container">' +
      '<div class="footer-compact">' +
      '<a href="index.html" class="footer-brand-mini" aria-label="' +
      escFooter(storeName) +
      ' — página inicial">' +
      '<img src="assets/footer-logo.png" alt="' +
      escFooter(storeName) +
      '" width="360" height="74" loading="lazy" decoding="async" style="height:34px;width:auto;max-width:min(280px,90vw);object-fit:contain;">' +
      '</a>' +
      '<div class="footer-contacts">' +
      '<a class="footer-contact-item" href="mailto:' +
      escFooter(email) +
      '" aria-label="Enviar e-mail para ' +
      escFooter(email) +
      '">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
      '<span>' +
      escFooter(email) +
      '</span>' +
      '</a>' +
      (whatsLink
        ? '<a class="footer-contact-item" href="' +
          whatsLink +
          '" target="_blank" rel="noopener" aria-label="Abrir conversa no WhatsApp Conforta Colchões">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.7 4.2 1.6.7 2.3.7 3.1.6.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20m5.5-15.5A7.7 7.7 0 0 0 12 4a7.7 7.7 0 0 0-7.8 7.8c0 1.4.4 2.7 1.1 3.9L4.2 20l4.4-1.1c1.2.7 2.5 1 3.9 1a7.7 7.7 0 0 0 7.8-7.8c0-2-.8-4-2.3-5.6"/></svg>' +
          '<span>' +
          escFooter(formattedWhats || phone) +
          '</span>' +
          '</a>'
        : '<span class="footer-contact-item">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
          '<span>' +
          escFooter(phone) +
          '</span>' +
          '</span>') +
      (emergencyWhatsLink
        ? '<a class="footer-contact-item footer-contact-item--urgent" href="' +
          emergencyWhatsLink +
          '" target="_blank" rel="noopener" aria-label="Abrir WhatsApp de urgência Conforta Colchões">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.7 4.2 1.6.7 2.3.7 3.1.6.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20m5.5-15.5A7.7 7.7 0 0 0 12 4a7.7 7.7 0 0 0-7.8 7.8c0 1.4.4 2.7 1.1 3.9L4.2 20l4.4-1.1c1.2.7 2.5 1 3.9 1a7.7 7.7 0 0 0 7.8-7.8c0-2-.8-4-2.3-5.6"/></svg>' +
          '<span>Urgência: ' +
          escFooter(formattedEmergencyWhats || 'WhatsApp urgente') +
          '</span>' +
          '</a>'
        : '') +
      (instagramLink
        ? '<a class="footer-contact-item" href="' +
          instagramLink +
          '" target="_blank" rel="noopener" aria-label="Instagram Conforta Colchões">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 7.2c-2.65 0-4.8 2.15-4.8 4.8S9.35 16.8 12 16.8s4.8-2.15 4.8-4.8S14.65 7.2 12 7.2zm0 7.85a3.05 3.05 0 1 1 0-6.1 3.05 3.05 0 0 1 0 6.1zm5.95-8.35a1.12 1.12 0 1 1-2.24 0 1.12 1.12 0 0 1 2.24 0zM12 2c2.67 0 3 .01 4.05.06 1.1.05 1.85.24 2.5.51.68.27 1.26.64 1.84 1.22.58.58.95 1.16 1.22 1.84.27.65.46 1.4.51 2.5.05 1.05.06 1.38.06 4.05s-.01 3-.06 4.05c-.05 1.1-.24 1.85-.51 2.5-.27.68-.64 1.26-1.22 1.84-.58.58-1.16.95-1.84 1.22-.65.27-1.4.46-2.5.51-1.05.05-1.38.06-4.05.06s-3-.01-4.05-.06c-1.1-.05-1.85-.24-2.5-.51-.68-.27-1.26-.64-1.84-1.22-.58-.58-.95-1.16-1.22-1.84-.27-.65-.46-1.4-.51-2.5C2.01 15 2 14.67 2 12s.01-3 .06-4.05c.05-1.1.24-1.85.51-2.5.27-.68.64-1.26 1.22-1.84.58-.58 1.16-.95 1.84-1.22.65-.27 1.4-.46 2.5-.51C9 2.01 9.33 2 12 2zm0 1.8H8.1c-1.02.05-1.57.22-1.94.37-.49.19-.84.42-1.2.78-.36.36-.59.71-.78 1.2-.15.37-.32.92-.37 1.94C4.01 9.1 4 9.42 4 12c0 2.58.01 2.9.06 3.91.05 1.02.22 1.57.37 1.94.19.49.42.84.78 1.2.36.36.71.59 1.2.78.37.15.92.32 1.94.37 1.01.05 1.33.06 3.91.06s2.9-.01 3.91-.06c1.02-.05 1.57-.22 1.94-.37.49-.19.84-.42 1.2-.78.36-.36.59-.71.78-1.2.15-.37.32-.92.37-1.94.05-1.01.06-1.33.06-3.91s-.01-2.9-.06-3.91c-.05-1.02-.22-1.57-.37-1.94-.19-.49-.42-.84-.78-1.2-.36-.36-.71-.59-1.2-.78-.37-.15-.92-.32-1.94-.37-.73-.04-1.01-.05-3.09-.06z"/></svg>' +
          '<span>' +
          escFooter(igDisplay) +
          '</span>' +
          '</a>'
        : '') +
      '</div>' +
      mpTrustBlock +
      '<div class="footer-bottom-mini">&copy; ' +
      year +
      ' ' +
      escFooter(storeName) +
      '. Todos os direitos reservados.</div>' +
      '</div>' +
      '</div>';
  };
})();
