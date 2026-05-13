// Conforta Store - OpenAI Chat proxy (Vercel Serverless)
// Env: OPENAI_API_KEY (obrigatório). Opcional: OPENAI_CHAT_MODEL (default gpt-4o-mini)

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array required' });
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
