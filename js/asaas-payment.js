// LEGACY — não referenciar em páginas HTML. Gateway Asaas desativado (APIs /api/asaas-* retornam 410).
// Pagamento ativo: Mercado Pago via /api/mercadopago-create-preference.js
// Conforta Store - Asaas Payment Integration (via Vercel Proxy)

const ASAAS_PROXY_URLS = ['/api/asaas-proxy', '/api/asaas-proxy.js'];

const MSG_PAYMENT_UNAVAILABLE = 'Pagamento online indisponível no momento. Tente mais tarde ou fale com a loja.';

function extractAsaasProxyMessage(result) {
  if (!result || typeof result !== 'object') return 'Erro na requisicao';
  if (typeof result.message === 'string' && result.message.trim()) return result.message.trim();
  if (typeof result.error === 'string' && result.error.trim()) return result.error.trim();
  if (result.error && typeof result.error.message === 'string') return result.error.message;
  if (Array.isArray(result.errors) && result.errors.length) {
    return result.errors
      .map(function (e) {
        return (e && (e.description || e.code)) || '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return 'Erro na requisicao';
}

async function probeAsaasProxyUrl(url) {
  const r = await fetch(url, { method: 'GET' });
  if (r.status === 404) return { ok: false, configured: false, notFound: true };
  const ct = r.headers.get('content-type') || '';
  if (r.status === 401 && !ct.includes('application/json')) {
    return { ok: false, configured: false, vercelAuth: true };
  }
  if (!ct.includes('application/json')) return { ok: false, configured: false };
  const meta = await r.json().catch(function () { return {}; });
  return { ok: r.ok, configured: !!meta.configured };
}

function warnVercelPreviewAuth() {
  var hint =
    'Este link de preview da Vercel exige login (Deployment Protection) e bloqueia /api/*. Teste no dominio de producao (ex.: confortacolchoes.vercel.app) ou desative em Vercel → Settings → Deployment Protection.';
  logPaymentDev(hint, null);
  if (typeof showToast === 'function') showToast(hint, 'error');
  if (typeof window !== 'undefined') window.__confortaAsaasApiHint = hint;
}

function warnAsaasProxyNotFound() {
  var hint =
    'Rota /api/asaas-proxy nao encontrada. Local: pare o servidor e rode "npm run dev" (nao use Live Server nem npm run dev:static). Producao: deploy na Vercel com a pasta api/ e ASAAS_API_KEY.';
  logPaymentDev(hint, null);
  if (typeof showToast === 'function') showToast(hint, 'error');
  if (typeof window !== 'undefined') window.__confortaAsaasApiHint = hint;
}

/** Alinha com o proxy: sandbox | production (evita URL errada e 401 por ambiente). */
function normalizeAsaasEnv(raw) {
  if (raw == null || raw === '') return 'sandbox';
  var s = String(raw).trim();
  if ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') || (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")) {
    s = s.slice(1, -1).trim();
  }
  s = s.toLowerCase();
  if (s === 'production' || s === 'prod') return 'production';
  return 'sandbox';
}

function logPaymentDev(reason, detail) {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  if (detail === undefined || detail === null || detail === '') {
    console.warn('[Conforta/Asaas]', reason || '');
  } else {
    console.warn('[Conforta/Asaas]', reason || '', detail);
  }
}

/** Detecta se o proxy serverless do Asaas esta disponivel (Vercel) e configurado. */
/** Alias usado no checkout.html */
async function isAsaasPaymentApiAvailable() {
  return isAsaasProxyAvailable();
}

async function isAsaasProxyAvailable() {
  if (window.__asaasProxyAvailable !== undefined) return window.__asaasProxyAvailable;
  window.__asaasProxyUrl = ASAAS_PROXY_URLS[0];
  try {
    var saw404 = false;
    var sawVercelAuth = false;
    for (var i = 0; i < ASAAS_PROXY_URLS.length; i++) {
      var probe = await probeAsaasProxyUrl(ASAAS_PROXY_URLS[i]);
      if (probe.notFound) saw404 = true;
      if (probe.vercelAuth) sawVercelAuth = true;
      if (probe.ok) {
        window.__asaasProxyUrl = ASAAS_PROXY_URLS[i];
        window.__asaasProxyAvailable = probe.configured;
        return window.__asaasProxyAvailable;
      }
    }
    if (sawVercelAuth) warnVercelPreviewAuth();
    else if (saw404) warnAsaasProxyNotFound();
    window.__asaasProxyAvailable = false;
  } catch {
    window.__asaasProxyAvailable = false;
  }
  return window.__asaasProxyAvailable;
}

async function initAsaasPayment(orderData) {
  const env = normalizeAsaasEnv(await getSetting('asaas_environment'));
  const available = await isAsaasProxyAvailable();
  if (!available) {
    logPaymentDev('initAsaasPayment: proxy nao configurado (defina ASAAS_API_KEY na Vercel)', null);
    return null;
  }
  return {
    url: null,
    customer: null,
    config: { environment: env }
  };
}

async function callAsaasProxy(endpoint, method, body) {
  const env = normalizeAsaasEnv(await getSetting('asaas_environment'));
  const available = await isAsaasProxyAvailable();
  if (!available) {
    logPaymentDev('Proxy de pagamento nao configurado (defina ASAAS_API_KEY na Vercel)', window.__asaasProxyUrl || ASAAS_PROXY_URLS[0]);
    return null;
  }
  const payload = JSON.stringify({
    endpoint: endpoint,
    method: method,
    body: body || null,
    environment: env
  });
  const urls = [window.__asaasProxyUrl || ASAAS_PROXY_URLS[0]].concat(
    ASAAS_PROXY_URLS.filter(function (u) { return u !== (window.__asaasProxyUrl || ASAAS_PROXY_URLS[0]); })
  );

  var lastErr = null;
  for (var u = 0; u < urls.length; u++) {
    try {
      const res = await fetch(urls[u], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        if (res.status === 404) {
          if (u < urls.length - 1) continue;
          warnAsaasProxyNotFound();
          throw new Error('gateway');
        }
        logPaymentDev('Resposta nao-JSON do proxy', ct);
        throw new Error('gateway');
      }
      const result = await res.json();
      if (res.status === 404 && !Array.isArray(result.errors) && u < urls.length - 1) continue;

      if (!res.ok) {
        const msg = extractAsaasProxyMessage(result);
        if (typeof window !== 'undefined') window.__asaasLastHttpStatus = res.status;
        if (res.status === 404) {
          showToast(
            'Asaas nao encontrou o cliente ou a cobranca. Se voce mudou sandbox/producao no admin, tente de novo (o cadastro sera atualizado).',
            'error'
          );
        } else if (res.status === 401 || res.status === 403) {
          showToast(
            'Asaas recusou a chave. Na Vercel use ASAAS_API_KEY ou ASAAS_API_KEY_SANDBOX / ASAAS_API_KEY_PRODUCTION e o mesmo ambiente no admin.',
            'error'
          );
        } else if (res.status === 400 && /cpf|cnpj|documento/i.test(msg)) {
          showToast('CPF/CNPJ invalido ou ausente. Atualize em Meu perfil e tente de novo.', 'error');
        } else {
          showToast(MSG_PAYMENT_UNAVAILABLE, 'error');
        }
        throw new Error('HTTP ' + res.status + ': ' + msg);
      }
      window.__asaasProxyUrl = urls[u];
      if (typeof window !== 'undefined') window.__asaasLastHttpStatus = 0;
      return result;
    } catch (e) {
      lastErr = e;
      if (e && e.message === 'gateway' && u < urls.length - 1) continue;
      break;
    }
  }

  if (lastErr && lastErr.message && /^HTTP\s(401|403):/.test(lastErr.message)) {
    logPaymentDev('Falha no proxy Asaas', lastErr.message);
  } else {
    logPaymentDev('Falha no proxy Asaas', lastErr && lastErr.message);
    if (!(lastErr && lastErr.message && /^HTTP\s(401|403):/.test(lastErr.message))) {
      showToast(MSG_PAYMENT_UNAVAILABLE, 'error');
    }
  }
  return null;
}

async function clearAsaasCustomerCache(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return;
  await sb.from('asaas_customers').delete().eq('user_id', userId).catch(function () {});
}

async function createCustomer(userData, opts) {
  opts = opts || {};
  try {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');

    if (!opts.skipCache) {
      const { data: existing } = await sb.from('asaas_customers')
        .select('asaas_id')
        .eq('user_id', userData.user_id)
        .maybeSingle();

      if (existing?.asaas_id) {
        return { asaas_id: existing.asaas_id, cached: true };
      }
    }

    var doc = String(userData.document || '').replace(/\D/g, '');
    if (!doc || (doc.length !== 11 && doc.length !== 14)) {
      logPaymentDev('createCustomer: CPF/CNPJ ausente ou incompleto', doc);
      showToast('Cadastre um CPF ou CNPJ valido em Meu perfil antes de pagar.', 'error');
      return null;
    }
    if (typeof isValidBrazilTaxId === 'function' && !isValidBrazilTaxId(doc)) {
      logPaymentDev('createCustomer: CPF/CNPJ invalido', null);
      showToast('CPF ou CNPJ invalido no perfil. Corrija em Meu perfil.', 'error');
      return null;
    }

    const result = await callAsaasProxy('/customers', 'POST', {
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      cpfCnpj: doc,
      mobilePhone: String(userData.phone || '').replace(/\D/g, '').slice(0, 11) || undefined,
      notificationDisabled: false,
      additionalEmails: [],
      externalReference: userData.user_id
    });

    if (!result || !result.id) {
      logPaymentDev('createCustomer: resposta sem id', result);
      if (result && Array.isArray(result.errors) && result.errors.length) {
        var errDesc = result.errors.map(function (e) { return e.description || e.code; }).filter(Boolean).join('; ');
        if (errDesc) showToast(errDesc, 'error');
      }
      return null;
    }

    await supabaseInsert('asaas_customers', {
      user_id: userData.user_id,
      asaas_id: result.id
    }).catch(function() {});

    return { asaas_id: result.id, cached: false };
  } catch (e) {
    logPaymentDev('createCustomer', e);
    return null;
  }
}

async function resolveAsaasCustomerForPayment(customerData) {
  var cust = await createCustomer(customerData) || {};
  if (!cust.asaas_id) return cust;
  if (typeof window !== 'undefined') window.__asaasLastHttpStatus = 0;
  return cust;
}

async function retryCustomerAfterAsaas404(customerData, cust) {
  if (!cust.cached || (typeof window !== 'undefined' && window.__asaasLastHttpStatus !== 404)) return null;
  await clearAsaasCustomerCache(customerData.user_id);
  return createCustomer(customerData, { skipCache: true });
}

async function processPixPayment(orderData) {
  try {
    var cust = await resolveAsaasCustomerForPayment(orderData.customer);
    if (!cust.asaas_id) {
      logPaymentDev('PIX: cliente Asaas nao disponivel', null);
      return null;
    }

    var result = await callAsaasProxy('/payments', 'POST', {
      customer: cust.asaas_id,
      billingType: 'PIX',
      value: orderData.total,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'Pedido ' + orderData.orderNumber,
      externalReference: orderData.orderId,
      postalService: false
    });

    if (!result) {
      var retryCust = await retryCustomerAfterAsaas404(orderData.customer, cust);
      if (retryCust && retryCust.asaas_id) {
        cust = retryCust;
        result = await callAsaasProxy('/payments', 'POST', {
          customer: cust.asaas_id,
          billingType: 'PIX',
          value: orderData.total,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: 'Pedido ' + orderData.orderNumber,
          externalReference: orderData.orderId,
          postalService: false
        });
      }
    }

    if (!result || !result.id) throw new Error('Falha ao gerar PIX');

    var qrData = null;
    if (result.id) {
      qrData = await callAsaasProxy('/payments/' + result.id + '/pixQrCode', 'GET');
    }

    await supabaseInsert('payments', {
      order_id: orderData.orderId,
      payment_method: 'PIX',
      asaas_id: result.id,
      status: result.status,
      value: orderData.total,
      pix_qr_code: qrData?.encodedImage || null,
      pix_key: qrData?.payload || null
    }).catch(function() {});

    return {
      id: result.id,
      status: result.status,
      pixQrCode: qrData?.encodedImage || null,
      pixKey: qrData?.payload || null,
      invoiceUrl: result.invoiceUrl || null
    };
  } catch (e) {
    logPaymentDev('processPixPayment', e);
    return null;
  }
}

async function processCreditCardPayment(orderData) {
  try {
    var cust = await resolveAsaasCustomerForPayment(orderData.customer);
    if (!cust.asaas_id) {
      logPaymentDev('Cartao: cliente Asaas nao disponivel', null);
      return null;
    }

    var result = await callAsaasProxy('/payments', 'POST', {
      customer: cust.asaas_id,
      billingType: 'CREDIT_CARD',
      value: orderData.total,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'Pedido ' + orderData.orderNumber,
      externalReference: orderData.orderId,
      creditCard: orderData.card,
      creditCardHolderInfo: {
        name: orderData.customer.name,
        email: orderData.customer.email,
        cpfCnpj: orderData.customer.document,
        postalCode: orderData.customer.zipcode,
        addressNumber: orderData.customer.number,
        phone: orderData.customer.phone
      },
      creditCardToken: orderData.cardToken || null
    });

    if (!result) {
      var retryCustCard = await retryCustomerAfterAsaas404(orderData.customer, cust);
      if (retryCustCard && retryCustCard.asaas_id) {
        cust = retryCustCard;
        result = await callAsaasProxy('/payments', 'POST', {
          customer: cust.asaas_id,
          billingType: 'CREDIT_CARD',
          value: orderData.total,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: 'Pedido ' + orderData.orderNumber,
          externalReference: orderData.orderId,
          creditCard: orderData.card,
          creditCardHolderInfo: {
            name: orderData.customer.name,
            email: orderData.customer.email,
            cpfCnpj: orderData.customer.document,
            postalCode: orderData.customer.zipcode,
            addressNumber: orderData.customer.number,
            phone: orderData.customer.phone
          },
          creditCardToken: orderData.cardToken || null
        });
      }
    }

    if (!result || !result.id) throw new Error('Falha no cartao de credito');

    await supabaseInsert('payments', {
      order_id: orderData.orderId,
      payment_method: 'CREDIT_CARD',
      asaas_id: result.id,
      status: result.status,
      value: orderData.total,
      card_brand: result.creditCardBrand || null
    }).catch(function() {});

    return {
      id: result.id,
      status: result.status,
      gatewayFee: result.gatewayFee || 0,
      installmentValue: result.installmentValue || null,
      installmentCount: result.installmentCount || 1
    };
  } catch (e) {
    logPaymentDev('processCreditCardPayment', e);
    return null;
  }
}

async function processBoletoPayment(orderData) {
  try {
    var custBoleto = await resolveAsaasCustomerForPayment(orderData.customer);
    if (!custBoleto.asaas_id) {
      logPaymentDev('Boleto: cliente Asaas nao disponivel', null);
      return null;
    }

    var resultBoleto = await callAsaasProxy('/payments', 'POST', {
      customer: custBoleto.asaas_id,
      billingType: 'BOLETO',
      value: orderData.total,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'Pedido ' + orderData.orderNumber,
      externalReference: orderData.orderId,
      postalService: false
    });

    if (!resultBoleto) {
      var retryCustBoleto = await retryCustomerAfterAsaas404(orderData.customer, custBoleto);
      if (retryCustBoleto && retryCustBoleto.asaas_id) {
        custBoleto = retryCustBoleto;
        resultBoleto = await callAsaasProxy('/payments', 'POST', {
          customer: custBoleto.asaas_id,
          billingType: 'BOLETO',
          value: orderData.total,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          description: 'Pedido ' + orderData.orderNumber,
          externalReference: orderData.orderId,
          postalService: false
        });
      }
    }

    if (!resultBoleto || !resultBoleto.id) throw new Error('Falha ao criar boleto');
    var result = resultBoleto;

    await supabaseInsert('payments', {
      order_id: orderData.orderId,
      payment_method: 'BOLETO',
      asaas_id: result.id,
      status: result.status,
      value: orderData.total,
      boleto_url: result.bankSlipUrl || null,
      boleto_code: result.barCode || null
    }).catch(function() {});

    return {
      id: result.id,
      status: result.status,
      boletoUrl: result.bankSlipUrl || null,
      barCode: result.barCode || null,
      dueDate: result.dueDate || null
    };
  } catch (e) {
    logPaymentDev('processBoletoPayment', e);
    return null;
  }
}

function isAsaasPaymentPaidStatus(status) {
  const s = String(status || '').toUpperCase();
  return s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH';
}

/** Atualiza pedido no Supabase apos pagamento (webhook ou polling). */
async function syncOrderPaymentFromAsaas(orderId, asaasPaymentId) {
  try {
    const sb = getSupabase();
    if (!sb || !orderId || !asaasPaymentId) return null;
    const sessR = await sb.auth.getSession();
    const token = sessR.data && sessR.data.session && sessR.data.session.access_token;
    if (!token) return null;
    const env = normalizeAsaasEnv(await getSetting('asaas_environment'));
    const res = await fetch('/api/order-payment-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({
        order_id: orderId,
        asaas_payment_id: asaasPaymentId,
        environment: env
      })
    });
    return await res.json().catch(function () {
      return null;
    });
  } catch (e) {
    logPaymentDev('syncOrderPaymentFromAsaas', e);
    return null;
  }
}

var _pixPollTimer = null;

function stopPixPaymentPolling() {
  if (_pixPollTimer) {
    clearInterval(_pixPollTimer);
    _pixPollTimer = null;
  }
}

/** Enquanto o cliente esta na tela do PIX, verifica pagamento e atualiza o pedido. */
function startPixPaymentPolling(orderId, asaasPaymentId, onPaid) {
  stopPixPaymentPolling();
  if (!orderId || !asaasPaymentId) return;
  var tries = 0;
  var maxTries = 120;
  _pixPollTimer = setInterval(async function () {
    tries++;
    var st = await checkPaymentStatus(asaasPaymentId);
    if (st && isAsaasPaymentPaidStatus(st.status)) {
      var sync = await syncOrderPaymentFromAsaas(orderId, asaasPaymentId);
      stopPixPaymentPolling();
      if (typeof onPaid === 'function') onPaid(st, sync);
      return;
    }
    if (tries >= maxTries) stopPixPaymentPolling();
  }, 5000);
}

async function checkPaymentStatus(paymentId) {
  const result = await callAsaasProxy('/payments/' + paymentId, 'GET');
  if (!result) return null;
  return {
    id: result.id,
    status: result.status,
    value: result.value,
    netValue: result.netValue,
    billingType: result.billingType,
    dueDate: result.dueDate,
    confirmedDate: result.confirmedDate,
    paymentDate: result.paymentDate,
    invoiceUrl: result.invoiceUrl,
    bankSlipUrl: result.bankSlipUrl
  };
}

async function getInstallments(value, maxInstallments) {
  const result = await callAsaasProxy('/payments/installments?value=' + value + '&maxInstallments=' + (maxInstallments || 12), 'GET');
  return result?.installments || [];
}

async function listPaymentMethods() {
  try {
    const pix = await getSetting('asaas_pix_enabled');
    const card = await getSetting('asaas_card_enabled');
    const boleto = await getSetting('asaas_boleto_enabled');
    return {
      pix: pix !== 'false',
      creditCard: card !== 'false',
      boleto: boleto !== 'false'
    };
  } catch {
    return { pix: true, creditCard: true, boleto: true };
  }
}

function renderPaymentOptions(selectedMethod) {
  const methods = [
    {
      id: 'CREDIT_CARD',
      label: 'Cartao de Credito',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
      description: 'Ate 12x sem juros'
    },
    {
      id: 'PIX',
      label: 'PIX',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>',
      description: 'Aprovacao instantanea'
    },
    {
      id: 'BOLETO',
      label: 'Boleto Bancario',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 8h16"/><path d="M4 12h16"/><path d="M4 16h16"/><path d="M8 4v16"/><path d="M16 4v16"/></svg>',
      description: 'Vencimento em 3 dias'
    }
  ];

  return methods.map(function(m) {
    var active = selectedMethod === m.id;
    return '<button class="payment-method-option ' + (active ? 'active' : '') + '" data-method="' + m.id + '">' +
      '<span class="payment-method-icon">' + m.icon + '</span>' +
      '<span class="payment-method-info">' +
        '<strong>' + m.label + '</strong>' +
        '<small>' + m.description + '</small>' +
      '</span>' +
      '<span class="payment-method-check">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
      '</span>' +
    '</button>';
  }).join('');
}
