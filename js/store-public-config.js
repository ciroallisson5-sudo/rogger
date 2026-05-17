/**
 * Dados públicos editáveis da loja (sem credenciais).
 * Preencha apenas informações reais. Deixe string vazia para ocultar no site.
 *
 * Prioridade: valores em site_settings (Supabase) sobrescrevem estes quando existirem.
 */
(function (global) {
  'use strict';

  global.CONFORTA_STORE_EDITABLE = {
    /** Nome fantasia exibido em textos de confiança */
    displayName: 'Conforta Colchões',

    /**
     * WhatsApp em formato E.164 sem + (ex: 5527999998888).
     * Se vazio, o site usa whatsapp_number / contact_phone do Supabase (site_settings).
     */
    whatsappE164: '',

    /** Endereço completo da loja (uma linha). Vazio = não exibir bloco de endereço. */
    storeAddressLine: '',

    /** CNPJ formatado ou só dígitos. Vazio = não exibir. */
    storeCnpj: '',

    /**
     * Texto curto de garantia (informação genérica, sem inventar prazo legal).
     * Ex.: "Garantia conforme fabricante e nota fiscal."
     */
    warrantySummary: 'Garantia conforme fabricante e documento da compra — detalhes no produto e na nota.',

    /** Texto sobre regiões de entrega (evite prometer cidade que não atende). */
    deliverySummary:
      'Entrega com agilidade em Serra, Vitória e região da Grande Vitória. Para outros CEPs, confirmamos disponibilidade e prazo pelo WhatsApp.',

    /** Área de cobertura SEO (cidade/estado), sem inventar filiais. */
    serviceAreaDescription: 'Serra e Vitória, Espírito Santo, Brasil',

    /** URL canônica do site (opcional, para JSON-LD). Ex.: https://www.confortacolchoes.site */
    siteUrl: typeof global.location !== 'undefined' ? global.location.origin : '',

    /** Redes sociais (opcional). Somente URLs reais. */
    sameAs: [] // ex.: ['https://www.instagram.com/sua_loja']
  };
})(typeof window !== 'undefined' ? window : globalThis);
