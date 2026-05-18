-- Checkout visitante sem login obrigatório
-- Rode este SQL no Supabase se a sua tabela orders exigir user_id obrigatório.
-- Ele permite criar pedido com user_id NULL e salva os dados do visitante no próprio pedido.

alter table public.orders
  alter column user_id drop not null;

alter table public.orders
  add column if not exists guest_session_id text,
  add column if not exists guest_customer jsonb,
  add column if not exists guest_shipping_address jsonb;

create index if not exists orders_guest_session_id_idx
  on public.orders (guest_session_id);

comment on column public.orders.guest_session_id is 'ID local do aparelho/sessao usado no checkout visitante sem login.';
comment on column public.orders.guest_customer is 'Dados informados no checkout visitante: nome, email, telefone, CPF/CNPJ opcional.';
comment on column public.orders.guest_shipping_address is 'Endereco informado no checkout visitante sem login.';
