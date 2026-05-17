'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(410).json({ error: 'Gateway Asaas desativado. Use Mercado Pago.' });
};
