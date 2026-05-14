-- Conforta Store - Limpeza de chaves sensiveis em site_settings
-- Rode no SQL Editor do Supabase para remover a API key do Asaas que estava
-- exposta pela politica de leitura publica. A chave agora vive apenas na
-- variavel de ambiente ASAAS_API_KEY do projeto na Vercel.

DELETE FROM site_settings WHERE key = 'asaas_api_key';

-- Se voce chegou a salvar uma chave da OpenAI aqui em algum momento:
DELETE FROM site_settings WHERE key = 'openai_api_key';
