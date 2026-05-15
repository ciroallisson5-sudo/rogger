-- Adiciona campo de CPF/CNPJ em profiles (rode no Supabase se o perfil nao salvar documento).

alter table public.profiles
  add column if not exists cpf_cnpj text;

comment on column public.profiles.cpf_cnpj is 'CPF ou CNPJ do cliente (digitos ou formatado).';
