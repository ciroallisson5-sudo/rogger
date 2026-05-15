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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    let messages;
    const blurbOn =
      body.n8n_product_blurb === true ||
      body.n8n_product_blurb === 'true' ||
      body.n8n_product_blurb === 1 ||
      body.n8n_product_blurb === '1';
    let productPayload = body.product;
    if (typeof productPayload === 'string' && productPayload.trim()) {
      try {
        productPayload = JSON.parse(productPayload);
      } catch (_) {
        productPayload = null;
      }
    }
    if (blurbOn && productPayload && typeof productPayload === 'object' && !Array.isArray(productPayload)) {
      const catalogHint =
        typeof body.catalog_hint === 'string' ? body.catalog_hint.trim().slice(0, 12000) : '';
      const sys =
        'Voce e atendente da Conforta Colchoes, no mesmo tom do chat do site: natural, prestativo, portugues do Brasil.\n' +
        'Tarefa: escrever UMA unica mensagem curta (no maximo cerca de 320 caracteres) para WhatsApp ou legenda de rede social sobre o produto em foco.\n' +
        'Use apenas dados fornecidos; nao invente precos, garantias nem links que nao estiverem nos dados.\n' +
        (catalogHint
          ? 'Contexto opcional de outros produtos da loja (para alinhar tom, nao copie nomes aleatoriamente):\n' +
            catalogHint +
            '\n\n'
          : '') +
        'Produto em foco (JSON):\n' +
        JSON.stringify(productPayload);
      const userMsg =
        typeof body.instruction === 'string' && body.instruction.trim()
          ? body.instruction.trim()
          : 'Gere a mensagem promocional curta, convidativa, em um unico paragrafo, sem lista com tracos.';
      messages = [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg }
      ];
    } else {
      messages = body.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          error: 'Envie "messages" (array) ou use n8n_product_blurb: true com objeto "product".'
        });
        return;
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
        temperature: 0.5
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
