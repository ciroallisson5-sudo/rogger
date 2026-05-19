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

function normalizeBrazilState(input) {
  const raw = String(input || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  if (!raw) return '';
  if (raw === 'ES' || raw === 'ESPIRITO SANTO' || raw === 'ESTADO DO ESPIRITO SANTO') return 'ES';
  return raw.slice(0, 2);
}

/** Espírito Santo usa CEPs na faixa 29000000–29999999. */
function isEspiritoSantoCep(input) {
  const cep = normalizeBrazilCepDigits(input);
  if (!cep) return false;
  const n = Number(cep);
  return n >= 29000000 && n <= 29999999;
}

function isEspiritoSantoState(input) {
  return normalizeBrazilState(input) === 'ES';
}

function resolveEspiritoSantoDelivery(input) {
  const data = input && typeof input === 'object' ? input : { cep: input };
  const cep = normalizeBrazilCepDigits(data.cep || data.zip_code || data.zipCode || data.postal_code || data.postalCode || '');
  const state = normalizeBrazilState(data.state || data.uf || '');
  const cepOk = isEspiritoSantoCep(cep);
  const stateOk = state ? state === 'ES' : true;
  return {
    cep: cep,
    state: state,
    allowed: !!cep && cepOk && stateOk,
    cep_in_es: cepOk,
    state_in_es: state ? state === 'ES' : null
  };
}

module.exports = {
  normalizeBrazilCepDigits,
  normalizeBrazilState,
  isEspiritoSantoCep,
  isEspiritoSantoState,
  resolveEspiritoSantoDelivery
};
