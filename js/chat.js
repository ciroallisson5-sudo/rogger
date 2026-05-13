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
    .chat-toggle { width: 50px; height: 50px; border-radius: 50%; background: #1a56db; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(26,86,219,0.35); transition: transform 0.2s, box-shadow 0.2s; position: absolute; bottom: 0; right: 0; }
    .chat-toggle:hover { transform: scale(1.05); box-shadow: 0 6px 24px rgba(26,86,219,0.45); }
    .chat-toggle svg { width: 22px; height: 22px; stroke: #fff; fill: none; }
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
      .chat-toggle { width: 46px; height: 46px; }
      .chat-box { position: fixed; left: 10px; right: 10px; bottom: 70px; top: auto; width: auto; height: 60vh; max-height: 460px; border-radius: 12px; }
      .chat-box.open.kb-up { bottom: calc(var(--kb-offset, 0px) + 8px); height: calc(100vh - var(--kb-offset, 0px) - 80px); max-height: none; }
    }
  `;
  document.head.appendChild(style);

  const chatToggleSvg = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
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
      <h4>Assistente Conforta</h4>
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
    addChatMessage('assistant', 'Olá! Sou assistente da Conforta. Posso ajudar com informações sobre produtos, preços, prazos de entrega e mais. Como posso ajudar?');
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
    const webhookUrl = await getSetting('n8n_webhook_url') || '';
    const products = await getProductContext();
    const sortedProducts = sortProductsByPrice(products);

    let response;
    if (webhookUrl) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          session_id: chatSessionId,
          user_id: user?.id,
          user_name: user?.user_metadata?.full_name,
          products: sortedProducts.slice(0, 20),
          context: {
            store: 'Conforta',
            page: window.location.pathname,
            timestamp: new Date().toISOString()
          }
        })
      });
      response = await res.json();
    } else {
      var openAiReply = await tryOpenAiChat(message, sortedProducts);
      if (openAiReply) {
        response = { reply: openAiReply };
      } else {
        response = { reply: getLocalResponse(message, sortedProducts) };
      }
    }

    removeTypingIndicator();
    const reply = response.reply || response.answer || response.message || 'Desculpe, não entendi. Pode reformular?';
    addChatMessage('assistant', reply);

    if (!webhookUrl && window.__chatGptHistory) {
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

function buildCatalogSystemPrompt(sortedProducts) {
  var lines = (sortedProducts || []).slice(0, 50).map(function(p) {
    var price = parseFloat(p.discount_price || p.base_price) || 0;
    var name = (p.name || 'Produto').slice(0, 90);
    return '- ' + name + ' | R$ ' + price.toFixed(2).replace('.', ',');
  });
  var cheapestLine = '';
  if (sortedProducts && sortedProducts.length > 0) {
    var c = sortedProducts[0];
    var cp = parseFloat(c.discount_price || c.base_price) || 0;
    cheapestLine = 'O item com MENOR preço no catalogo é: "' + (c.name || 'Produto') + '" por R$ ' + cp.toFixed(2).replace('.', ',') + '.\n';
  }
  return (
    'Voce é o assistente virtual da loja Conforta Colchoes (colchoes e moveis).\n' +
    'Responda em portugues do Brasil, de forma objetiva e cordial.\n' +
    'Use apenas o catalogo abaixo para nomes e precos. Nao invente produtos nem valores.\n' +
    cheapestLine +
    '\nCatalogo (do menor ao maior preço):\n' +
    (lines.length ? lines.join('\n') : '(catalogo vazio no momento)')
  );
}

async function tryOpenAiChat(userMessage, sortedProducts) {
  try {
    var probe = await fetch('/api/openai-chat', { method: 'GET' }).catch(function() { return null; });
    if (!probe || !probe.ok) return null;
    var meta = await probe.json().catch(function() { return {}; });
    if (!meta.configured) return null;

    if (!window.__chatGptHistory) window.__chatGptHistory = [];

    var systemContent = buildCatalogSystemPrompt(sortedProducts);
    var hist = window.__chatGptHistory.slice(-12);
    var messages = [{ role: 'system', content: systemContent }].concat(hist, [{ role: 'user', content: userMessage }]);

    var res = await fetch('/api/openai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages })
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok || !data.reply) {
      if (data.error) console.warn('[chat/OpenAI]', data.error);
      return null;
    }
    return String(data.reply).trim() || null;
  } catch (e) {
    console.warn('[chat/OpenAI]', e);
    return null;
  }
}

async function getProductContext() {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from('products')
      .select('id, name, slug, description, base_price, discount_price, category_id, tags, material')
      .eq('active', true)
      .limit(100);
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

function getLocalResponse(message, products) {
  const msg = message.toLowerCase();
  const sorted = sortProductsByPrice(products || []);

  if (/barat|menor\s*pre[cç]o|mais\s*barat|menor\s*valor|mais\s*econ|qual\s*o\s*mais\s*barat|qual\s*e\s*o\s*mais\s*barat|produto\s*mais\s*barat|o\s*mais\s*barat/i.test(msg)) {
    if (sorted.length > 0) {
      var best = sorted[0];
      var pr = parseFloat(best.discount_price || best.base_price) || 0;
      return 'O produto com menor preço no catálogo agora é o ' + best.name + ', a partir de R$ ' + pr.toFixed(2).replace('.', ',') + '. Quer ver a página do produto em Produtos no site?';
    }
    return 'Ainda não consigo ver produtos no catálogo. Tente de novo em instantes ou veja a lista em Produtos no site.';
  }

  if (msg.includes('preço') || msg.includes('preco') || msg.includes('valor') || msg.includes('custa')) {
    if (sorted.length > 0) {
      const p = sorted[Math.floor(Math.random() * Math.min(sorted.length, 5))];
      const price = parseFloat(p.discount_price || p.base_price) || 0;
      return 'O ' + p.name + ' custa a partir de R$ ' + price.toFixed(2).replace('.', ',') + '. Posso ajudar com mais informações?';
    }
    return 'Temos produtos a partir de R$ 199,90. Qual categoria você procura?';
  }
  if (msg.includes('prazo') || msg.includes('entrega') || msg.includes('demora')) {
    return 'Trabalhamos com entrega rápida em até 24 horas para Serra, Vitória e região. Para outras localidades, consulte o prazo no checkout.';
  }
  if (msg.includes('colchão') || msg.includes('colchao') || msg.includes('cama')) {
    return 'Temos colchões ortopédicos, pillow top, espuma D33 e D45, molas ensacadas e muito mais. Qual tipo você prefere?';
  }
  if (msg.includes('sofá') || msg.includes('sofa') || msg.includes('poltrona')) {
    return 'Trabalhamos com sofás retráteis, sofás-cama, poltronas reclináveis e sofás de canto. Para quantos lugares?';
  }
  if (msg.includes('parcelamento') || msg.includes('parcela') || msg.includes('cartão') || msg.includes('cartao')) {
    return 'Aceitamos parcelamento em até 12x sem juros no cartão de crédito. Também aceitamos PIX e boleto com desconto.';
  }
  return 'Não tenho certeza da resposta. Posso falar de preços, entrega, parcelamento ou colchões e sofás. O que você precisa?';
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
