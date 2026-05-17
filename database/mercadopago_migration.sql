-- Mercado Pago: colunas em payments, tabela payment_events, idempotencia e estoque.
-- Execute no SQL Editor do Supabase (uma vez por ambiente).

-- ---------------------------------------------------------------------------
-- orders.inventory_applied: evita baixa duplicada de estoque
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists inventory_applied boolean not null default false;

comment on column public.orders.inventory_applied is 'True apos decrement_stock_for_order concluido para o pedido (pagamento aprovado).';

-- ---------------------------------------------------------------------------
-- payments: campos do provedor Mercado Pago
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists provider_payment_id text;
alter table public.payments add column if not exists provider_preference_id text;
alter table public.payments add column if not exists provider_merchant_order_id text;
alter table public.payments add column if not exists provider_status text;
alter table public.payments add column if not exists provider_status_detail text;
alter table public.payments add column if not exists external_reference text;
alter table public.payments add column if not exists raw_provider_payload jsonb default '{}'::jsonb;
alter table public.payments add column if not exists paid_at timestamptz;
alter table public.payments add column if not exists updated_at timestamptz default now();
alter table public.payments add column if not exists idempotency_key text;

create unique index if not exists payments_idempotency_key_uidx
  on public.payments (idempotency_key)
  where idempotency_key is not null and length(trim(idempotency_key)) > 0;

create index if not exists payments_provider_payment_id_idx on public.payments (provider_payment_id);
create index if not exists payments_provider_preference_id_idx on public.payments (provider_preference_id);
create index if not exists payments_external_reference_idx on public.payments (external_reference);

-- ---------------------------------------------------------------------------
-- payment_events: idempotencia de webhooks / eventos
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text,
  resource_id text,
  order_id uuid,
  payment_id uuid,
  raw_payload jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists payment_events_order_id_idx on public.payment_events (order_id);
create index if not exists payment_events_resource_idx on public.payment_events (provider, resource_id);

alter table public.payment_events enable row level security;

comment on table public.payment_events is 'Eventos de webhook de pagamento; acesso apenas service role (API). RLS sem policy: cliente nao le via PostgREST.';

-- ---------------------------------------------------------------------------
-- Pedidos: indice por status (painel / consultas)
-- ---------------------------------------------------------------------------
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_payment_status_idx on public.orders (payment_status);

-- ---------------------------------------------------------------------------
-- RPC decrement_stock_for_order (revisao)
-- Garanta no Supabase que a funcao:
--   - so reduz estoque uma vez por pedido (ex.: checar orders.inventory_applied ou tabela de locks);
--   - nao permite estoque negativo;
--   - registra inventory_movements se existir.
-- Exemplo de guarda (ajuste nomes de colunas as suas tabelas):
/*
create or replace function public.decrement_stock_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'Pedido inexistente';
  end if;
  -- implementacao idempotente + validacao de estoque aqui
end;
$$;
*/
