'use strict';

/**
 * CEP brasileiro: 8 dígitos após normalizar.
 * Menos de 8 dígitos numéricos → preenche com zeros à esquerda (ex.: 2910010 → 02910010),
 * alinhado ao painel / assistente (database + admin).
 */
function normalizeBrazilCepDigits(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length > 8) d = d.slice(0, 8);
  if (d.length >= 1 && d.length < 8) d = d.padStart(8, '0');
  if (d.length === 8 && /^[0-9]{8}$/.test(d)) return d;
  return '';
}

module.exports = { normalizeBrazilCepDigits };
