// Conforta Store - AI Chat Widget

let chatSessionId = localStorage.getItem('chatSessionId') || 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

if (!localStorage.getItem('chatSessionId')) {
  localStorage.setItem('chatSessionId', chatSessionId);
}

function initChat() {
  if (document.querySelector('.chat-widget')) return;

  const style = document.createElement('style');
  style.textContent = `
    .chat-widget { position: fixed; bottom: 20px; right: 20px; z-index: 9999; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    .chat-toggle { height: 50px; min-width: 124px; padding: 0 18px; border-radius: 999px; background: linear-gradient(135deg, #0f3a8e, #1a56db); color: #fff; border: 1px solid rgba(255,255,255,0.18); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 12px 30px rgba(26,86,219,0.32); transition: transform 0.2s, box-shadow 0.2s; position: absolute; bottom: 0; right: 0; font-size: 0.85rem; font-weight: 800; letter-spacing: -0.01em; }
    .chat-toggle:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(26,86,219,0.42); }
    .chat-toggle svg { width: 21px; height: 21px; stroke: #fff; fill: none; flex-shrink: 0; }
    .chat-box { display: none; position: fixed; bottom: 80px; right: 20px; width: 340px; height: 460px; max-height: calc(100vh - 100px); background: #fff; border-radius: 14px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); overflow: hidden; flex-direction: column; animation: chatFadeIn 0.25s ease; }
    .chat-box.open { display: flex; }
    @keyframes chatFadeIn { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .chat-header { background: #1a56db; color: #fff; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .chat-header h4 { margin: 0; font-size: 0.9rem; font-weight: 600; letter-spacing: 0.01em; }
    .chat-close { background: none; border: none; color: #fff; cursor: pointer; padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
    .chat-close:hover { background: rgba(255,255,255,0.15); }
    .chat-close svg { width: 18px; height: 18px; stroke: currentColor; fill: none; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; scroll-behavior: smooth; min-height: 0; }
    .chat-messages::-webkit-scrollbar { width: 4px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
    .message { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 0.82rem; line-height: 1.4; word-wrap: break-word; animation: msgFadeIn 0.2s ease; }
    @keyframes msgFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { align-self: flex-end; background: #1a56db; color: #fff; border-bottom-right-radius: 4px; }
    .message.assistant { align-self: flex-start; background: #f3f4f6; color: #1f2937; border-bottom-left-radius: 4px; }
    .message.system { align-self: center; background: transparent; color: #9ca3af; font-size: 0.72rem; font-style: italic; }
    .chat-input-area { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-top: 1px solid #e5e7eb; background: #fff; flex-shrink: 0; }
    .chat-input-area input { flex: 1; min-width: 0; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; font-size: 0.82rem; outline: none; transition: border-color 0.15s; font-family: inherit; }
    .chat-input-area input:focus { border-color: #1a56db; box-shadow: 0 0 0 2px rgba(26,86,219,0.1); }
    .chat-input-area input::placeholder { color: #9ca3af; }
    .chat-input-area button { width: 34px; height: 34px; border-radius: 50%; background: #1a56db; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, transform 0.15s; }
    .chat-input-area button:hover { background: #1648c4; transform: scale(1.05); }
    .chat-input-area button svg { width: 16px; height: 16px; stroke: #fff; fill: none; }
    .typing-indicator { align-self: flex-start; display: flex; align-items: center; gap: 4px; padding: 8px 12px; background: #f3f4f6; border-radius: 12px; border-bottom-left-radius: 4px; }
    .typing-indicator span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: typingBounce 1.2s infinite; }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typingBounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
    .chat-toggle.has-unread::after { content: ''; position: absolute; top: 0; right: 0; width: 12px; height: 12px; background: #ef4444; border-radius: 50%; border: 2px solid #fff; }
    @media (max-width: 600px) {
      .chat-widget { bottom: 14px; right: 14px; }
      .chat-toggle { min-width: 112px; height: 46px; padding: 0 14px; font-size: 0.78rem; }
      .chat-box { position: fixed; left: 10px; right: 10px; bottom: 70px; top: auto; width: auto; height: 60vh; max-height: 460px; border-radius: 12px; }
      .chat-box.open.kb-up { bottom: calc(var(--kb-offset, 0px) + 8px); height: calc(100vh - var(--kb-offset, 0px) - 80px); max-height: none; }
    }
  `;
  document.head.appendChild(style);

  const chatToggleSvg = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Chat 24h</span>`;
  const closeSvg = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  const sendSvg = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;

  const chatToggleBtn = document.createElement('button');
  chatToggleBtn.className = 'chat-toggle';
  chatToggleBtn.innerHTML = chatToggleSvg;
  chatToggleBtn.setAttribute('aria-label', 'Abrir chat');
  chatToggleBtn.addEventListener('click', toggleChat);

  const chatBox = document.createElement('div');
  chatBox.className = 'chat-box';
  chatBox.id = 'chatBox';
  chatBox.innerHTML = `
    <div class="chat-header">
      <h4>Conforta — atendimento</h4>
      <button class="chat-close" aria-label="Fechar chat">${closeSvg}</button>
    </div>
    <div class="chat-messages" id="chatMessages"></div>
    <div class="chat-input-area">
      <input type="text" id="chatInput" placeholder="Digite sua mensagem..." autocomplete="off">
      <button aria-label="Enviar mensagem">${sendSvg}</button>
    </div>
  `;

  const widget = document.createElement('div');
  widget.className = 'chat-widget';
  widget.appendChild(chatBox);
  widget.appendChild(chatToggleBtn);
  document.body.appendChild(widget);

  chatBox.querySelector('.chat-close').addEventListener('click', toggleChat);
  chatBox.querySelector('#chatInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') sendChatMessage();
  });
  chatBox.querySelector('.chat-input-area button').addEventListener('click', sendChatMessage);

    setTimeout(() => {
    addChatMessage('assistant', 'Olá! Sou da equipe Conforta — estou aqui para te ajudar com produtos, preços, entrega na região, parcelamento ou para te encaminhar ao que precisar. Por onde quer começar?');
    loadChatHistory();
  }, 500);
}

function toggleChat() {
  const box = document.getElementById('chatBox');
  const toggle = document.querySelector('.chat-toggle');
  if (!box || !toggle) return;
  const isOpen = box.classList.toggle('open');
  toggle.style.display = isOpen ? 'none' : 'flex';
  toggle.classList.remove('has-unread');
  if (isOpen) {
    const messages = document.getElementById('chatMessages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    const input = document.getElementById('chatInput');
    if (input) setTimeout(() => input.focus(), 300);
    setupChatKeyboardHandling(box);
  } else {
    teardownChatKeyboardHandling();
  }
}

let _chatViewportHandler = null;
function setupChatKeyboardHandling(box) {
  if (!window.visualViewport || _chatViewportHandler) return;
  _chatViewportHandler = function() {
    var vv = window.visualViewport;
    var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    if (kb > 60) {
      box.classList.add('kb-up');
      box.style.setProperty('--kb-offset', kb + 'px');
    } else {
      box.classList.remove('kb-up');
      box.style.setProperty('--kb-offset', '0px');
    }
  };
  window.visualViewport.addEventListener('resize', _chatViewportHandler);
  window.visualViewport.addEventListener('scroll', _chatViewportHandler);
  _chatViewportHandler();
}
function teardownChatKeyboardHandling() {
  if (!window.visualViewport || !_chatViewportHandler) return;
  window.visualViewport.removeEventListener('resize', _chatViewportHandler);
  window.visualViewport.removeEventListener('scroll', _chatViewportHandler);
  _chatViewportHandler = null;
}

window.openChatWidget = function() {
  const box = document.getElementById('chatBox');
  if (!box) {
    initChat();
    setTimeout(toggleChat, 50);
    return;
  }
  if (!box.classList.contains('open')) toggleChat();
};
window.toggleChat = toggleChat;

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';

  addChatMessage('user', message);

  const user = typeof checkAuth === 'function' ? await checkAuth() : null;
  if (user) {
    try {
      await supabaseInsert('chat_messages', {
        user_id: user.id,
        session_id: chatSessionId,
        role: 'user',
        content: message
      });
    } catch (e) { /* silent */ }
  }

  showTypingIndicator();

  try {
    const products = await getProductContext();
    const sortedProducts = sortProductsByPrice(products);
    const pageProduct = getPageProductForChat();

    let response;
    var openAiReply = await tryOpenAiChat(message, pageProduct);
    if (openAiReply) {
      response = { reply: openAiReply };
    } else {
      response = { reply: getLocalResponse(message, sortedProducts) };
    }

    removeTypingIndicator();
    const reply = response.reply || response.answer || response.message || 'Desculpe, não entendi. Pode reformular?';
    try {
      var mUrl = String(reply).match(/produto\.html\?id=([^&\s"'<>]+)/i);
      if (mUrl) writeChatContext({ lastOfferedProductId: decodeURIComponent(mUrl[1]) });
    } catch (e2) { /* silent */ }
    addChatMessage('assistant', reply);

    if (window.__chatGptHistory) {
      window.__chatGptHistory.push({ role: 'user', content: message });
      window.__chatGptHistory.push({ role: 'assistant', content: reply });
      if (window.__chatGptHistory.length > 16) {
        window.__chatGptHistory = window.__chatGptHistory.slice(-16);
      }
    }

    if (user) {
      try {
        await supabaseInsert('chat_messages', {
          user_id: user.id,
          session_id: chatSessionId,
          role: 'assistant',
          content: reply,
          context_data: { products_used: products.length }
        });
      } catch (e) { /* silent */ }
    }
  } catch (e) {
    removeTypingIndicator();
    addChatMessage('assistant', 'Desculpe, estou temporariamente indisponível. Tente novamente em instantes.');
  }
}

function sortProductsByPrice(products) {
  if (!products || !products.length) return [];
  return products.slice().sort(function(a, b) {
    var pa = parseFloat(a.discount_price || a.base_price) || 999999999;
    var pb = parseFloat(b.discount_price || b.base_price) || 999999999;
    return pa - pb;
  });
}

function productPageUrl(productId) {
  try {
    return new URL('produto.html?id=' + encodeURIComponent(productId), window.location.href).href;
  } catch (e) {
    return 'produto.html?id=' + encodeURIComponent(productId);
  }
}

function readChatContext() {
  try {
    var raw = sessionStorage.getItem('chatctx');
    if (!raw) return {};
    var o = JSON.parse(raw);
    if (o.lastOfferedAt && Date.now() - o.lastOfferedAt > 20 * 60 * 1000) {
      sessionStorage.removeItem('chatctx');
      return {};
    }
    return o;
  } catch (e) {
    return {};
  }
}

function writeChatContext(partial) {
  try {
    var cur = readChatContext();
    Object.assign(cur, partial);
    if (partial.lastOfferedProductId === null || partial.lastOfferedProductId === '') {
      delete cur.lastOfferedAt;
    } else if (cur.lastOfferedProductId) {
      cur.lastOfferedAt = Date.now();
    }
    sessionStorage.setItem('chatctx', JSON.stringify(cur));
  } catch (e) { /* silent */ }
}

function buildCatalogSystemPrompt(sortedProducts) {
  var lines = (sortedProducts || []).slice(0, 50).map(function(p) {
    var price = parseFloat(p.discount_price || p.base_price) || 0;
    var name = (p.name || 'Produto').slice(0, 90);
    var id = p.id || '';
    var link = id ? productPageUrl(id) : '';
    return '- ' + name + ' | R$ ' + price.toFixed(2).replace('.', ',') + (link ? ' | ' + link : '');
  });
  var cheapestLine = '';
  if (sortedProducts && sortedProducts.length > 0) {
    var c = sortedProducts[0];
    var cp = parseFloat(c.discount_price || c.base_price) || 0;
    var u = c.id ? productPageUrl(c.id) : '';
    cheapestLine =
      'O item com MENOR preço no catálogo agora é: "' +
      (c.name || 'Produto') +
      '" por R$ ' +
      cp.toFixed(2).replace('.', ',') +
      (u ? '. Link direto: ' + u : '') +
      '.\n';
  }
  return (
    'Você é um atendente da Conforta Colchões (colchões, camas, sofás e móveis). Fale como uma pessoa prestativa da loja: natural, caloroso, sem soar robotizado. Use "eu" quando fizer sentido.\n' +
    'Responda em português do Brasil. Frases curtas quando couber; confirme o que entendeu antes de longas explicações.\n' +
    'Use SOMENTE o catálogo abaixo para nomes, preços e links. Não invente produtos, preços nem URLs.\n' +
    'Orçamento / total com frete: o valor final é no carrinho e checkout; não prometa total fechado nem frete exato sem o cliente simular lá.\n' +
    'Parcelamento: se citar parcela, use apenas divisão do preço à vista do catálogo (referência); juros e máximo de parcelas dependem do meio de pagamento no checkout.\n' +
    'Se o cliente pedir link, página, "manda aí", "sim" depois de você oferecer o produto, envie o link completo da linha do produto.\n' +
    'Se não souber algo (garantia legal, nota fiscal, status de pedido específico), diga com honestidade e oriente a falar no WhatsApp ou na loja — não invente.\n' +
    cheapestLine +
    '\nCatálogo (do menor ao maior preço):\n' +
    (lines.length ? lines.join('\n') : '(catálogo vazio no momento)')
  );
}

function getPageProductForChat() {
  try {
    var p = window.CONFORTA_PAGE_PRODUCT_FOR_CHAT;
    if (p && typeof p === 'object' && p.id) return p;
  } catch (e) { /* ignore */ }
  return null;
}

async function tryOpenAiChat(userMessage, pageProduct) {
  try {
    var probe = await fetch('/api/openai-chat', { method: 'GET' }).catch(function() { return null; });
    if (!probe || !probe.ok) return null;

    if (!window.__chatGptHistory) window.__chatGptHistory = [];

    var hist = window.__chatGptHistory.slice(-12);
    var postBody = {
      include_catalog: true,
      site_base_url: window.location.origin || '',
      messages: hist.concat([{ role: 'user', content: userMessage }])
    };
    if (pageProduct && pageProduct.id) postBody.product = pageProduct;

    var res = await fetch('/api/openai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody)
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok || !data.reply) {
      if (data.error) void data.error;
      return null;
    }
    return String(data.reply).trim() || null;
  } catch (e) {
    return null;
  }
}

async function getProductContext() {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('products')
      .select('id, name, slug, description, base_price, discount_price, category_id, tags, material, featured')
      .eq('active', true)
      .order('featured', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(250);
    return data || [];
  } catch { return []; }
}

function addChatMessage(role, content) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = 'message ' + role;
  msg.textContent = content;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const existing = document.querySelector('.typing-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.querySelector('.typing-indicator');
  if (el) el.remove();
}

function wantsLinkOrProduct(msg) {
  var t = msg.trim().toLowerCase();
  if (/^(sim|s|ss|isso|claro|ok|pode|manda|envia|quero|bora)\b/i.test(t)) return true;
  if (/link|pagina|url|endere[cç]o\s+do\s+produto|ver\s+o\s+produto|abrir\s+o\s+produto|fornecer|passa\s+o|me\s+manda|cad[eê]\s+o/i.test(t)) return true;
  if (/pode\s+(me\s+)?(mandar|enviar|passar)/i.test(t)) return true;
  return false;
}

function getLocalResponse(message, products) {
  const msg = message.toLowerCase();
  const sorted = sortProductsByPrice(products || []);
  var ctx = readChatContext();

  if (wantsLinkOrProduct(msg)) {
    var pid = ctx.lastOfferedProductId;
    if (pid && sorted.length) {
      var pick = null;
      for (var i = 0; i < sorted.length; i++) {
        if (String(sorted[i].id) === String(pid)) {
          pick = sorted[i];
          break;
        }
      }
      if (pick && pick.id) {
        var url = productPageUrl(pick.id);
        var pr2 = parseFloat(pick.discount_price || pick.base_price) || 0;
        writeChatContext({ lastOfferedProductId: null, lastOfferedProductName: null });
        return (
          'Combinado! Aqui está a página do ' +
          pick.name +
          ' (a partir de R$ ' +
          pr2.toFixed(2).replace('.', ',') +
          '):\n' +
          url +
          '\n\nSe quiser, me diga o tamanho (solteiro, casal, queen…) ou se prefere falar com alguém no WhatsApp da loja.'
        );
      }
    }
    if (sorted.length) {
      return 'Pra eu te mandar o link certo, me diz "qual o mais barato" ou o nome do produto (como aparece no site). Se você já tinha pedido o mais barato antes, manda de novo "qual o mais barato" que eu repito o link.';
    }
    return 'Assim que o catálogo carregar eu mando link. Enquanto isso, usa o menu Produtos no site ou o WhatsApp da loja.';
  }

  if (/barat|menor\s*pre[cç]o|mais\s*barat|menor\s*valor|mais\s*econ|qual\s*o\s*mais\s*barat|qual\s*e\s*o\s*mais\s*barat|produto\s*mais\s*barat|o\s*mais\s*barat/i.test(msg)) {
    if (sorted.length > 0) {
      var best = sorted[0];
      var pr = parseFloat(best.discount_price || best.base_price) || 0;
      var linkBest = best.id ? productPageUrl(best.id) : '';
      writeChatContext({ lastOfferedProductId: best.id, lastOfferedProductName: best.name || '' });
      return (
        'Hoje o mais em conta no nosso catálogo é o ' +
        best.name +
        ', a partir de R$ ' +
        pr.toFixed(2).replace('.', ',') +
        '.' +
        (linkBest ? ' Pode abrir direto aqui: ' + linkBest : '') +
        ' Quer que eu sugira algo parecido ou fale de entrega?'
      );
    }
    return 'Não consegui carregar o catálogo agora. Abre a página Produtos no site ou tenta de novo daqui a pouco — às vezes é instabilidade momentânea.';
  }

  if (/^(oi|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|hey)\b/i.test(msg.trim())) {
    return 'Oi! Tudo bem? Me diz o que você está procurando — colchão, sofá, preço, entrega na Grande Vitória… que eu te ajudo passo a passo.';
  }

  if (/obrigad|valeu|agrade[cç]/i.test(msg)) {
    return 'Imagina! Qualquer coisa é só chamar de novo. Se precisar de humano, usa o WhatsApp do site que a equipe responde rapidinho.';
  }

  if (/humano|atendente|pessoa|falar\s+com|telefone|whatsapp|zap/i.test(msg)) {
    return 'Perfeito — para falar com a equipe humana, use o botão WhatsApp no site ou no cabeçalho; eles veem promoções, estoque e agendamento na hora. Enquanto isso posso te ajudar com preços e links dos produtos da vitrine.';
  }

  if (/hor[aá]rio|funciona|abre|fecha|atendimento\s+na\s+loja/i.test(msg)) {
    return 'Consigo te orientar sobre produtos e entrega aqui no chat. Horários e visita à loja o pessoal confirma direto no WhatsApp — é o jeito mais certeiro de pegar alguém disponível.';
  }

  if (msg.includes('preço') || msg.includes('preco') || msg.includes('valor') || msg.includes('custa') || msg.includes('quanto')) {
    var pageP = getPageProductForChat();
    if (pageP && pageP.id) {
      var pv = parseFloat(pageP.preco_exibido_vitrine != null ? pageP.preco_exibido_vitrine : pageP.discount_price || pageP.base_price) || 0;
      var uPage = productPageUrl(pageP.id);
      writeChatContext({ lastOfferedProductId: pageP.id, lastOfferedProductName: pageP.name || '' });
      return (
        'Na página que você abriu agora, o ' +
        (pageP.name || 'produto') +
        ' está com preço a partir de R$ ' +
        pv.toFixed(2).replace('.', ',') +
        ' (configuração atual no site).' +
        (uPage ? ' Link: ' + uPage : '') +
        ' Orçamento com frete e parcelas exatas: confira no carrinho/checkout ou no WhatsApp da loja.'
      );
    }
    if (sorted.length > 0) {
      return (
        'Para eu não te passar preço errado de outro modelo, me diz o nome do produto como aparece no site, ou pergunta "qual o mais barato?" que eu te mando o item certo com link e valor.'
      );
    }
    return 'Temos várias faixas de preço no site. Abre em Produtos ou me diz casal/queen/king que eu te guio.';
  }
  if (msg.includes('prazo') || msg.includes('entrega') || msg.includes('demora') || msg.includes('frete')) {
    return 'A gente trabalha com entrega rápida para Serra, Vitória e região — em muitos casos em até 24 h para itens prontos. CEP e prazo exatos o checkout calcula na hora; se quiser, me passa o bairro que eu te digo o que costuma rolar por aqui.';
  }
  if (msg.includes('colchão') || msg.includes('colchao') || msg.includes('cama')) {
    return 'Temos linha boa de colchão: ortopédico, pillow top, D33/D45, molas ensacadas… Me diz se dorme de lado, costas ou barriga e se prefere mais firme ou mais macio que eu te ajudo a filtrar.';
  }
  if (msg.includes('sofá') || msg.includes('sofa') || msg.includes('poltrona')) {
    return 'Sofá retrátil, sofá-cama, canto, poltrona reclinável… Para quantas pessoas e tamanho do sala? Com isso eu te ajudo a pensar em modelo.';
  }
  if (msg.includes('parcelamento') || msg.includes('parcela') || msg.includes('cartão') || msg.includes('cartao') || msg.includes('pix') || msg.includes('boleto')) {
    return 'No site costuma rolar até 12x sem juros no cartão; PIX e boleto às vezes têm condição melhor — isso aparece certinho no checkout na hora de fechar.';
  }
  if (msg.includes('garantia') || msg.includes('defeito')) {
    return 'Garantia e assistência variam por modelo e fabricante; na página do produto tem resumo e a equipe no WhatsApp confirma certinho na nota e no fabricante. Posso te mandar o link de algum modelo se quiser.';
  }

  return (
    'Hmm, não peguei 100% — pode repetir de outro jeito? ' +
    'Posso te ajudar com: preço e link de produto, qual o mais barato, entrega, parcelamento, ou te encaminhar pro WhatsApp da loja. O que faz mais sentido pra você agora?'
  );
}

async function loadChatHistory() {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from('chat_messages')
      .select('role, content')
      .eq('session_id', chatSessionId)
      .order('created_at', { ascending: true });
    if (data && data.length > 0) {
      const container = document.getElementById('chatMessages');
      if (container && container.children.length <= 1) {
        data.forEach(m => addChatMessage(m.role, m.content));
        window.__chatGptHistory = data
          .filter(function(m) { return m.role === 'user' || m.role === 'assistant'; })
          .map(function(m) { return { role: m.role, content: m.content }; });
      }
    }
  } catch { /* silent */ }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initChat, 1000);
});
