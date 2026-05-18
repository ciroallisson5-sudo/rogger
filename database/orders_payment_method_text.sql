-- Se o checkout ainda falhar com ORDER_INSERT_FAILED e a mensagem do Postgres
-- citar "value too long" ou enum invalido em payment_method, rode no SQL Editor.

-- Alarga payment_method para aceitar qualquer string curta (ex.: mercadopago, mercadopago_checkout_pro).
alter table public.orders
  alter column payment_method type text;

-- Se payment_status for ENUM e nao tiver 'pending_payment', adicione (ajuste o nome do tipo se for outro):
-- alter type public.order_payment_status add value if not exists 'pending_payment';
