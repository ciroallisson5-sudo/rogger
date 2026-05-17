'use strict';

const { applyBrowserCors, handleOptions, parseBody } = require('./_http');
const { rateLimitKey, allow, prune } = require('./_rate-limit');

function normalizeCep(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 8) return '';
  if (d[0] === '0') return '';
  return d;
}

async function fetchSettingSingle(key, base, service) {
  const res = await fetch(
    base + '/rest/v1/site_settings?key=eq.' + encodeURIComponent(key) + '&select=value&limit=1',
    {
      headers: { apikey: service, Authorization: 'Bearer ' + service }
    }
  );
  const rows = await res.json().catch(function () {
    return [];
  });
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0].value;
}

module.exports = async function handler(req, res) {
  prune();
  applyBrowserCors(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = rateLimitKey(req, 'cep-freight');
  if (!allow(key, 45, 60000)) {
    res.status(429).json({ error: 'Muitas consultas de CEP. Aguarde um minuto.' });
    return;
  }

  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!service || !base) {
    res.status(503).json({ error: 'Supabase não configurado no servidor.' });
    return;
  }

  const body = parseBody(req.body);
  const cepNorm = normalizeCep(body.cep);
  const subtotal = parseFloat(body.subtotal) || 0;

  if (!cepNorm) {
    res.status(400).json({ delivered: false, message: 'CEP invalido. Informe 8 digitos (sem comecar com 0).' });
    return;
  }

  try {
    const noMsgRaw = await fetchSettingSingle('cep_no_delivery_message', base, service);
    const defaultNoMsg =
      'Infelizmente não realizamos entrega para este CEP no momento. Fale com a loja pelo WhatsApp para consultar alternativas.';
    const noMessage =
      typeof noMsgRaw === 'string' && noMsgRaw.trim() ? String(noMsgRaw).trim() : defaultNoMsg;

    const lookupRes = await fetch(
      base +
        '/rest/v1/delivery_cep_rates?cep=eq.' +
        encodeURIComponent(cepNorm) +
        '&select=id,cep,freight_amount,label,lookup_count&limit=1',
      { headers: { apikey: service, Authorization: 'Bearer ' + service } }
    );
    const rows = await lookupRes.json().catch(function () {
      return [];
    });
    const row = Array.isArray(rows) && rows[0];

    if (!row) {
      res.status(200).json({
        ok: true,
        delivered: false,
        cep: cepNorm,
        message: noMessage
      });
      return;
    }

    const newCount = (row.lookup_count || 0) + 1;
    await fetch(base + '/rest/v1/delivery_cep_rates?id=eq.' + encodeURIComponent(row.id), {
      method: 'PATCH',
      headers: {
        apikey: service,
        Authorization: 'Bearer ' + service,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ lookup_count: newCount })
    }).catch(function () {});

    let freight = Number(row.freight_amount);
    if (isNaN(freight)) freight = 0;

    const deliveryInfo = await fetchSettingSingle('delivery_info', base, service);
    let freeFrom = 0;
    try {
      if (deliveryInfo && typeof deliveryInfo === 'object') {
        freeFrom = parseFloat(deliveryInfo.free_from) || 0;
      } else if (deliveryInfo && typeof deliveryInfo === 'string') {
        const di = JSON.parse(deliveryInfo);
        freeFrom = parseFloat(di.free_from) || 0;
      }
    } catch (_) {
      /**/
    }

    let finalFreight = freight;
    if (freeFrom > 0 && subtotal >= freeFrom) {
      finalFreight = 0;
    }

    res.status(200).json({
      ok: true,
      delivered: true,
      cep: cepNorm,
      freight_amount: finalFreight,
      base_freight: freight,
      free_shipping_applied: finalFreight === 0 && freight > 0 && freeFrom > 0 && subtotal >= freeFrom,
      label: row.label || null
    });
  } catch (err) {
    void err;
    res.status(500).json({ error: 'Erro ao consultar CEP' });
  }
};
