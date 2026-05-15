// Conforta Store — assistente (Vercel Serverless)
// Env: OPENAI_API_KEY (obrigatório). Opcional: OPENAI_CHAT_MODEL (default gpt-4o-mini)
//
// POST normal: { "messages": [ { "role":"system"|"user"|"assistant", "content":"..." }, ... ] }
// POST n8n (texto curto mesmo “cérebro” do chat): {
//   "n8n_product_blurb": true,
//   "product": { ... objeto vindo do webhook ... },
//   "catalog_hint": "(opcional) texto com resumo de outros produtos",
//   "instruction": "(opcional) ex: Gere legenda para Instagram"
// }
// Opcional com "messages": envie tambem "product" ou "produto" (objeto JSON do Supabase/Make)
// para a IA usar precos reais — sem isso o modelo pode alucinar valores.

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function safeProductJson(product) {
  try {
    const s = JSON.stringify(product);
    if (s.length > 14000) return s.slice(0, 14000) + '\n...(truncado)';
    return s;
  } catch (_) {
    return '{}';
  }
}

/** Anexa dados do produto ao system (ou cria system) para evitar precos inventados. */
function injectProductContext(messages, product) {
  const block =
    '\n\n[Dados oficiais do catalogo — use SOMENTE estes valores para precos (base_price, discount_price, etc.). ' +
    'Nao invente valores. Se algo nao constar no JSON, diga que o cliente deve conferir no site. ' +
    'Seja objetivo; evite repetir a mesma palavra em sequencia.]\n' +
    safeProductJson(product);
  const arr = messages.map(function(m) {
    return { role: m.role, content: String(m.content == null ? '' : m.content) };
  });
  if (arr.length > 0 && arr[0].role === 'system') {
    arr[0].content = arr[0].content + block;
    return arr;
  }
  arr.unshift({
    role: 'system',
    content:
      'Voce e o assistente da Conforta Colchoes. Responda em portugues do Brasil, de forma clara e correta.' + block
  });
  return arr;
}

function normalizeRequestBody(raw) {
  let b = raw;
  if (b == null) return {};
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b.trim() || '{}');
    } catch (_) {
      return {};
    }
  }
  if (typeof b !== 'object' || Array.isArray(b)) return {};
  if (b.body && typeof b.body === 'object' && !Array.isArray(b.body)) {
    const inner = b.body;
    const hasInner =
      inner.messages != null ||
      inner.mensagens != null ||
      inner.product != null ||
      inner.produto != null ||
      inner.n8n_product_blurb != null;
    if (hasInner) {
      b = Object.assign({}, b, inner);
    }
  }
  return b;
}

function truthyBlurb(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v)
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'sim';
}

/** Valor tipico quando se cola {{ $json }} dentro de JSON estatico no n8n/Make. */
function isPlaceholderObjectString(v) {
  if (typeof v !== 'string') return false;
  return /^\[object\s+object\]$/i.test(v.trim());
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
    const configured = !!process.env.OPENAI_API_KEY;
    res.status(200).json({ ok: true, configured });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'OPENAI_API_KEY not configured', reply: null });
    return;
  }

  try {
    const body = normalizeRequestBody(req.body);

    const rawProductField = body.product !== undefined ? body.product : body.produto;
    if (isPlaceholderObjectString(rawProductField)) {
      res.status(400).json({
        error:
          'O campo "product" veio como a string "[object Object]" — o JSON enviado esta invalido (comum no n8n ao misturar expressao com texto JSON).',
        n8n_corpo_correto_exemplo:
          '={{ JSON.stringify({ n8n_product_blurb: true, product: $json }) }}',
        n8n_dica:
          'No HTTP Request use o corpo inteiro como UMA expressao (comece com =), ou use JSON.stringify; nao escreva {{ $json }} solto dentro de chaves JSON.'
      });
      return;
    }

    let messages;
    let blurbOn = truthyBlurb(body.n8n_product_blurb);
    let productPayload = body.product != null ? body.product : body.produto;
    if (typeof productPayload === 'string' && productPayload.trim()) {
      try {
        productPayload = JSON.parse(productPayload);
      } catch (_) {
        productPayload = null;
      }
    }

    const msgsRaw = body.messages != null ? body.messages : body.mensagens;
    if (!blurbOn && productPayload && typeof productPayload === 'object' && !Array.isArray(productPayload)) {
      const hasMessages = Array.isArray(msgsRaw) && msgsRaw.length > 0;
      if (!hasMessages) {
        blurbOn = true;
      }
    }

    let temperature = 0.55;

    if (blurbOn && productPayload && typeof productPayload === 'object' && !Array.isArray(productPayload)) {
      temperature = 0.35;
      const catalogHint =
        typeof body.catalog_hint === 'string' ? body.catalog_hint.trim().slice(0, 12000) : '';
      const sys =
        'Voce e atendente da Conforta Colchoes, no mesmo tom do chat do site: natural, prestativo, portugues do Brasil.\n' +
        'Tarefa: escrever UMA unica mensagem curta (no maximo cerca de 320 caracteres) para WhatsApp ou legenda de rede social sobre o produto em foco.\n' +
        'Use apenas dados fornecidos; nao invente precos, garantias nem links que nao estiverem nos dados.\n' +
        'Evite repetir a mesma palavra em sequencia (ex.: conforto conforto).\n' +
        (catalogHint
          ? 'Contexto opcional de outros produtos da loja (para alinhar tom, nao copie nomes aleatoriamente):\n' +
            catalogHint +
            '\n\n'
          : '') +
        'Produto em foco (JSON):\n' +
        safeProductJson(productPayload);
      const userMsg =
        typeof body.instruction === 'string' && body.instruction.trim()
          ? body.instruction.trim()
          : 'Gere a mensagem promocional curta, convidativa, em um unico paragrafo, sem lista com tracos.';
      messages = [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg }
      ];
    } else {
      messages = msgsRaw;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          error:
            'Envie "messages" (array) ou "mensagens", ou use n8n_product_blurb: true com objeto "product" (ou "produto").',
          exemplo_chat: {
            messages: [
              { role: 'system', content: 'Voce e o assistente da loja.' },
              { role: 'user', content: 'Oi!' }
            ]
          },
          exemplo_n8n_blurb: {
            n8n_product_blurb: true,
            product: { name: 'Colchao King', base_price: 3999, description: '...' }
          },
          exemplo_n8n_blurb_pt: {
            n8n_product_blurb: true,
            produto: { name: 'Colchao King', base_price: 3999 }
          },
          dica_precos:
            'Para a IA acertar preco e descricao, envie no mesmo POST o objeto "product" (dados do produto vindos do Supabase ou do modulo anterior no Make), junto com "messages".'
        });
        return;
      }
      if (productPayload && typeof productPayload === 'object' && !Array.isArray(productPayload)) {
        messages = injectProductContext(messages, productPayload);
        temperature = 0.35;
      }
    }

    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

    const openaiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages: messages.slice(0, 24),
        max_tokens: 600,
        temperature: temperature
      })
    });

    const data = await openaiRes.json().catch(function() { return {}; });

    if (!openaiRes.ok) {
      const errMsg = data.error?.message || data.message || 'OpenAI request failed';
      res.status(openaiRes.status >= 400 && openaiRes.status < 600 ? openaiRes.status : 502).json({
        error: errMsg,
        reply: null
      });
      return;
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || '').trim()
      : '';

    if (!reply) {
      res.status(502).json({ error: 'Empty response from model', reply: null });
      return;
    }

    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Internal error', reply: null });
  }
};
