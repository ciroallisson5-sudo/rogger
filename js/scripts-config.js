/**
 * Conforta — configuração de performance (ordem de scripts) e SEO regional.
 * Incluir antes de supabase-config.js, utils.js e demais bundles (todos com defer no final do body).
 */
(function (global) {
  'use strict';

  global.CONFORTA_INSTITUTIONAL_EMAIL = 'contato@confortacolchoes.site';

  /** Ordem recomendada de carregamento (defer, mesmo bloco antes de </body>). */
  global.CONFORTA_SCRIPT_LOAD_ORDER = [
    'js/store-public-config.js',
    'js/scripts-config.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js',
    'js/supabase-config.js',
    'js/components/site-footer.js',
    'js/components/site-header.js',
    'js/utils.js',
    'js/auth.js',
    'js/cart.js',
    'js/components/product-card.js',
    'js/chat.js'
  ];

  var REGIONAL_PHRASE =
    'Colchões em Serra e Vitória, cama box, cabeceiras e kits. Até 12x sem juros e checkout seguro pelo Mercado Pago.';

  var SEO_BY_PAGE = {
    'index.html': {
      title: 'Colchões em Serra e Vitória | Conforta Colchões — até 12x',
      description:
        'Colchões, cama box e cabeceiras na Grande Vitória. Colchão casal, queen e king com orientação e compra segura pelo Mercado Pago. ' +
        REGIONAL_PHRASE,
      keywords:
        'colchões em Serra, colchões em Vitória, cama box, colchão casal, colchão queen, Conforta Colchões, Grande Vitória, Mercado Pago'
    },
    'produtos.html': {
      title: 'Colchões e cama box em Serra e Vitória | Catálogo Conforta Colchões',
      description:
        'Catálogo de colchões em Vitória e Serra, bases box, cabeceiras e kits. Filtre por tamanho e conforto. ' + REGIONAL_PHRASE,
      keywords:
        'colchões em Vitória, colchões em Serra, cama box, colchão casal, colchão queen, catálogo colchões ES, Conforta Colchões'
    },
    'produto.html': {
      title: null,
      description: null,
      keywords:
        'colchão Vitória, colchão Serra, colchão Espírito Santo, Conforta Colchões, Querubim'
    },
    'carrinho.html': {
      title: 'Carrinho — Conforta Colchões | Mercado Pago',
      description:
        'Revise colchões e bases no carrinho. Pagamento seguro pelo Mercado Pago; dúvidas pelo WhatsApp antes de finalizar.',
      keywords: 'carrinho colchões, Mercado Pago, checkout Conforta, Vitória ES, Serra ES'
    },
    'perfil.html': {
      title: 'Minha conta — Conforta Colchões',
      description: 'Pedidos, endereços e dados — atendimento Conforta na região de Vitória e Serra.',
      keywords: 'conta cliente Conforta, pedidos colchão ES'
    },
    'checkout.html': {
      title: 'Checkout — Conforta Colchões',
      description: 'Finalize sua compra com segurança. Atendimento em Vitória, Serra e demais cidades do ES.',
      keywords: 'pagamento colchão, checkout Conforta ES'
    },
    'checkout-retorno.html': {
      title: 'Retorno do pagamento — Conforta Colchões',
      description: 'Confirmação de pagamento e próximos passos do pedido Conforta.',
      keywords: 'pedido colchão, pagamento Conforta'
    },
    'simulador.html': {
      title: 'Simulador — Conforta Colchões',
      description: 'Visualize produtos em 3D. Conforta na Grande Vitória e Espírito Santo.',
      keywords: 'simulador colchão, 3D Conforta, Vitória ES'
    },
    'admin.html': {
      title: null,
      description: null,
      keywords: null
    }
  };

  function ensureMeta(name, content) {
    if (!content) return;
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function ensurePropertyMeta(property, content) {
    if (!content) return;
    var el = document.querySelector('meta[property="' + property + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  /** Ajusta title, description e keywords com foco regional (páginas estáticas). */
  global.applyConfortaRegionalSeo = function (pageFilename) {
    var key = pageFilename || 'index.html';
    var cfg = SEO_BY_PAGE[key];
    if (!cfg) return;
    if (cfg.title) document.title = cfg.title;
    if (cfg.description) ensureMeta('description', cfg.description);
    if (cfg.keywords) ensureMeta('keywords', cfg.keywords);
    var ogDesc = cfg.description;
    if (!ogDesc) {
      var m = document.querySelector('meta[name="description"]');
      ogDesc = m ? m.getAttribute('content') : '';
    }
    if (ogDesc) {
      ensurePropertyMeta('og:title', cfg.title || document.title);
      ensurePropertyMeta('og:description', ogDesc);
      ensureMeta('twitter:card', 'summary_large_image');
    }
  };

  /** COLCHÃO, colchão; padroniza nome de linha Querubim. */
  global.normalizeConfortaBranding = function (s) {
    if (s == null || s === '') return '';
    var t = String(s);
    t = t
      .replace(/\bCOLCHAO\b/g, 'COLCHÃO')
      .replace(/\bColchao\b/g, 'Colchão')
      .replace(/\bcolchao\b/g, 'colchão');
    t = t.replace(/\b(kerub|cherub)[iu]m\b/gi, 'Querubim');
    return t;
  };

  /** Converte linhas iniciadas com ## ou ### em <h2>/<h3> (texto escapado). */
  global.confortaMarkdownLineHeadingsToHtml = function (raw) {
    if (raw == null) return '';
    var lines = String(raw).split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var tr = line.trim();
      if (/^###\s+/.test(tr)) {
        out.push('<h3>' + global.escapeHTML(tr.replace(/^###\s+/, '')) + '</h3>');
      } else if (/^##\s+/.test(tr)) {
        out.push('<h2>' + global.escapeHTML(tr.replace(/^##\s+/, '')) + '</h2>');
      } else {
        out.push(global.escapeHTML(line));
      }
    }
    return out.join('<br>');
  };

  /** Em HTML administrativo: troca padrões ### título (trecho sem tags na mesma linha). */
  global.confortaUpgradeMarkdownHeadingsInHtml = function (html) {
    if (html == null || html === '') return '';
    var s = String(html);
    s = s.replace(/###\s*([^<\n]+)/g, function (_, cap) {
      return '<h3>' + global.escapeHTML(cap.trim()) + '</h3>';
    });
    s = s.replace(/##\s+([^<\n]+)/g, function (_, cap) {
      return '<h2>' + global.escapeHTML(cap.trim()) + '</h2>';
    });
    return s;
  };

  if (typeof global.escapeHTML !== 'function') {
    global.escapeHTML = function (value) {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
