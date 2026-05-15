// Conforta Store — IA unificada (chat do site + n8n HTTP POST)
// Vercel: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY)
// Opcional: OPENAI_CHAT_MODEL, SITE_PUBLIC_URL
//
// POST site / n8n (recomendado — mesmo cerebro, catalogo no servidor):
//   { "user_message": "qual o mais barato?", "product": { ... }, "include_catalog": true }
//   ou { "messages": [...], "product": {...} }
//
// POST legenda curta (WhatsApp / rede social):
//   { "n8n_product_blurb": true, "product": {...}, "instruction": "..." }

const brain = require('./ai-brain');
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function parseRawBody(raw) {
  if (raw == null) return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw.trim() || '{}');
    } catch (_) {
      return { __parseError: true };
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function normalizeRequestBody(raw) {
  let b = parseRawBody(raw);
  if (b.__parseError) return b;
  if (Array.isArray(b) && b.length > 0 && typeof b[0] === 'object' && !Array.isArray(b[0])) {
    b = b[0];
  }
  if (typeof b !== 'object' || Array.isArray(b)) return {};
  ['input', 'data', 'body', 'json', 'payload'].forEach(function (key) {
    const inner = b[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      b = Object.assign({}, b, inner);
    }
  });
  return b;
}

/** Detecta produto no corpo (n8n costuma mandar campos soltos, sem chave "product"). */
function inferProductFromBody(body) {
  const direct = parseProductField(body.product !== undefined ? body.product : body.produto);
  if (direct) return direct;

  const nested = body.data && body.data.product;
  if (nested && typeof nested === 'object') return nested;

  const looksLikeProduct =
    body.product_id ||
    body.productId ||
    (body.name && (body.base_price != null || body.price_display != null || body.list_price != null)) ||
    (body.product_name && (body.base_price != null || body.price_display != null));

  if (!looksLikeProduct) return null;

  const id = body.product_id || body.productId || body.id || null;
  const name = body.product_name || body.name || body.productName || 'Produto';
  const list = parseFloat(body.list_price != null ? body.list_price : body.base_price) || 0;
  const display =
    body.price_display != null
      ? parseFloat(body.price_display)
      : body.discount_price != null
        ? parseFloat(body.discount_price)
        : list;

  return {
    id: id,
    name: name,
    slug: body.slug || null,
    description: body.description || body.description_excerpt || '',
    base_price: body.base_price != null ? body.base_price : list,
    discount_price: body.discount_price,
    preco_exibido_vitrine: display,
    summary_line: body.summary_line || null,
    product_page_url: body.product_page_url || null,
    first_photo_url: body.first_photo_url || null,
    category_name: body.category_name || (body.category && body.category.name) || null,
    tags: body.tags || [],
    material: body.material,
    dimensions: body.dimensions,
    stock: body.stock,
    event: body.event
  };
}

function truthy(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'sim';
}

function isPlaceholderObjectString(v) {
  if (typeof v !== 'string') return false;
  return /^\[object\s+object\]$/i.test(v.trim());
}

function parseProductField(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function extractUserMessage(body, msgsRaw) {
  const direct =
    body.user_message ||
    body.userMessage ||
    body.pergunta ||
    body.message ||
    body.mensagem ||
    body.text ||
    body.chatInput ||
    body.query ||
    body.prompt ||
    body.instruction ||
    '';
  if (String(direct).trim()) return String(direct).trim();
  if (Array.isArray(msgsRaw) && msgsRaw.length) {
    for (let i = msgsRaw.length - 1; i >= 0; i--) {
      if (msgsRaw[i].role === 'user' && msgsRaw[i].content) {
        return String(msgsRaw[i].content).trim();
      }
    }
  }
  return '';
}

function historyFromMessages(msgsRaw) {
  if (!Array.isArray(msgsRaw)) return [];
  return msgsRaw.filter(function (m) {
    return m && (m.role === 'user' || m.role === 'assistant');
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      configured: !!process.env.OPENAI_API_KEY,
      catalog_from_supabase: brain.isSupabaseConfigured()
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: 'OPENAI_API_KEY not configured (defina na Vercel, nao no .env do site)',
      reply: null
    });
    return;
  }

  try {
    const body = normalizeRequestBody(req.body);
    if (body.__parseError) {
      res.status(400).json({
        error: 'JSON invalido no corpo. No n8n use Body → JSON e expressao com = e JSON.stringify.',
        n8n_exemplo:
          "={{ JSON.stringify({ user_message: 'Legenda do produto', product: $json, include_catalog: true }) }}"
      });
      return;
    }
    const siteBase =
      (typeof body.site_base_url === 'string' && body.site_base_url.trim()) ||
      (typeof body.siteBaseUrl === 'string' && body.siteBaseUrl.trim()) ||
      process.env.SITE_PUBLIC_URL ||
      '';

    const rawProductField = body.product !== undefined ? body.product : body.produto;
    if (isPlaceholderObjectString(rawProductField)) {
      res.status(400).json({
        error:
          'Campo "product" invalido ([object Object]). No n8n use o corpo inteiro como expressao com JSON.stringify.',
        n8n_exemplo:
          "={{ JSON.stringify({ user_message: 'Gere legenda', product: $json, include_catalog: true }) }}"
      });
      return;
    }

    const productPayload = inferProductFromBody(body);
    const msgsRaw = body.messages != null ? body.messages : body.mensagens;
    const includeCatalog = body.include_catalog !== false && body.include_catalog !== 'false';
    const blurbOn = truthy(body.n8n_product_blurb) || truthy(body.blurb);
    let userMessage = extractUserMessage(body, msgsRaw);
    if (!userMessage && productPayload && (body.summary_line || body.event)) {
      userMessage =
        typeof body.instruction === 'string' && body.instruction.trim()
          ? body.instruction.trim()
          : 'Gere uma mensagem curta e convidativa sobre este produto para WhatsApp ou Instagram.';
    }
    if (!userMessage && !productPayload && includeCatalog) {
      userMessage = 'Responda como atendente da loja com base no catalogo.';
    }

    let messages;
    let temperature = 0.5;
    let catalogCount = 0;

    if (blurbOn && productPayload) {
      temperature = 0.35;
      const instruction =
        (typeof body.instruction === 'string' && body.instruction.trim()) ||
        'Gere UMA mensagem curta (ate ~320 caracteres) para WhatsApp ou rede social sobre o produto em foco. Um paragrafo, sem lista.';
      const assembled = await brain.assembleBrainMessages({
        siteBase: siteBase,
        includeCatalog: includeCatalog,
        product: productPayload,
        userMessage: instruction,
        extraSystem:
          'Tarefa extra: texto promocional curto. Use apenas dados do catalogo e do produto em foco. Nao invente precos nem links.'
      });
      messages = assembled.messages;
      catalogCount = assembled.catalogCount;
    } else if (Array.isArray(msgsRaw) && msgsRaw.length > 0) {
      const history = historyFromMessages(msgsRaw);
      const lastUser = userMessage || '';
      const assembled = await brain.assembleBrainMessages({
        siteBase: siteBase,
        includeCatalog: includeCatalog,
        product: productPayload,
        history: history.filter(function (m, idx, arr) {
          if (lastUser && m.role === 'user' && idx === arr.length - 1 && String(m.content).trim() === lastUser) {
            return false;
          }
          return true;
        }),
        userMessage: lastUser || (history.length ? '' : 'Oi')
      });
      messages = assembled.messages;
      catalogCount = assembled.catalogCount;
      if (!lastUser && history.length) {
        const last = history[history.length - 1];
        if (last.role === 'user') messages[messages.length - 1] = last;
      }
    } else if (userMessage) {
      const assembled = await brain.assembleBrainMessages({
        siteBase: siteBase,
        includeCatalog: includeCatalog,
        product: productPayload,
        userMessage: userMessage
      });
      messages = assembled.messages;
      catalogCount = assembled.catalogCount;
    } else if (productPayload && !userMessage) {
      const assembled = await brain.assembleBrainMessages({
        siteBase: siteBase,
        includeCatalog: includeCatalog,
        product: productPayload,
        userMessage: 'Descreva este produto para o cliente com preco e link corretos.'
      });
      messages = assembled.messages;
      catalogCount = assembled.catalogCount;
    } else {
      res.status(400).json({
        error:
          'Corpo vazio ou nao reconhecido. No n8n: metodo POST, Body JSON, expressao ={{ JSON.stringify({ user_message: "...", product: $json }) }}',
        chaves_recebidas: Object.keys(body).slice(0, 25),
        exemplo_n8n_minimo:
          "={{ JSON.stringify({ user_message: 'Legenda promocional', product: $json, include_catalog: true, site_base_url: 'https://confortacolchoes.vercel.app' }) }}",
        exemplo_n8n_webhook:
          'Envie o item do webhook inteiro como product: $json (a API aceita product_id, product_name, base_price no nivel raiz).'
      });
      return;
    }

    if (!messages || messages.length < 2) {
      res.status(400).json({ error: 'Nao foi possivel montar a conversa.', reply: null });
      return;
    }

    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
    const openaiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: model,
        messages: messages.slice(0, 26),
        max_tokens: 650,
        temperature: temperature
      })
    });

    const data = await openaiRes.json().catch(function () {
      return {};
    });

    if (!openaiRes.ok) {
      const errMsg = data.error?.message || data.message || 'OpenAI request failed';
      res.status(openaiRes.status >= 400 && openaiRes.status < 600 ? openaiRes.status : 502).json({
        error: errMsg,
        reply: null
      });
      return;
    }

    const reply =
      data.choices && data.choices[0] && data.choices[0].message
        ? String(data.choices[0].message.content || '').trim()
        : '';

    if (!reply) {
      res.status(502).json({ error: 'Empty response from model', reply: null });
      return;
    }

    res.status(200).json({
      reply: reply,
      catalog_products: catalogCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error', reply: null });
  }
};
