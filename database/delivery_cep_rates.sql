-- Tabela de fretes por CEP (rode uma vez no SQL Editor do Supabase).

create table if not exists public.delivery_cep_rates (
  id uuid primary key default gen_random_uuid(),
  cep text not null,
  freight_amount numeric(12, 2) not null default 0,
  label text,
  lookup_count integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint delivery_cep_rates_cep_digits check (cep ~ '^[0-9]{8}$'),
  constraint delivery_cep_rates_cep_unique unique (cep)
);

create index if not exists idx_delivery_cep_rates_cep on public.delivery_cep_rates (cep);

-- Apenas APIs com service role devem ler/escrever; clientes anon nao precisam acessar direto.
alter table public.delivery_cep_rates enable row level security;

comment on table public.delivery_cep_rates is 'Fretes por CEP; consulta via /api/cep-freight e admin /api/admin-delivery-ceps (service role).';
