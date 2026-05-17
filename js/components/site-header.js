/**
 * Cabeçalho global Conforta — injeção em páginas sem header e navegação principal.
 */
(function () {
  'use strict';

  window.ensureSiteHeaderIfMissing = function ensureSiteHeaderIfMissing(page) {
    if (document.querySelector('header.header')) return;
    if (
      page === 'admin.html' ||
      page === 'checkout.html' ||
      page === 'carrinho.html' ||
      page === 'checkout-retorno.html'
    ) {
      return;
    }
    var orphan = document.getElementById('cartCount');
    if (orphan && !orphan.closest('header.header')) orphan.remove();

    var header = document.createElement('header');
    header.className = 'header';
    header.innerHTML =
      '<div class="container header-inner">' +
      '<a href="index.html" class="logo" aria-label="Conforta Colchões — início">' +
      '<span class="logo-text">Conforta<small>COLCHÕES</small></span></a>' +
      '<div class="header-actions">' +
      '<button type="button" id="cartBtn" aria-label="Abrir carrinho de compras">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="21" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
      '<span class="cart-count" id="cartCount">0</span></button>' +
      '<a href="perfil.html" id="authBtn" aria-label="Abrir minha conta e perfil">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></a>' +
      '<button type="button" id="mobileMenuBtn" class="mobile-menu-btn" aria-label="Abrir ou fechar menu de navegação">' +
      '<svg id="menuIcon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>' +
      '<svg id="closeIcon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></div></div>' +
      '<div class="mobile-menu" id="mobileMenu"></div>';

    document.body.insertBefore(header, document.body.firstChild);
  };

  window.getQuickNavActive = function getQuickNavActive(page) {
    return {
      home: page === 'index.html',
      products: page === 'produtos.html' || page === 'produto.html',
      cart: page === 'carrinho.html',
      profile: page === 'perfil.html'
    };
  };

  window.getHomeFourNavInnerHtml = function getHomeFourNavInnerHtml(page) {
    var a = window.getQuickNavActive(page);
    void page;
    function link(href, label, isActive) {
      var ac = isActive ? ' class="active" aria-current="page"' : '';
      return '<a href="' + href + '"' + ac + '><span>' + label + '</span></a>';
    }
    return (
      link('index.html', 'Início', !!a.home) +
      link('produtos.html', 'Produtos', !!a.products) +
      link('produtos.html?promo=offer', 'Ofertas', false) +
      link('index.html#entrega', 'Entrega', false) +
      link('index.html#garantia', 'Garantia', false)
    );
  };

  window.enhanceGlobalHeader = function enhanceGlobalHeader(page) {
    if (page === 'checkout.html' || page === 'carrinho.html') return;
    window.ensureSiteHeaderIfMissing(page);
    var header = document.querySelector('header.header');
    if (!header) return;

    var logo = header.querySelector('.logo');
    var nav = header.querySelector('.main-nav');
    var search = header.querySelector('.search-bar');

    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'main-nav cc-main-nav cc-home-four-nav';
      nav.setAttribute('aria-label', 'Navegação principal');
      if (search && page === 'index.html') {
        search.insertAdjacentElement('afterend', nav);
      } else if (logo && logo.parentNode) {
        logo.insertAdjacentElement('afterend', nav);
      } else {
        return;
      }
    }

    nav.classList.add('cc-home-four-nav', 'cc-main-nav');
    nav.setAttribute('aria-label', 'Navegação principal');
    nav.innerHTML = window.getHomeFourNavInnerHtml(page);

    var actions = header.querySelector('.header-actions');
    if (actions && !actions.querySelector('.header-whatsapp')) {
      var mobileBtn = actions.querySelector('#mobileMenuBtn');
      var whats = document.createElement('a');
      whats.href = '#';
      whats.className = 'header-whatsapp js-global-whatsapp';
      whats.setAttribute(
        'data-message',
        'Olá! Preciso tirar uma dúvida sobre o colchão ideal (tamanho, densidade ou entrega).'
      );
      whats.setAttribute('aria-label', 'Falar no WhatsApp com a Conforta Colchões');
      whats.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.7 4.2 1.6.7 2.3.7 3.1.6.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20m5.5-15.5A7.7 7.7 0 0 0 12 4a7.7 7.7 0 0 0-7.8 7.8c0 1.4.4 2.7 1.1 3.9L4.2 20l4.4-1.1c1.2.7 2.5 1 3.9 1a7.7 7.7 0 0 0 7.8-7.8c0-2-.8-4-2.3-5.6"/></svg><span>WhatsApp</span>';
      if (mobileBtn) actions.insertBefore(whats, mobileBtn);
      else actions.appendChild(whats);
    }

    var auth = header.querySelector('#authBtn');
    if (auth) {
      auth.classList.add('cc-header-profile-aux');
      auth.setAttribute('aria-label', 'Minha conta (login e pedidos)');
      auth.setAttribute('title', 'Conta');
    }

    var mobileMenu = header.querySelector('#mobileMenu');
    if (mobileMenu && !mobileMenu.dataset.polished) {
      mobileMenu.innerHTML = [
        '<a href="index.html">Início</a>',
        '<a href="produtos.html">Produtos</a>',
        '<a href="produtos.html?promo=offer">Ofertas</a>',
        '<a href="index.html#entrega">Entrega</a>',
        '<a href="index.html#garantia">Garantia</a>',
        '<a href="#" class="js-global-whatsapp" data-message="Olá! Preciso de ajuda para escolher colchão ou cama box.">WhatsApp</a>',
        '<a href="carrinho.html">Carrinho</a>',
        '<a href="perfil.html" class="cc-mobile-menu-secondary">Minha conta</a>'
      ].join('');
      mobileMenu.dataset.polished = 'true';
    }
  };
})();
