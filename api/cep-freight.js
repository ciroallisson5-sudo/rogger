'use strict';

const { applyBrowserCors, handleOptions, parseBody } = require('./_http');
const { rateLimitKey, allow, prune } = require('./_rate-limit');
const { normalizeBrazilCepDigits, normalizeBrazilState, resolveEspiritoSantoDelivery } = require('./_cep');

function toMoney2(value) {
  const n = Number(value);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function defaultEsFreightAmount() {
  return toMoney2(
    process.env.ES_FREIGHT_AMOUNT ||
      process.env.DELIVERY_ES_FREIGHT_AMOUNT ||
      process.env.FREIGHT_ES_AMOUNT ||
      150
  );
}

async function fetchSettingSingle(key, base, service) {
  if (!base || !service) return null;
  const res = await fetch(
    base + '/rest/v1/site_settings?key=eq.' + encodeURIComponent(key) + '&select=value&limit=1',
    {
      headers: { apikey: service, Authorization: 'Bearer ' + service }
    }
  ).catch(function () {
    return null;
  });
  if (!res || !res.ok) return null;
  const rows = await res.json().catch(function () {
    return [];
  });
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0].value;
}

function parseDeliveryInfo(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) || {};
    } catch (_) {
      return {};
    }
  }
  return {};
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
    res.status(429).json({ error: 'Muitas consultas de entrega. Aguarde um minuto.' });
    return;
  }

  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const body = parseBody(req.body);
  const cepNorm = normalizeBrazilCepDigits(body.cep || body.zip_code || body.zipCode || '');
  const stateNorm = normalizeBrazilState(body.state || body.uf || '');
  const subtotal = parseFloat(body.subtotal) || 0;

  if (!cepNorm) {
    res.status(400).json({
      ok: false,
      delivered: false,
      message: 'CEP inválido ou incompleto. Informe um CEP do Espírito Santo.'
    });
    return;
  }

  try {
    const deliveryInfoRaw = await fetchSettingSingle('delivery_info', base, service);
    const deliveryInfo = parseDeliveryInfo(deliveryInfoRaw);
    const noMsgRaw = await fetchSettingSingle('cep_no_delivery_message', base, service);
    const defaultNoMsg =
      'No momento, entregamos apenas para endereços no Espírito Santo. Fale com a loja pelo WhatsApp para consultar alternativas.';
    const noMessage =
      typeof noMsgRaw === 'string' && noMsgRaw.trim() ? String(noMsgRaw).trim() : defaultNoMsg;

    const coverage = resolveEspiritoSantoDelivery({ cep: cepNorm, state: stateNorm });
    if (!coverage.allowed) {
      res.status(200).json({
        ok: true,
        delivered: false,
        cep: cepNorm,
        state: stateNorm || null,
        delivery_rule: 'espirito_santo_only',
        message: noMessage
      });
      return;
    }

    let freight = defaultEsFreightAmount();
    if (deliveryInfo && deliveryInfo.es_freight_amount != null && deliveryInfo.es_freight_amount !== '') {
      freight = toMoney2(deliveryInfo.es_freight_amount);
    } else if (deliveryInfo && deliveryInfo.freight_amount != null && deliveryInfo.freight_amount !== '') {
      freight = toMoney2(deliveryInfo.freight_amount);
    }

    let freeFrom = 0;
    if (deliveryInfo && deliveryInfo.free_from != null) freeFrom = parseFloat(deliveryInfo.free_from) || 0;

    let finalFreight = freight;
    if (freeFrom > 0 && subtotal >= freeFrom) {
      finalFreight = 0;
    }

    res.status(200).json({
      ok: true,
      delivered: true,
      cep: cepNorm,
      state: 'ES',
      delivery_rule: 'espirito_santo_only',
      freight_amount: finalFreight,
      base_freight: freight,
      free_shipping_applied: finalFreight === 0 && freight > 0 && freeFrom > 0 && subtotal >= freeFrom,
      label: 'Espírito Santo'
    });
  } catch (err) {
    console.error('[cep-freight]', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Erro ao validar a entrega.' });
  }
};
