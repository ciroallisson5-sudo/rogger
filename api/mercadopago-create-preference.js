'use strict';

const { applyBrowserCors, handleOptions, parseBody } = require('./_http');
const { verifySupabaseUserJwt } = require('./_supabase-user');
const { rateLimitKey, allow, prune } = require('./_rate-limit');
const { adminConfig, restGet, restPost } = require('./mercadopago-sync');

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
  if (!cepDigits || cepDigits.length !== 8) return { delivered: false, amount: 0 };
  const rowRes = await restGet(
    cfg,
    '/rest/v1/delivery_cep_rates?cep=eq.' + encodeURIComponent(cepDigits) + '&select=freight_amount&limit=1'
  );
  if (!rowRes.ok || !Array.isArray(rowRes.data) || !rowRes.data[0]) {
    return { delivered: false, amount: 0 };
  }
  let freight = parseFloat(rowRes.data[0].freight_amount) || 0;
  const freeRes = await restGet(
    cfg,
    '/rest/v1/site_settings?key=eq.delivery_info&select=value&limit=1'
  );
  let freeFrom = 0;
  if (freeRes.ok && Array.isArray(freeRes.data) && freeRes.data[0] && freeRes.data[0].value) {
    try {
      const v = freeRes.data[0].value;
      const di = typeof v === 'string' ? JSON.parse(v) : v;
      freeFrom = parseFloat(di.free_from) || 0;
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
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = rateLimitKey(req, 'mp-pref');
  if (!allow(key, 20, 60000)) {
    res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
    return;
  }

  const cfg = adminConfig();
  const accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim();
  const appUrl = (process.env.APP_URL || process.env.SITE_URL || process.env.SITE_PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (!cfg.ok || !accessToken || !appUrl) {
    res.status(503).json({ error: 'Pagamento não configurado no servidor.' });
    return;
  }

  const auth = req.headers.authorization || '';
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  const user = await verifySupabaseUserJwt(jwt);
  if (!user) {
    res.status(401).json({ error: 'Sessao invalida ou expirada.' });
    return;
  }

  const body = parseBody(req.body);
  const shippingAddressId = String(body.shipping_address_id || '').trim();
  const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotency_key || '')
    .trim()
    .slice(0, 128);

  if (!shippingAddressId) {
    res.status(400).json({ error: 'Selecione um endereço de entrega.' });
    return;
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
      const ordChk = await restGet(
        cfg,
        '/rest/v1/orders?id=eq.' +
          encodeURIComponent(oid) +
          '&user_id=eq.' +
          encodeURIComponent(user.id) +
          '&select=id,order_number,payment_status&limit=1'
      );
      if (ordChk.ok && Array.isArray(ordChk.data) && ordChk.data[0]) {
        const raw = row.raw_provider_payload || {};
        const initPoint = raw.init_point || raw.sandbox_init_point;
        const prefId = row.provider_preference_id || raw.preference_id;
        if (initPoint && prefId && String(ordChk.data[0].payment_status || '') !== 'paid') {
          res.status(200).json({
            init_point: initPoint,
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

  const cartQ = await restGet(
    cfg,
    '/rest/v1/carts?user_id=eq.' + encodeURIComponent(user.id) + '&select=id&limit=1'
  );
  if (!cartQ.ok || !Array.isArray(cartQ.data) || !cartQ.data[0]) {
    res.status(400).json({ error: 'Carrinho vazio.' });
    return;
  }
  const cartId = cartQ.data[0].id;

  const itemsRes = await restGet(
    cfg,
    '/rest/v1/cart_items?cart_id=eq.' + encodeURIComponent(cartId) + '&select=id,product_id,photo_id,quantity'
  );
  if (!itemsRes.ok || !Array.isArray(itemsRes.data) || itemsRes.data.length === 0) {
    res.status(400).json({ error: 'Carrinho vazio.' });
    return;
  }

  const rawRows = itemsRes.data;
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
      res.status(400).json({ error: 'Quantidade invalida em um item do carrinho.' });
      return;
    }
    const prod = prodMap[String(row.product_id)] || null;
    const photo = row.photo_id ? photoMap[String(row.photo_id)] || null : null;
    if (!prod || prod.active === false) {
      res.status(400).json({ error: 'Produto indisponível: ' + (prod && prod.name ? String(prod.name) : 'item') });
      return;
    }
    if (photo && photo.is_video) {
      res.status(400).json({ error: 'Item invalido no carrinho.' });
      return;
    }
    const unit = lineUnitPrice(prod, photo);
    if (unit <= 0) {
      res.status(400).json({ error: 'Preco invalido no servidor.' });
      return;
    }
    const stock = prod.stock != null ? parseInt(prod.stock, 10) : null;
    const so = photo && photo.stock_override != null ? parseInt(photo.stock_override, 10) : null;
    const effStock = so != null && !isNaN(so) ? so : stock;
    if (effStock != null && !isNaN(effStock) && effStock < qty) {
      res.status(400).json({ error: 'Estoque insuficiente para: ' + String(prod.name || 'produto') });
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
  const addr = await restGet(
    cfg,
    '/rest/v1/addresses?id=eq.' +
      encodeURIComponent(shippingAddressId) +
      '&user_id=eq.' +
      encodeURIComponent(user.id) +
      '&select=zip_code,cep&limit=1'
  );
  if (!addr.ok || !Array.isArray(addr.data) || !addr.data[0]) {
    res.status(400).json({ error: 'Endereco de entrega invalido.' });
    return;
  }
  const z = addr.data[0].zip_code != null ? addr.data[0].zip_code : addr.data[0].cep;
  cep = String(z || '').replace(/\D/g, '');
  if (cep.length !== 8 || cep[0] === '0') {
    res.status(400).json({ error: 'CEP inválido no endereço selecionado.' });
    return;
  }

  const subtotal = lines.reduce(function (a, l) {
    return a + l.unit_price * l.quantity;
  }, 0);
  const fr = await fetchFreightAmount(cfg, cep, subtotal);
  if (!fr.delivered) {
    res.status(400).json({ error: 'CEP fora da area de entrega.' });
    return;
  }
  const shipping = fr.delivered ? fr.amount : 0;
  const total = Math.round((subtotal + shipping) * 100) / 100;

  const orderNumber = 'CF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

  const orderRow = {
    user_id: user.id,
    order_number: orderNumber,
    status: 'pending',
    payment_status: 'pending_payment',
    payment_method: 'mercadopago_checkout_pro',
    total_amount: total,
    shipping_amount: shipping,
    discount_amount: 0,
    shipping_address_id: shippingAddressId || null,
    notes: ''
  };

  const insOrder = await restPost(cfg, 'orders', orderRow);
  if (!insOrder.ok || !Array.isArray(insOrder.data) || !insOrder.data[0]) {
    res.status(500).json({ error: 'Nao foi possivel criar o pedido.' });
    return;
  }
  const order = insOrder.data[0];
  const orderId = order.id;

  try {
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j];
      const it = {
        order_id: orderId,
        product_id: l.product_id,
        photo_id: l.photo_id,
        product_name: l.name,
        photo_url: null,
        quantity: l.quantity,
        unit_price: l.unit_price,
        color_name: null
      };
      const ir = await restPost(cfg, 'order_items', it);
      if (!ir.ok) throw new Error('order_items');
    }

    const payIns = await restPost(cfg, 'payments', {
      order_id: orderId,
      provider: 'mercadopago',
      status: 'pending',
      amount: total,
      external_reference: orderId,
      idempotency_key: idempotencyKey || null,
      raw_provider_payload: {}
    });
    if (!payIns.ok) throw new Error('payments');

    let profileRow = null;
    const profRes = await restGet(
      cfg,
      '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id) + '&select=full_name,cpf_cnpj&limit=1'
    );
    if (profRes.ok && Array.isArray(profRes.data) && profRes.data[0]) profileRow = profRes.data[0];

    const fullName = String((profileRow && profileRow.full_name) || user.email || 'Cliente').trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'Cliente';
    const surname = nameParts.length > 1 ? nameParts.slice(1).join(' ').slice(0, 60) : firstName;
    const docDigits = String((profileRow && profileRow.cpf_cnpj) || '')
      .replace(/\D/g, '')
      .slice(0, 14);
    const payer = {
      email: user.email || undefined,
      first_name: firstName.slice(0, 50),
      surname: surname.slice(0, 60)
    };
    if (docDigits.length === 11) {
      payer.identification = { type: 'CPF', number: docDigits };
    } else if (docDigits.length === 14) {
      payer.identification = { type: 'CNPJ', number: docDigits };
    }

    const mpItems = lines.map(function (l) {
      return {
        id: String(l.product_id),
        title: l.name.slice(0, 127),
        quantity: l.quantity,
        currency_id: 'BRL',
        unit_price: l.unit_price
      };
    });
    if (shipping > 0) {
      mpItems.push({
        id: 'frete',
        title: 'Frete',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: shipping
      });
    }

    const idem = idempotencyKey || orderId;
    const statement = String(process.env.MERCADO_PAGO_STATEMENT_DESCRIPTOR || 'CONFORTA').slice(0, 22);
    const maxInst = Math.min(12, parseInt(process.env.MERCADO_PAGO_MAX_INSTALLMENTS || '12', 10) || 12);

    const prefBody = {
      items: mpItems,
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
      payment_methods: { installments: maxInst },
      metadata: { order_number: orderNumber, user_id: user.id }
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idem
      },
      body: JSON.stringify(prefBody)
    });
    const mpJson = await mpRes.json().catch(function () {
      return {};
    });
    if (!mpRes.ok) {
      throw new Error(mpJson.message || 'mercadopago_preference_failed');
    }

    const initPoint = mpJson.init_point || mpJson.sandbox_init_point;
    const prefId = mpJson.id;
    if (!initPoint || !prefId) throw new Error('init_point_missing');

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
          sandbox_init_point: mpJson.sandbox_init_point || null
        }
      })
    }).catch(function () {});

    res.status(200).json({
      init_point: initPoint,
      preference_id: prefId,
      order_id: orderId,
      order_number: orderNumber
    });
  } catch (err) {
    await deleteOrderCascade(cfg, orderId);
    res.status(502).json({ error: 'Nao foi possivel iniciar o pagamento. Tente novamente.' });
  }
};
