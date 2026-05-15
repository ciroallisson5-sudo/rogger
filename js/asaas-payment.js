// Conforta Store - Asaas Payment Integration (via Vercel Proxy)

const ASAAS_PROXY_URL = '/api/asaas-proxy';

const MSG_PAYMENT_UNAVAILABLE = 'Pagamento online indisponivel no momento. Tente mais tarde ou fale com a loja.';

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
async function isAsaasProxyAvailable() {
  if (window.__asaasProxyAvailable !== undefined) return window.__asaasProxyAvailable;
  try {
    const r = await fetch(ASAAS_PROXY_URL, { method: 'GET' });
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const meta = await r.json().catch(function() { return {}; });
      // O proxy existe e a chave esta no env do servidor
      window.__asaasProxyAvailable = !!meta.configured;
    } else {
      window.__asaasProxyAvailable = false;
    }
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
    logPaymentDev('Proxy de pagamento nao configurado (defina ASAAS_API_KEY na Vercel)', ASAAS_PROXY_URL);
    return null;
  }
  try {
    const res = await fetch(ASAAS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: endpoint,
        method: method,
        body: body || null,
        environment: env
      })
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      logPaymentDev('Resposta nao-JSON do proxy', ct);
      throw new Error('gateway');
    }
    const result = await res.json();
    if (!res.ok) {
      const msg = result.error || result.message || 'Erro na requisicao';
      if (res.status === 401 || res.status === 403) {
        showToast(
          'Asaas recusou a chave (401). Na Vercel use ASAAS_API_KEY ou chaves separadas ASAAS_API_KEY_SANDBOX / ASAAS_API_KEY_PRODUCTION e deixe o ambiente no admin igual ao da chave.',
          'error'
        );
      } else {
        showToast(MSG_PAYMENT_UNAVAILABLE, 'error');
      }
      throw new Error('HTTP ' + res.status + ': ' + msg);
    }
    return result;
  } catch (e) {
    if (e && e.message && /^HTTP\s(401|403):/.test(e.message)) {
      logPaymentDev('Falha no proxy Asaas', e.message);
    } else {
      logPaymentDev('Falha no proxy Asaas', e && e.message);
      if (!(e && e.message && /^HTTP\s(401|403):/.test(e.message))) {
        showToast(MSG_PAYMENT_UNAVAILABLE, 'error');
      }
    }
    return null;
  }
}

async function createCustomer(userData) {
  try {
    const sb = getSupabase();
    if (!sb) throw new Error('Supabase not initialized');

    const { data: existing } = await sb.from('asaas_customers')
      .select('asaas_id')
      .eq('user_id', userData.user_id)
      .maybeSingle();

    if (existing?.asaas_id) {
      return { asaas_id: existing.asaas_id, cached: true };
    }

    const result = await callAsaasProxy('/customers', 'POST', {
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      cpfCnpj: userData.document,
      notificationDisabled: false,
      additionalEmails: [],
      externalReference: userData.user_id
    });

    if (!result || !result.id) {
      logPaymentDev('createCustomer: resposta sem id', result);
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

async function processPixPayment(orderData) {
  try {
    const { asaas_id } = await createCustomer(orderData.customer) || {};
    if (!asaas_id) {
      logPaymentDev('PIX: cliente Asaas nao disponivel', null);
      return null;
    }

    const result = await callAsaasProxy('/payments', 'POST', {
      customer: asaas_id,
      billingType: 'PIX',
      value: orderData.total,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'Pedido ' + orderData.orderNumber,
      externalReference: orderData.orderId,
      postalService: false
    });

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
    const { asaas_id } = await createCustomer(orderData.customer) || {};
    if (!asaas_id) {
      logPaymentDev('Cartao: cliente Asaas nao disponivel', null);
      return null;
    }

    const result = await callAsaasProxy('/payments', 'POST', {
      customer: asaas_id,
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
    const { asaas_id } = await createCustomer(orderData.customer) || {};
    if (!asaas_id) {
      logPaymentDev('Boleto: cliente Asaas nao disponivel', null);
      return null;
    }

    const result = await callAsaasProxy('/payments', 'POST', {
      customer: asaas_id,
      billingType: 'BOLETO',
      value: orderData.total,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'Pedido ' + orderData.orderNumber,
      externalReference: orderData.orderId,
      postalService: false
    });

    if (!result || !result.id) throw new Error('Falha ao criar boleto');

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
