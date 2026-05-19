-- Entrega por estado — Espírito Santo
-- Esta versão não usa mais tabela de CEPs individuais.
-- Regra do sistema: CEPs de 29000-000 a 29999-999 são considerados Espírito Santo.
-- Valor padrão do frete: R$ 150,00.

-- Opcional: remover a tabela antiga de CEPs individuais, se você não quiser mais manter os dados antigos.
-- ATENÇÃO: descomente a linha abaixo somente se tiver certeza.
-- drop table if exists public.delivery_cep_rates;

-- Mensagem padrão para endereços fora do Espírito Santo.
insert into public.site_settings (key, value)
values (
  'cep_no_delivery_message',
  to_jsonb('No momento, entregamos apenas para endereços no Espírito Santo. Fale com a loja pelo WhatsApp para consultar alternativas.'::text)
)
on conflict (key) do update set value = excluded.value;

-- Mantém compatibilidade com o frete grátis já usado pela loja e adiciona o valor ES.
insert into public.site_settings (key, value)
values (
  'delivery_info',
  '{"regions":["Espírito Santo"],"delivery_time":"Consultar prazo com a loja","free_from":0,"es_freight_amount":150}'::jsonb
)
on conflict (key) do update set value = excluded.value;
