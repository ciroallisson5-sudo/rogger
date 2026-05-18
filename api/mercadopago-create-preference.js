'use strict';

const { applyBrowserCors, handleOptions, readJsonBody, parseBody } = require('./_http');
const { verifySupabaseUserJwt } = require('./_supabase-user');
const { rateLimitKey, allow, prune } = require('./_rate-limit');
const { adminConfig, restGet, restPost, resolvePublicBaseUrl } = require('./mercadopago-sync');
const { normalizeBrazilCepDigits } = require('./_cep');

function resolveMercadoPagoAccessToken() {
  return String(
    process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      process.env.MERCADOPAGO_ACCESS_TOKEN ||
      process.env.MP_ACCESS_TOKEN ||
      ''
  ).trim();
}

function normalizeMercadoPagoEnv(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'sandbox' || raw === 'test' || raw === 'testing' || raw === 'homologacao' || raw === 'homologação') {
    return 'sandbox';
  }
  if (raw === 'production' || raw === 'prod' || raw === 'live') {
    return 'production';
  }
  return 'auto';
}

function detectMercadoPagoTokenEnv(accessToken) {
  const t = String(accessToken || '').trim();
  if (/^TEST-/i.test(t)) return 'sandbox';
  if (/^APP_USR-/i.test(t)) return 'production';
  return '';
}

function resolveMercadoPagoCheckoutEnv(accessToken) {
  const configured = normalizeMercadoPagoEnv(process.env.MERCADO_PAGO_ENV || process.env.MERCADOPAGO_ENV || 'auto');
  const tokenEnv = detectMercadoPagoTokenEnv(accessToken);
  if (configured === 'auto') return tokenEnv || 'production';
  if (tokenEnv && configured !== tokenEnv) {
    return tokenEnv;
  }
  return configured;
}

function mercadoPagoEnvWarning(accessToken) {
  const configured = normalizeMercadoPagoEnv(process.env.MERCADO_PAGO_ENV || process.env.MERCADOPAGO_ENV || 'auto');
  const tokenEnv = detectMercadoPagoTokenEnv(accessToken);
  if (configured !== 'auto' && tokenEnv && configured !== tokenEnv) {
    return 'MERCADO_PAGO_ENV=' + configured + ' não combina com token ' + tokenEnv + '. Use MERCADO_PAGO_ENV=' + tokenEnv + ' ou MERCADO_PAGO_ENV=auto.';
  }
  return '';
}

function pickMercadoPagoCheckoutUrl(mpJson, accessToken) {
  const env = resolveMercadoPagoCheckoutEnv(accessToken);
  const sandboxUrl = mpJson && mpJson.sandbox_init_point ? String(mpJson.sandbox_init_point) : '';
  const prodUrl = mpJson && mpJson.init_point ? String(mpJson.init_point) : '';
  const url = env === 'sandbox' ? (sandboxUrl || prodUrl) : (prodUrl || sandboxUrl);
  return {
    url: url,
    env: env,
    used_sandbox_link: !!url && !!sandboxUrl && url === sandboxUrl,
    warning: mercadoPagoEnvWarning(accessToken)
  };
}

/** BRL com no máximo 2 casas (exigência comum da API do Mercado Pago). */
function toMoney2(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function jsonError(res, status, code, message, extra) {
  const o = { ok: false, code: code, error: message };
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (k) {
      if (extra[k] !== undefined) o[k] = extra[k];
    });
  }
  res.status(status).json(o);
}

/** Log de diagnóstico: ativar com MP_CHECKOUT_DEBUG=1 (nunca loga Authorization nem token MP). */
function logMpCheckoutDiag(label, payload) {
  if (String(process.env.MP_CHECKOUT_DEBUG || '').trim() !== '1') return;
  try {
    console.log('[MP Preference] ' + label, JSON.stringify(payload));
  } catch (e) {
    void e;
  }
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/R\$\s?/gi, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidPayerEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function cleanObject(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) {
    return obj
      .map(cleanObject)
      .filter(function (x) {
        return x !== undefined && x !== null && x !== '';
      });
  }
  if (typeof obj === 'object') {
    const out = {};
    Object.keys(obj).forEach(function (k) {
      const v = cleanObject(obj[k]);
      if (v === undefined || v === null || v === '') return;
      if (typeof v === 'object' && !Array.isArray(v)) {
        if (Object.keys(v).length === 0) return;
      }
      if (Array.isArray(v) && v.length === 0) return;
      out[k] = v;
    });
    return out;
  }
  return obj;
}

/** UUID v4 (aceita qualquer variante de versao 1-8 no terceiro bloco, como PostgREST). */
const ADDRESS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isShippingAddressUuid(s) {
  return ADDRESS_UUID_RE.test(String(s || '').trim());
}

function postgrestErrorMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  if (data.message) return String(data.message);
  if (data.error_description) return String(data.error_description);
  return '';
}

/** Detalhes do PostgREST/Postgres para diagnóstico (sem segredos). */
function postgrestErrorDetails(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {};
  if (data.code != null) out.code = String(data.code);
  if (data.message != null) out.message = String(data.message).slice(0, 800);
  if (data.hint != null) out.hint = String(data.hint).slice(0, 400);
  if (data.details != null) out.details = String(data.details).slice(0, 800);
  return Object.keys(out).length ? out : null;
}


function stringifySafe(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_) {
    return String(value || '');
  }
}

function detectMissingColumn(data) {
  const text = stringifySafe(data);
  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column\s+"([^"]+)"\s+of relation/i,
    /column\s+"([^"]+)"\s+does not exist/i,
    /schema cache.*'([^']+)'/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (m && m[1]) return String(m[1]).trim();
  }
  return '';
}

function detectNotNullColumn(data) {
  const text = stringifySafe(data);
  const patterns = [
    /null value in column\s+"([^"]+)"/i,
    /violates not-null constraint.*column\s+"([^"]+)"/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (m && m[1]) return String(m[1]).trim();
  }
  return '';
}

function valueForCompatibilityColumn(col, row) {
  const c = String(col || '').toLowerCase();
  const qty = parseInt(row.quantity, 10) || 1;
  const unit = toMoney2(row.unit_price != null ? row.unit_price : row.price);
  const total = toMoney2(unit * qty);
  if (c === 'total_price' || c === 'subtotal' || c === 'line_total' || c === 'total') return total;
  if (c === 'price') return unit;
  if (c === 'name' || c === 'title') return row.product_name || row.name || 'Produto';
  if (c === 'payment_method') return 'mercadopago';
  if (c === 'method') return 'mercadopago';
  if (c === 'provider') return 'mercadopago';
  if (c === 'currency' || c === 'currency_id') return 'BRL';
  return undefined;
}

async function restPostSchemaTolerant(cfg, table, row, opts) {
  const protectedKeys = (opts && opts.protectedKeys) || ['order_id'];
  const current = Object.assign({}, row);
  const attempts = [];
  for (let i = 0; i < 14; i++) {
    const r = await restPost(cfg, table, current);
    if (r.ok) {
      return { ok: true, status: r.status, data: r.data, sentKeys: Object.keys(current), attempts: attempts };
    }

    const pg = postgrestErrorDetails(r.data);
    attempts.push({ status: r.status, pg: pg, sentKeys: Object.keys(current) });

    const missing = detectMissingColumn(r.data);
    if (missing && Object.prototype.hasOwnProperty.call(current, missing) && protectedKeys.indexOf(missing) === -1) {
      delete current[missing];
      continue;
    }

    const notNull = detectNotNullColumn(r.data);
    if (notNull && !Object.prototype.hasOwnProperty.call(current, notNull)) {
      const compatValue = valueForCompatibilityColumn(notNull, current);
      if (compatValue !== undefined) {
        current[notNull] = compatValue;
        continue;
      }
    }

    return { ok: false, status: r.status, data: r.data, sentKeys: Object.keys(current), attempts: attempts };
  }
  return { ok: false, status: 0, data: { message: 'schema_tolerant_insert_max_attempts' }, sentKeys: Object.keys(current), attempts: attempts };
}

function makeCheckoutStageError(stage, response, message, extra) {
  const e = new Error(message || stage || 'checkout_stage_failed');
  e.checkoutStage = stage || 'CHECKOUT_STAGE_FAILED';
  e.httpStatus = response && response.status;
  e.pgDetails = postgrestErrorDetails(response && response.data);
  e.sentKeys = response && response.sentKeys;
  e.attempts = response && response.attempts;
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (k) {
      e[k] = extra[k];
    });
  }
  return e;
}

function publicStageErrorMessage(stage) {
  if (stage === 'ORDER_ITEM_INSERT_FAILED') return 'Não foi possível salvar os itens do pedido no banco.';
  if (stage === 'PAYMENT_INSERT_FAILED') return 'Não foi possível criar o registro de pagamento no banco.';
  if (stage === 'MERCADOPAGO_FETCH_FAILED') return 'Não foi possível conectar ao Mercado Pago a partir do servidor.';
  return 'Não foi possível iniciar o pagamento. Tente novamente.';
}

/** Produção na Vercel: nunca usar APP_URL localhost nem HTTP inseguro. */
function isVercelProductionDeploy() {
  return String(process.env.VERCEL || '').trim() === '1';
}

function isLocalhostHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local');
}

/**
 * Base pública para back_urls / notification_url do MP.
 * Em Vercel: exige HTTPS e rejeita localhost vindo de APP_URL.
 */
function resolveMercadoPagoSiteBaseUrl(req) {
  const v = isVercelProductionDeploy();
  const envUrls = [
    String(process.env.APP_URL || '').trim(),
    String(process.env.SITE_URL || '').trim(),
    String(process.env.SITE_PUBLIC_URL || '').trim()
  ];
  for (let i = 0; i < envUrls.length; i++) {
    let raw = envUrls[i].replace(/\/$/, '');
    if (!raw) continue;
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    try {
      const u = new URL(raw);
      if (v && isLocalhostHostname(u.hostname)) continue;
      if (v && u.protocol !== 'https:') continue;
      return u.origin;
    } catch (e) {
      void e;
    }
  }
  const vu = String(process.env.VERCEL_URL || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (vu && v) return 'https://' + vu;
  const fromHeaders = resolvePublicBaseUrl(req);
  if (fromHeaders) {
    try {
      const u = new URL(
        fromHeaders.includes('://') ? fromHeaders : 'https://' + fromHeaders.replace(/\/$/, '')
      );
      if (v && isLocalhostHostname(u.hostname)) return '';
      if (v && u.protocol !== 'https:') return '';
      return u.origin;
    } catch (e2) {
      void e2;
    }
  }
  if (!v) {
    for (let j = 0; j < envUrls.length; j++) {
      let raw2 = envUrls[j].replace(/\/$/, '');
      if (!raw2) continue;
      if (!/^https?:\/\//i.test(raw2)) raw2 = 'http://' + raw2;
      try {
        return new URL(raw2).origin;
      } catch (e3) {
        void e3;
      }
    }
  }
  return '';
}

/**
 * Endereço por id + dono (user_id = auth user). Fallback: busca so por id e confere user_id na linha.
 */
async function fetchShippingAddressRow(cfg, addressId, userId) {
  const aid = encodeURIComponent(String(addressId).trim());
  const uid = encodeURIComponent(String(userId).trim());
  const primary = await restGet(
    cfg,
    '/rest/v1/addresses?id=eq.' + aid + '&user_id=eq.' + uid + '&select=*&limit=1'
  );
  if (primary.ok && Array.isArray(primary.data) && primary.data[0]) {
    return { ok: true, row: primary.data[0] };
  }
  let hint = postgrestErrorMessage(primary.data);
  const fallback = await restGet(cfg, '/rest/v1/addresses?id=eq.' + aid + '&select=*&limit=1');
  if (!fallback.ok || !Array.isArray(fallback.data) || !fallback.data[0]) {
    hint = hint || postgrestErrorMessage(fallback.data);
    return { ok: false, hint: hint };
  }
  const row = fallback.data[0];
  if (String(row.user_id || '').trim() !== String(userId).trim()) {
    return { ok: false, hint: 'Endereço não pertence a esta sessão.' };
  }
  return { ok: true, row: row };
}

function cepDigitsFromAddressRow(addrRow) {
  const raw =
    addrRow.cep != null && String(addrRow.cep).trim() !== ''
      ? addrRow.cep
      : addrRow.zip_code != null && String(addrRow.zip_code).trim() !== ''
        ? addrRow.zip_code
        : addrRow.postal_code != null && String(addrRow.postal_code).trim() !== ''
          ? addrRow.postal_code
          : addrRow.zip != null && String(addrRow.zip).trim() !== ''
            ? addrRow.zip
            : '';
  return normalizeBrazilCepDigits(raw);
}

/**
 * Mescla corpo JSON: Vercel pode preencher req.body; readJsonBody cobre stream / string / objeto.
 */
async function readMergedJsonBody(req) {
  const fromStream = await readJsonBody(req);
  const fromReq = parseBody(req.body);
  const a = fromStream && typeof fromStream === 'object' && !Array.isArray(fromStream) ? fromStream : {};
  const b = fromReq && typeof fromReq === 'object' && !Array.isArray(fromReq) ? fromReq : {};
  return Object.assign({}, b, a);
}

function sanitizeMpError(mpJson) {
  if (!mpJson || typeof mpJson !== 'object') return { message: 'unknown' };
  const out = {
    message: String(mpJson.message || mpJson.error || 'mercadopago_error')
  };
  if (mpJson.status != null) out.http_status = mpJson.status;
  if (Array.isArray(mpJson.cause) && mpJson.cause.length) {
    out.causes = mpJson.cause.slice(0, 8).map(function (c) {
      return {
        code: c && c.code != null ? String(c.code) : undefined,
        description: c && c.description != null ? String(c.description).slice(0, 240) : undefined
      };
    });
  }
  return out;
}

/** area_code + number (sem 55) para payer.phone do MP. */
function brPhoneForMp(digits) {
  let d = String(digits || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return { area_code: d.slice(0, 2), number: d.slice(2) };
  if (d.length === 10) return { area_code: d.slice(0, 2), number: d.slice(2) };
  return null;
}

function normalizeGuestCustomer(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    full_name: String(r.full_name || r.fullName || r.name || '').trim().slice(0, 180),
    email: String(r.email || r.contact_email || r.contactEmail || '').trim().slice(0, 180),
    phone: String(r.phone || r.whatsapp || r.telefone || '').trim().slice(0, 40),
    cpf_cnpj: onlyDigits(r.cpf_cnpj || r.cpfCnpj || r.document || r.cpf || r.cnpj || '').slice(0, 14)
  };
}

function normalizeGuestShippingAddress(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const state = String(r.state || r.uf || '').trim().toUpperCase().slice(0, 2);
  return {
    label: String(r.label || 'Checkout visitante').trim().slice(0, 80) || 'Checkout visitante',
    cep: normalizeBrazilCepDigits(r.cep || r.zip_code || r.zipCode || r.postal_code || r.postalCode || ''),
    street: String(r.street || r.address || r.logradouro || '').trim().slice(0, 180),
    number: String(r.number || r.numero || '').trim().slice(0, 40),
    complement: String(r.complement || r.complemento || '').trim().slice(0, 120),
    neighborhood: String(r.neighborhood || r.bairro || '').trim().slice(0, 120),
    city: String(r.city || r.cidade || '').trim().slice(0, 120),
    state: state
  };
}

function hasUsableGuestShippingAddress(addr) {
  return !!(addr && addr.cep && addr.street && addr.city && addr.state && addr.state.length === 2);
}

async function createAddressFromGuestCheckout(cfg, userId, addr) {
  if (!hasUsableGuestShippingAddress(addr)) return { ok: false };
  const row = {
    user_id: userId,
    label: addr.label || 'Checkout visitante',
    cep: addr.cep,
    zip_code: addr.cep,
    street: addr.street,
    number: addr.number || '',
    complement: addr.complement || '',
    neighborhood: addr.neighborhood || '',
    city: addr.city,
    state: addr.state,
    is_default: false
  };
  const r = await restPostSchemaTolerant(cfg, 'addresses', row, { protectedKeys: ['user_id'] });
  if (r.ok && Array.isArray(r.data) && r.data[0] && r.data[0].id) return { ok: true, id: r.data[0].id, row: r.data[0] };
  return { ok: false, response: r };
}

function normalizeRequestedPaymentMode(body) {
  const raw = String(
    (body && (body.payment_mode || body.paymentMode || body.payment_method || body.paymentMethod || body.method)) ||
      ''
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (raw === 'pix' || raw === 'mercadopago_pix') return 'pix';
  return 'checkout_pro';
}

function pixDataFromMercadoPagoPayment(mpJson) {
  const poi = mpJson && mpJson.point_of_interaction ? mpJson.point_of_interaction : {};
  const td = poi && poi.transaction_data ? poi.transaction_data : {};
  const details = mpJson && mpJson.transaction_details ? mpJson.transaction_details : {};
  return {
    payment_id: mpJson && mpJson.id != null ? String(mpJson.id) : '',
    status: mpJson && mpJson.status != null ? String(mpJson.status) : '',
    status_detail: mpJson && mpJson.status_detail != null ? String(mpJson.status_detail) : '',
    qr_code: td.qr_code != null ? String(td.qr_code) : '',
    qr_code_base64: td.qr_code_base64 != null ? String(td.qr_code_base64) : '',
    ticket_url:
      td.ticket_url != null
        ? String(td.ticket_url)
        : details.external_resource_url != null
          ? String(details.external_resource_url)
          : ''
  };
}

function lineUnitPrice(product, photo) {
  if (!product) return 0;
  const ph = photo || {};
  const pr = product;
  const photoSale = ph.discount_price != null ? parseFloat(ph.discount_price) : null;
  const photoBase = ph.price != null ? parseFloat(ph.price) : null;
  const prodSale = pr.discount_price != null ? parseFloat(pr.discount_price) : null;
  const prodBase = pr.base_price != null ? parseFloat(pr.base_price) : null;
  return (photoSale || photoBase || prodSale || prodBase || 0) || 0;
}

async function fetchFreightAmount(cfg, cepDigits, subtotal) {
  const cepNorm = normalizeBrazilCepDigits(cepDigits);
  if (!cepNorm) return { delivered: false, amount: 0 };
  const rowRes = await restGet(
    cfg,
    '/rest/v1/delivery_cep_rates?cep=eq.' + encodeURIComponent(cepNorm) + '&select=freight_amount&limit=1'
  );
  if (!rowRes.ok) {
    return { delivered: false, amount: 0, freightQueryFailed: true, freightHttpStatus: rowRes.status };
  }
  if (!Array.isArray(rowRes.data) || !rowRes.data[0]) {
    return { delivered: false, amount: 0 };
  }
  let freight = toMoney2(toNumber(rowRes.data[0].freight_amount));
  const freeRes = await restGet(
    cfg,
    '/rest/v1/site_settings?key=eq.delivery_info&select=value&limit=1'
  );
  let freeFrom = 0;
  if (freeRes.ok && Array.isArray(freeRes.data) && freeRes.data[0] && freeRes.data[0].value) {
    try {
      const v = freeRes.data[0].value;
      const di = typeof v === 'string' ? JSON.parse(v) : v;
      freeFrom = toNumber(di.free_from);
    } catch (_) {
      /**/
    }
  }
  if (freeFrom > 0 && subtotal >= freeFrom) freight = 0;
  return { delivered: true, amount: freight };
}

async function deleteOrderCascade(cfg, orderId) {
  await fetch(cfg.base + '/rest/v1/order_items?order_id=eq.' + encodeURIComponent(orderId), {
    method: 'DELETE',
    headers: { apikey: cfg.service, Authorization: 'Bearer ' + cfg.service }
  }).catch(function () {});
  await fetch(cfg.base + '/rest/v1/payments?order_id=eq.' + encodeURIComponent(orderId), {
    method: 'DELETE',
    headers: { apikey: cfg.service, Authorization: 'Bearer ' + cfg.service }
  }).catch(function () {});
  await fetch(cfg.base + '/rest/v1/orders?id=eq.' + encodeURIComponent(orderId), {
    method: 'DELETE',
    headers: { apikey: cfg.service, Authorization: 'Bearer ' + cfg.service }
  }).catch(function () {});
}

function uniqIds(arr) {
  const s = {};
  const out = [];
  (arr || []).forEach(function (id) {
    const k = String(id || '').trim();
    if (!k || s[k]) return;
    s[k] = true;
    out.push(k);
  });
  return out;
}



async function createShadowGuestUser(cfg, guestSessionId, guestCustomer) {
  const localPart = ('guest-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)).toLowerCase();
  const email = localPart + '@guest.conforta.local';
  try {
    const res = await fetch(cfg.base + '/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        apikey: cfg.service,
        Authorization: 'Bearer ' + cfg.service,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        email_confirm: true,
        user_metadata: {
          guest_checkout: true,
          guest_session_id: String(guestSessionId || '').slice(0, 120),
          full_name: String(guestCustomer && guestCustomer.full_name || '').slice(0, 180),
          phone: String(guestCustomer && guestCustomer.phone || '').slice(0, 40),
          contact_email: String(guestCustomer && guestCustomer.email || '').slice(0, 180)
        },
        app_metadata: { provider: 'guest_checkout' }
      })
    });
    const data = await res.json().catch(function () { return null; });
    if (res.ok && data && data.id) return String(data.id);
    logMpCheckoutDiag('shadow_guest_user_failed', { status: res.status, data: data && (data.message || data.error || data.msg) });
  } catch (e) {
    logMpCheckoutDiag('shadow_guest_user_fetch_failed', { message: e && e.message });
  }
  return '';
}

function normalizeClientCartItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.slice(0, 60).map(function (it) {
    const r = it && typeof it === 'object' ? it : {};
    return {
      id: String(r.id || '').slice(0, 120),
      product_id: String(r.product_id || r.productId || r.product || '').trim(),
      photo_id: String(r.photo_id || r.photoId || r.variant_id || r.variantId || '').trim() || null,
      quantity: parseInt(r.quantity || r.qty || 1, 10) || 1
    };
  }).filter(function (it) { return !!it.product_id; });
}

function isUuidLike(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

async function fetchIn(cfg, table, ids, select) {
  if (!ids.length) return {};
  const q = ids.map(function (id) {
    return encodeURIComponent(id);
  }).join(',');
  const path = '/rest/v1/' + table + '?id=in.(' + q + ')&select=' + select;
  const r = await restGet(cfg, path);
  const map = {};
  if (r.ok && Array.isArray(r.data)) {
    r.data.forEach(function (row) {
      map[String(row.id)] = row;
    });
  }
  return map;
}

module.exports = async function handler(req, res) {
  prune();
  applyBrowserCors(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    jsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return;
  }

  const key = rateLimitKey(req, 'mp-pref');
  if (!allow(key, 20, 60000)) {
    jsonError(res, 429, 'RATE_LIMIT', 'Muitas tentativas. Aguarde um minuto.');
    return;
  }

  const cfg = adminConfig();
  const accessToken = resolveMercadoPagoAccessToken();
  const appUrl = resolveMercadoPagoSiteBaseUrl(req);
  if (!cfg.ok || !accessToken || !appUrl) {
    var missing = [];
    if (!cfg.ok) {
      if (!(process.env.SUPABASE_URL || '').trim()) missing.push('SUPABASE_URL');
      if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    if (!accessToken) {
      missing.push('MERCADO_PAGO_ACCESS_TOKEN');
      missing.push('(ou MERCADOPAGO_ACCESS_TOKEN / MP_ACCESS_TOKEN)');
    }
    if (!appUrl) {
      missing.push('APP_URL');
      if (isVercelProductionDeploy()) {
        missing.push('URL pública HTTPS (não localhost na Vercel; use https://seu-dominio ou deixe VERCEL_URL)');
      }
    }
    jsonError(res, 503, 'SERVER_CONFIG', isVercelProductionDeploy()
      ? 'APP_URL precisa ser URL pública HTTPS em produção na Vercel (não use localhost).'
      : 'Pagamento não configurado no servidor.', {
      missing: missing
    });
    return;
  }

  const body = await readMergedJsonBody(req);
  const requestedPaymentMode = normalizeRequestedPaymentMode(body);
  const isPixPaymentMode = requestedPaymentMode === 'pix';
  const guestSessionId = String(body.guest_session_id || body.guestSessionId || '').trim().slice(0, 120);
  const guestCustomer = normalizeGuestCustomer(body.guest_customer || body.guestCustomer || body.customer || {});
  const guestShippingAddress = normalizeGuestShippingAddress(
    body.guest_shipping_address || body.guestShippingAddress || body.shipping_address || body.shippingAddress || {}
  );
  const clientCartRows = normalizeClientCartItems(body.cart_items || body.cartItems || body.items || []);

  const auth = req.headers.authorization || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  const user = jwt ? await verifySupabaseUserJwt(jwt) : null;
  const isGuestCheckout = !user;
  if (!user) {
    if (!guestSessionId || clientCartRows.length === 0) {
      jsonError(res, 401, 'GUEST_CHECKOUT_REQUIRED', 'Não foi possível abrir o Mercado Pago sem a sessão do carrinho.', {
        hint: 'Envie guest_session_id e cart_items no corpo da requisição. E-mail, CPF e endereço não são obrigatórios antes de abrir o Checkout Pro.'
      });
      return;
    }
  }

  logMpCheckoutDiag('request', {
    method: req.method,
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(body),
    paymentMode: requestedPaymentMode,
    hasShippingAddressId: !!String(
      body.shipping_address_id || body.shippingAddressId || body.address_id || ''
    ).trim(),
    hasContactEmailKey: !!String(
      body.contact_email || body.contactEmail || body.customer_email || body.customerEmail || body.email || ''
    ).trim(),
    jwtUserIdLen: user && user.id ? String(user.id).length : 0,
    jwtHasEmail: !!String(user && user.email || '').trim(),
    guestCheckout: isGuestCheckout,
    clientCartRows: clientCartRows.length
  });

  let profileRow = null;
  if (user && user.id) {
    let profResOnce = await restGet(
      cfg,
      '/rest/v1/profiles?id=eq.' +
        encodeURIComponent(user.id) +
        '&select=full_name,cpf_cnpj,email,phone&limit=1'
    );
    if (!profResOnce.ok) {
      profResOnce = await restGet(
        cfg,
        '/rest/v1/profiles?id=eq.' +
          encodeURIComponent(user.id) +
          '&select=full_name,cpf_cnpj,phone&limit=1'
      );
    }
    if (profResOnce.ok && Array.isArray(profResOnce.data) && profResOnce.data[0]) {
      profileRow = profResOnce.data[0];
    }
  }

  const contactEmail = String(
    body.contact_email ||
      body.contactEmail ||
      body.customer_email ||
      body.customerEmail ||
      body.payer_email ||
      guestCustomer.email ||
      ''
  ).trim();
  let payerEmailForMp = String(user && user.email || '').trim();
  if (!payerEmailForMp && profileRow && profileRow.email != null) {
    const pe = String(profileRow.email).trim();
    if (isValidPayerEmail(pe)) payerEmailForMp = pe;
  }
  if (!payerEmailForMp && isValidPayerEmail(contactEmail)) {
    payerEmailForMp = contactEmail;
  }
  if (isPixPaymentMode && !payerEmailForMp) {
    jsonError(res, 400, 'EMAIL_REQUIRED', 'Informe um e-mail válido para gerar Pix direto.', {
      hint:
        'Para o Checkout Pro não é necessário e-mail antes do redirecionamento; para Pix direto via API, Mercado Pago exige payer.email.'
    });
    return;
  }

  let checkoutUserId = user && user.id ? String(user.id) : '';

  let shippingAddressId = String(
    body.shipping_address_id || body.shippingAddressId || body.address_id || body.addressId || ''
  ).trim();
  const hasGuestAddress = hasUsableGuestShippingAddress(guestShippingAddress);
  const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotency_key || '')
    .trim()
    .slice(0, 128);

  if (isPixPaymentMode && !shippingAddressId && !hasGuestAddress) {
    jsonError(res, 400, 'NO_SHIPPING_ADDRESS', 'Informe o endereço de entrega no checkout.', {
      hint: 'Pix direto na loja precisa de endereço para calcular entrega. No Checkout Pro, endereço/e-mail podem ser preenchidos no Mercado Pago.'
    });
    return;
  }
  if (shippingAddressId && !isShippingAddressUuid(shippingAddressId)) {
    jsonError(res, 400, 'NO_SHIPPING_ADDRESS', 'ID do endereço inválido. Atualize a página e selecione o endereço de entrega novamente.', {
      hint: 'shipping_address_id deve ser um UUID do endereço no Supabase.'
    });
    return;
  }
  if (!user && shippingAddressId) {
    shippingAddressId = '';
  }

  if (idempotencyKey) {
    const prevPay = await restGet(
      cfg,
      '/rest/v1/payments?idempotency_key=eq.' +
        encodeURIComponent(idempotencyKey) +
        '&select=order_id,provider_preference_id,raw_provider_payload,status&limit=1'
    );
    if (prevPay.ok && Array.isArray(prevPay.data) && prevPay.data[0]) {
      const row = prevPay.data[0];
      const oid = row.order_id;
      const raw = row.raw_provider_payload || {};
      const guestMatches = !user && guestSessionId && String(raw.guest_session_id || '') === String(guestSessionId);
      let ordChk = null;
      if (user) {
        ordChk = await restGet(
          cfg,
          '/rest/v1/orders?id=eq.' +
            encodeURIComponent(oid) +
            '&user_id=eq.' +
            encodeURIComponent(user.id) +
            '&select=id,order_number,payment_status&limit=1'
        );
      } else if (guestMatches) {
        ordChk = await restGet(
          cfg,
          '/rest/v1/orders?id=eq.' +
            encodeURIComponent(oid) +
            '&select=id,order_number,payment_status&limit=1'
        );
      }
      if (ordChk && ordChk.ok && Array.isArray(ordChk.data) && ordChk.data[0]) {
        const rawPaymentMode = String(raw.payment_mode || '').toLowerCase();
        if (
          rawPaymentMode === 'pix' &&
          raw.payment_id &&
          String(ordChk.data[0].payment_status || '') !== 'paid' &&
          (raw.qr_code || raw.qr_code_base64 || raw.ticket_url)
        ) {
          res.status(200).json({
            ok: true,
            payment_mode: 'pix',
            order_id: oid,
            order_number: ordChk.data[0].order_number,
            payment_id: raw.payment_id,
            status: raw.status || 'pending',
            status_detail: raw.status_detail || null,
            qr_code: raw.qr_code || null,
            qr_code_base64: raw.qr_code_base64 || null,
            ticket_url: raw.ticket_url || null,
            reused: true
          });
          return;
        }
        const prefId = row.provider_preference_id || raw.preference_id;
        const pickedReuse = pickMercadoPagoCheckoutUrl(raw, accessToken);
        const initPoint = pickedReuse.url;
        if (initPoint && prefId && String(ordChk.data[0].payment_status || '') !== 'paid') {
          res.status(200).json({
            ok: true,
            payment_mode: 'checkout_pro',
            checkout_url: initPoint,
            init_point: initPoint,
            sandbox_init_point: raw.sandbox_init_point || null,
            production_init_point: raw.init_point || null,
            checkout_environment: pickedReuse.env,
            used_sandbox_link: pickedReuse.used_sandbox_link,
            env_warning: pickedReuse.warning || undefined,
            preference_id: prefId,
            order_id: oid,
            order_number: ordChk.data[0].order_number,
            reused: true
          });
          return;
        }
      }
    }
  }

  let rawRows = [];
  if (user) {
    const cartQ = await restGet(
      cfg,
      '/rest/v1/carts?user_id=eq.' + encodeURIComponent(user.id) + '&select=id&limit=1'
    );
    if (cartQ.ok && Array.isArray(cartQ.data) && cartQ.data[0]) {
      const cartId = cartQ.data[0].id;
      const itemsRes = await restGet(
        cfg,
        '/rest/v1/cart_items?cart_id=eq.' + encodeURIComponent(cartId) + '&select=id,product_id,photo_id,quantity'
      );
      if (itemsRes.ok && Array.isArray(itemsRes.data) && itemsRes.data.length > 0) {
        rawRows = itemsRes.data;
      }
    }
  }
  if (!rawRows.length && clientCartRows.length) {
    rawRows = clientCartRows;
  }
  if (!rawRows.length) {
    jsonError(res, 400, 'CART_EMPTY', 'Carrinho vazio.', {
      hint: user ? 'Adicione itens ao carrinho.' : 'Envie cart_items no checkout visitante.'
    });
    return;
  }
  const prodIds = uniqIds(rawRows.map(function (r) {
    return r.product_id;
  }));
  const photoIds = uniqIds(
    rawRows.map(function (r) {
      return r.photo_id;
    }).filter(Boolean)
  );

  const prodMap = await fetchIn(cfg, 'products', prodIds, 'id,name,active,base_price,discount_price,stock');
  const photoMap = await fetchIn(
    cfg,
    'product_photos',
    photoIds,
    'id,price,discount_price,stock_override,is_video'
  );

  const lines = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const qty = parseInt(row.quantity, 10) || 0;
    if (qty < 1 || qty > 99) {
      jsonError(res, 400, 'INVALID_CART_QTY', 'Quantidade inválida em um item do carrinho.');
      return;
    }
    const prod = prodMap[String(row.product_id)] || null;
    const photo = row.photo_id ? photoMap[String(row.photo_id)] || null : null;
    if (!prod || prod.active === false) {
      jsonError(
        res,
        400,
        'PRODUCT_UNAVAILABLE',
        'Produto indisponível: ' + (prod && prod.name ? String(prod.name) : 'item')
      );
      return;
    }
    if (photo && photo.is_video) {
      jsonError(res, 400, 'INVALID_CART_ITEM', 'Item inválido no carrinho.');
      return;
    }
    const unit = toMoney2(lineUnitPrice(prod, photo));
    if (unit <= 0) {
      jsonError(res, 400, 'INVALID_PRICE', 'Preço inválido no servidor.');
      return;
    }
    const stock = prod.stock != null ? parseInt(prod.stock, 10) : null;
    const so = photo && photo.stock_override != null ? parseInt(photo.stock_override, 10) : null;
    const effStock = so != null && !isNaN(so) ? so : stock;
    if (effStock != null && !isNaN(effStock) && effStock < qty) {
      jsonError(res, 400, 'OUT_OF_STOCK', 'Estoque insuficiente para: ' + String(prod.name || 'produto'));
      return;
    }
    lines.push({
      product_id: prod.id,
      photo_id: photo ? photo.id : null,
      name: String(prod.name || 'Produto').slice(0, 250),
      quantity: qty,
      unit_price: unit
    });
  }

  let cep = '';
  let checkoutAddressRow = null;
  let usingGuestShippingAddress = false;
  if (shippingAddressId && user) {
    const addrRes = await fetchShippingAddressRow(cfg, shippingAddressId, user.id);
    if (!addrRes.ok || !addrRes.row) {
      jsonError(res, 400, 'INVALID_SHIPPING_ADDRESS', 'Endereço de entrega inválido.', {
        hint: addrRes.hint || 'Salve o endereço novamente no checkout ou confira se está logado na mesma conta.'
      });
      return;
    }
    checkoutAddressRow = addrRes.row;
    cep = cepDigitsFromAddressRow(addrRes.row);
  } else if (hasGuestAddress) {
    usingGuestShippingAddress = true;
    checkoutAddressRow = guestShippingAddress;
    cep = guestShippingAddress.cep;
  }
  if (isPixPaymentMode && !cep) {
    jsonError(res, 400, 'INVALID_ADDRESS_CEP', 'CEP inválido no endereço selecionado.');
    return;
  }

  const subtotal = toMoney2(
    lines.reduce(function (a, l) {
      return a + l.unit_price * l.quantity;
    }, 0)
  );
  let shipping = 0;
  if (cep) {
    const fr = await fetchFreightAmount(cfg, cep, subtotal);
    if (fr.freightQueryFailed) {
      jsonError(res, 503, 'FREIGHT_DB_ERROR', 'Não foi possível consultar o frete no servidor. Tente novamente.', {
        hint: 'Verifique Supabase (service role) e a tabela delivery_cep_rates.',
        status: fr.freightHttpStatus
      });
      return;
    }
    if (!fr.delivered) {
      jsonError(res, 400, 'CEP_OUT_OF_DELIVERY_AREA', 'CEP fora da área de entrega.', {
        hint: 'Cadastre o CEP em delivery_cep_rates no painel (CEP / Frete).'
      });
      return;
    }
    shipping = toMoney2(fr.delivered ? fr.amount : 0);
  }
  const total = toMoney2(subtotal + shipping);

  if (user && !shippingAddressId && usingGuestShippingAddress) {
    const createdAddr = await createAddressFromGuestCheckout(cfg, user.id, guestShippingAddress);
    if (createdAddr.ok && createdAddr.id) {
      shippingAddressId = String(createdAddr.id);
      checkoutAddressRow = createdAddr.row || checkoutAddressRow;
    } else {
      logMpCheckoutDiag('guest_address_insert_failed_non_blocking', {
        status: createdAddr.response && createdAddr.response.status,
        attempts: createdAddr.response && createdAddr.response.attempts
      });
    }
  }

  const orderNumber = 'CF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

  /* Colunas curtas: muitos schemas usam varchar curto em payment_method; "mercadopago_checkout_pro" estoura varchar(20). */
  const paymentMethod = isPixPaymentMode
    ? 'mercadopago_pix'
    : String(process.env.MP_ORDER_PAYMENT_METHOD || 'mercadopago').trim() || 'mercadopago';

  const orderRow = {
    user_id: checkoutUserId || null,
    order_number: orderNumber,
    status: 'pending',
    payment_status: 'pending',
    payment_method: paymentMethod,
    total_amount: total,
    shipping_amount: shipping,
    discount_amount: 0,
    shipping_address_id: shippingAddressId || null,
    guest_session_id: guestSessionId || null,
    guest_customer: cleanObject(guestCustomer),
    guest_shipping_address: cleanObject(guestShippingAddress)
  };

  let insOrder = await restPostSchemaTolerant(cfg, 'orders', orderRow, { protectedKeys: ['order_number', 'status', 'payment_status', 'payment_method', 'total_amount'] });
  if ((!insOrder.ok || !Array.isArray(insOrder.data) || !insOrder.data[0]) && !user && !checkoutUserId) {
    const pgFirst = postgrestErrorDetails(insOrder.data);
    logMpCheckoutDiag('orders_insert_guest_null_failed_try_shadow_user', {
      http_status: insOrder.status,
      pg: pgFirst
    });
    checkoutUserId = await createShadowGuestUser(cfg, guestSessionId, guestCustomer);
    if (checkoutUserId) {
      orderRow.user_id = checkoutUserId;
      insOrder = await restPostSchemaTolerant(cfg, 'orders', orderRow, { protectedKeys: ['order_number', 'status', 'payment_status', 'payment_method', 'total_amount'] });
    }
  }
  if (!insOrder.ok || !Array.isArray(insOrder.data) || !insOrder.data[0]) {
    const pg = postgrestErrorDetails(insOrder.data);
    logMpCheckoutDiag('orders_insert_failed', {
      http_status: insOrder.status,
      pg: pg,
      order_keys: Object.keys(orderRow)
    });
    console.error(
      '[mercadopago-create-preference] orders insert failed',
      insOrder.status,
      JSON.stringify(insOrder.data || {})
    );
    res.status(500).json({
      ok: false,
      code: 'ORDER_INSERT_FAILED',
      error: 'Não foi possível criar o pedido.',
      hint: !user ? 'A compra sem login tentou salvar o pedido como visitante. Se o Supabase bloquear user_id nulo, rode database/guest_checkout_no_login.sql ou permita a criação técnica de visitante.' : undefined,
      pg: pg || undefined,
      http_status: insOrder.status
    });
    return;
  }
  const order = insOrder.data[0];
  const orderId = order.id;

  try {
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      const lineTotal = toMoney2(l.unit_price * l.quantity);
      const it = {
        order_id: orderId,
        product_id: l.product_id,
        photo_id: l.photo_id,
        product_name: l.name,
        photo_url: null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        color_name: null,
        total_price: lineTotal,
        subtotal: lineTotal,
        line_total: lineTotal,
        price: l.unit_price
      };
      const ir = await restPostSchemaTolerant(cfg, 'order_items', it, {
        protectedKeys: ['order_id']
      });
      if (!ir.ok) {
        throw makeCheckoutStageError('ORDER_ITEM_INSERT_FAILED', ir, 'order_items');
      }
    }

    const payIns = await restPostSchemaTolerant(
      cfg,
      'payments',
      {
        order_id: orderId,
        provider: 'mercadopago',
        payment_method: isPixPaymentMode ? 'pix' : 'mercadopago',
        method: isPixPaymentMode ? 'pix' : 'mercadopago',
        status: 'pending',
        amount: total,
        currency: 'BRL',
        external_reference: orderId,
        idempotency_key: idempotencyKey || null,
        raw_provider_payload: {
          guest_checkout: guestSessionId ? true : false,
          guest_session_id: guestSessionId || null,
          guest_customer: cleanObject(guestCustomer),
          guest_shipping_address: cleanObject(guestShippingAddress)
        }
      },
      { protectedKeys: ['order_id'] }
    );
    if (!payIns.ok) {
      throw makeCheckoutStageError('PAYMENT_INSERT_FAILED', payIns, 'payments');
    }

    const fullName = String(
      (profileRow && profileRow.full_name) || guestCustomer.full_name || (user && user.email) || payerEmailForMp || 'Cliente'
    ).trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'Cliente';
    const surname = nameParts.length > 1 ? nameParts.slice(1).join(' ').slice(0, 60) : firstName;
    const docDigits = onlyDigits((profileRow && profileRow.cpf_cnpj) || guestCustomer.cpf_cnpj || '').slice(0, 14);
    const payer = {
      first_name: firstName.slice(0, 50),
      surname: surname.slice(0, 60)
    };
    if (payerEmailForMp) payer.email = payerEmailForMp;
    const phoneMp = brPhoneForMp((user && user.phone) || (profileRow && profileRow.phone) || guestCustomer.phone);
    if (phoneMp) payer.phone = { area_code: phoneMp.area_code, number: phoneMp.number };
    if (docDigits.length === 11) {
      payer.identification = { type: 'CPF', number: docDigits };
    } else if (docDigits.length === 14) {
      payer.identification = { type: 'CNPJ', number: docDigits };
    }

    const mpItems = lines.map(function (l) {
      const title = String(l.name || 'Produto').trim().slice(0, 127) || 'Produto';
      return {
        id: String(l.product_id),
        title: title,
        quantity: Math.max(1, parseInt(l.quantity, 10) || 1),
        currency_id: 'BRL',
        unit_price: Number(toMoney2(l.unit_price))
      };
    });
    const shipLine = toMoney2(shipping);
    if (shipLine > 0) {
      mpItems.push({
        id: 'shipping',
        title: 'Frete',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Number(shipLine)
      });
    }

    const mpItemsSafe = mpItems.filter(function (it) {
      const q = parseInt(it.quantity, 10) || 0;
      const p = Number(it.unit_price);
      return (
        String(it.title || '').trim().length > 0 &&
        String(it.currency_id || '') === 'BRL' &&
        q > 0 &&
        q <= 999999 &&
        Number.isFinite(p) &&
        p > 0
      );
    });
    if (mpItemsSafe.length === 0) {
      const ve = new Error('invalid_mp_items');
      ve.clientValidation = true;
      throw ve;
    }

    const idem = idempotencyKey || orderId;
    const statement = String(process.env.MERCADO_PAGO_STATEMENT_DESCRIPTOR || 'CONFORTA').slice(0, 22);
    let maxInst = parseInt(process.env.MERCADO_PAGO_MAX_INSTALLMENTS || '12', 10);
    if (!isFinite(maxInst) || maxInst < 1) maxInst = 12;
    maxInst = Math.min(12, Math.max(1, maxInst));

    if (isPixPaymentMode) {
      const pixPayer = cleanObject({
        email: payer.email,
        first_name: payer.first_name,
        last_name: payer.surname,
        identification: payer.identification,
        phone: payer.phone
      });
      const pixBody = cleanObject({
        transaction_amount: Number(toMoney2(total)),
        description: ('Pedido ' + orderNumber + ' - Conforta Colchoes').slice(0, 255),
        payment_method_id: 'pix',
        payer: pixPayer,
        external_reference: orderId,
        notification_url: appUrl + '/api/mercadopago-webhook?source_news=webhooks',
        callback_url: appUrl + '/checkout-retorno.html?order_id=' + encodeURIComponent(orderId) + '&status=pending',
        statement_descriptor: statement,
        additional_info: {
          items: mpItemsSafe.map(function (it) {
            return {
              id: it.id,
              title: it.title,
              quantity: it.quantity,
              unit_price: it.unit_price
            };
          })
        },
        metadata: cleanObject({ order_id: orderId, order_number: orderNumber, user_id: checkoutUserId || (user && user.id), payment_mode: 'pix', guest_session_id: guestSessionId || undefined })
      });

      logMpCheckoutDiag('outgoing_pix_payment', {
        itemCount: mpItemsSafe.length,
        total: total,
        payerHasEmail: !!pixPayer.email,
        payerHasId: !!pixPayer.identification
      });

      let pixRes;
      try {
        pixRes = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idem + '-pix'
          },
          body: JSON.stringify(pixBody)
        });
      } catch (fetchErr) {
        console.error(
          '[mercadopago-create-preference] fetch MP pix failed',
          fetchErr && fetchErr.message ? fetchErr.message : fetchErr
        );
        throw makeCheckoutStageError('MERCADOPAGO_FETCH_FAILED', null, 'mercadopago_pix_fetch_failed', {
          networkMessage: fetchErr && fetchErr.message ? String(fetchErr.message).slice(0, 300) : undefined
        });
      }

      const pixJson = await pixRes.json().catch(function () {
        return {};
      });
      if (!pixRes.ok) {
        const details = sanitizeMpError(pixJson);
        console.error('[mercadopago-create-preference] MP pix HTTP', pixRes.status, JSON.stringify(details));
        const mpErr = new Error('mp_pix_http');
        mpErr.mpDetails = details;
        mpErr.mpHttpStatus = pixRes.status;
        throw mpErr;
      }

      const pixData = pixDataFromMercadoPagoPayment(pixJson);
      if (!pixData.payment_id || (!pixData.qr_code && !pixData.qr_code_base64 && !pixData.ticket_url)) {
        console.error('[mercadopago-create-preference] MP pix missing qr', JSON.stringify(sanitizeMpError(pixJson)));
        const mpErr = new Error('mp_pix_qr_missing');
        mpErr.mpDetails = { message: 'Mercado Pago não retornou QR Code Pix.' };
        mpErr.mpHttpStatus = pixRes.status;
        throw mpErr;
      }

      const pixRawForDb = {
        payment_mode: 'pix',
        payment_id: pixData.payment_id,
        status: pixData.status || null,
        status_detail: pixData.status_detail || null,
        qr_code: pixData.qr_code || null,
        qr_code_base64: pixData.qr_code_base64 || null,
        ticket_url: pixData.ticket_url || null,
        provider_payload: pixJson,
        guest_checkout: guestSessionId ? true : false,
        guest_session_id: guestSessionId || null,
        guest_customer: cleanObject(guestCustomer),
        guest_shipping_address: cleanObject(guestShippingAddress)
      };

      await fetch(cfg.base + '/rest/v1/payments?order_id=eq.' + encodeURIComponent(orderId), {
        method: 'PATCH',
        headers: {
          apikey: cfg.service,
          Authorization: 'Bearer ' + cfg.service,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          provider_payment_id: pixData.payment_id,
          provider_status: pixData.status || null,
          provider_status_detail: pixData.status_detail || null,
          status: 'pending',
          raw_provider_payload: pixRawForDb
        })
      }).catch(function () {});

      res.status(200).json({
        ok: true,
        payment_mode: 'pix',
        order_id: orderId,
        order_number: orderNumber,
        payment_id: pixData.payment_id,
        status: pixData.status || 'pending',
        status_detail: pixData.status_detail || null,
        qr_code: pixData.qr_code || null,
        qr_code_base64: pixData.qr_code_base64 || null,
        ticket_url: pixData.ticket_url || null
      });
      return;
    }

    const sendShipmentsToMercadoPago = String(process.env.MERCADO_PAGO_SEND_SHIPMENTS || 'false').toLowerCase() === 'true';

    const prefBody = cleanObject({
      items: mpItemsSafe,
      payer: payer,
      back_urls: {
        success: appUrl + '/checkout-retorno.html?order_id=' + encodeURIComponent(orderId) + '&status=success',
        failure: appUrl + '/checkout-retorno.html?order_id=' + encodeURIComponent(orderId) + '&status=failure',
        pending: appUrl + '/checkout-retorno.html?order_id=' + encodeURIComponent(orderId) + '&status=pending'
      },
      auto_return: 'approved',
      notification_url: appUrl + '/api/mercadopago-webhook?source_news=webhooks',
      external_reference: orderId,
      statement_descriptor: statement,
      payment_methods: {
        installments: maxInst,
        default_payment_method_id:
          String(process.env.MERCADO_PAGO_DEFAULT_PAYMENT_METHOD_ID || '').trim() || undefined
      },
      shipments: sendShipmentsToMercadoPago && cep
        ? cleanObject({
            cost: Number(toMoney2(shipping)),
            free_shipping: toMoney2(shipping) <= 0,
            receiver_address: {
              zip_code: cep,
              street_name: checkoutAddressRow && (checkoutAddressRow.street || checkoutAddressRow.address || checkoutAddressRow.logradouro),
              street_number: checkoutAddressRow && (checkoutAddressRow.number || checkoutAddressRow.numero),
              city_name: checkoutAddressRow && (checkoutAddressRow.city || checkoutAddressRow.cidade),
              state_name: checkoutAddressRow && (checkoutAddressRow.state || checkoutAddressRow.uf),
              country_name: 'Brasil'
            }
          })
        : undefined,
      metadata: cleanObject({ order_id: orderId, order_number: orderNumber, user_id: checkoutUserId || (user && user.id), guest_session_id: guestSessionId || undefined, checkout_without_store_login: !user || undefined, shipping_collected_in_mp: !cep || undefined })
    });

    logMpCheckoutDiag('outgoing_preference', {
      itemCount: mpItemsSafe.length,
      subtotal: subtotal,
      shipping: shipping,
      total: total,
      payerHasEmail: !!payer.email,
      payerHasPhone: !!payer.phone,
      payerHasId: !!payer.identification,
      checkoutEnv: resolveMercadoPagoCheckoutEnv(accessToken),
      envWarning: mercadoPagoEnvWarning(accessToken) || undefined,
      shipmentsSentToMercadoPago: sendShipmentsToMercadoPago && !!cep,
      backUrlHost: (function () {
        try {
          return new URL(appUrl).host;
        } catch (e) {
          void e;
          return '';
        }
      })()
    });

    let mpRes;
    try {
      mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idem
        },
        body: JSON.stringify(prefBody)
      });
    } catch (fetchErr) {
      console.error(
        '[mercadopago-create-preference] fetch MP failed',
        fetchErr && fetchErr.message ? fetchErr.message : fetchErr
      );
      throw makeCheckoutStageError('MERCADOPAGO_FETCH_FAILED', null, 'mercadopago_fetch_failed', {
        networkMessage: fetchErr && fetchErr.message ? String(fetchErr.message).slice(0, 300) : undefined
      });
    }
    const mpJson = await mpRes.json().catch(function () {
      return {};
    });
    if (!mpRes.ok) {
      const details = sanitizeMpError(mpJson);
      console.error('[mercadopago-create-preference] MP preference HTTP', mpRes.status, JSON.stringify(details));
      const mpErr = new Error('mp_preference_http');
      mpErr.mpDetails = details;
      mpErr.mpHttpStatus = mpRes.status;
      throw mpErr;
    }

    const pickedCheckout = pickMercadoPagoCheckoutUrl(mpJson, accessToken);
    const initPoint = pickedCheckout.url;
    const prefId = mpJson.id;
    if (!initPoint || !prefId) {
      const details = sanitizeMpError(mpJson);
      console.error('[mercadopago-create-preference] MP missing init_point', JSON.stringify(details));
      const mpErr = new Error('init_point_missing');
      mpErr.mpDetails = details;
      throw mpErr;
    }

    await fetch(cfg.base + '/rest/v1/payments?order_id=eq.' + encodeURIComponent(orderId), {
      method: 'PATCH',
      headers: {
        apikey: cfg.service,
        Authorization: 'Bearer ' + cfg.service,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        provider_preference_id: prefId,
        raw_provider_payload: {
          preference_id: prefId,
          init_point: mpJson.init_point || null,
          sandbox_init_point: mpJson.sandbox_init_point || null,
          checkout_url: initPoint || null,
          checkout_environment: pickedCheckout.env,
          used_sandbox_link: pickedCheckout.used_sandbox_link,
          env_warning: pickedCheckout.warning || null,
          guest_checkout: guestSessionId ? true : false,
          guest_session_id: guestSessionId || null,
          guest_customer: cleanObject(guestCustomer),
          guest_shipping_address: cleanObject(guestShippingAddress)
        }
      })
    }).catch(function () {});

    res.status(200).json({
      ok: true,
      payment_mode: 'checkout_pro',
      checkout_url: initPoint,
      init_point: initPoint,
      sandbox_init_point: mpJson.sandbox_init_point || null,
      production_init_point: mpJson.init_point || null,
      checkout_environment: pickedCheckout.env,
      used_sandbox_link: pickedCheckout.used_sandbox_link,
      env_warning: pickedCheckout.warning || undefined,
      preference_id: prefId,
      order_id: orderId,
      order_number: orderNumber
    });
  } catch (err) {
    await deleteOrderCascade(cfg, orderId);
    if (err && err.clientValidation) {
      jsonError(res, 400, 'INVALID_MP_ITEMS', 'Não foi possível montar itens válidos para o Mercado Pago.', {
        hint: 'Verifique preços e nomes dos produtos no painel.'
      });
      return;
    }
    if (err && err.mpDetails) {
      res.status(502).json({
        ok: false,
        code: 'MERCADOPAGO_API_ERROR',
        error: 'Falha ao criar pagamento no Mercado Pago. Tente novamente.',
        details: err.mpDetails,
        mp_http_status: err.mpHttpStatus != null ? err.mpHttpStatus : undefined
      });
      return;
    }
    if (err && err.checkoutStage) {
      console.error(
        '[mercadopago-create-preference] stage failed',
        err.checkoutStage,
        err.httpStatus || '',
        JSON.stringify(err.pgDetails || {}),
        err.networkMessage || ''
      );
      res.status(502).json({
        ok: false,
        code: err.checkoutStage,
        stage: err.checkoutStage,
        error: publicStageErrorMessage(err.checkoutStage),
        pg: err.pgDetails || undefined,
        http_status: err.httpStatus != null ? err.httpStatus : undefined,
        sent_keys: err.sentKeys || undefined,
        hint:
          err.checkoutStage === 'ORDER_ITEM_INSERT_FAILED' || err.checkoutStage === 'PAYMENT_INSERT_FAILED'
            ? 'Compare as colunas do Supabase com o payload retornado em sent_keys/pg. Execute as migrations em database/ antes de testar pagamento.'
            : undefined
      });
      return;
    }
    console.error('[mercadopago-create-preference]', err && err.message ? err.message : err);
    res.status(502).json({
      ok: false,
      code: 'CHECKOUT_FAILED',
      stage: err && err.message ? String(err.message).slice(0, 80) : 'unknown',
      error: 'Não foi possível iniciar o pagamento. Tente novamente.'
    });
  }
};
