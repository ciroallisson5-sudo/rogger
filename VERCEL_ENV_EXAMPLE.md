# Variáveis de ambiente — Vercel (Conforta Colchões)

Cadastre no painel da Vercel (Project → Settings → Environment Variables).  
**Não** commite valores reais. Este arquivo lista apenas nomes e notas.

## Obrigatórias para loja + checkout Mercado Pago

| Variável | Uso |
|----------|-----|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave **anon/publishable** (apenas no cliente público; RLS obrigatório) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Somente em `/api/*`** — nunca no frontend |
| `MERCADO_PAGO_ACCESS_TOKEN` | **Somente em `/api/mercadopago-*.js`** — preferência e consultas MP |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Validação de assinatura do webhook (se aplicável ao seu fluxo) |
| `APP_URL` | URL canônica do site **sem barra final** (ex.: `https://www.confortacolchoes.site`). Usada em retornos MP e `notification_url`. |
| `ALLOWED_ORIGINS` | Origens permitidas em CORS para `/api/*` (pode repetir `APP_URL` ou lista separada por vírgula) |

### Aliases opcionais de URL do site

Se preferir outro nome no painel, a API de preferência MP também aceita (nesta ordem de fallback):  
`APP_URL` → `SITE_URL` → `SITE_PUBLIC_URL` (mesmo formato, sem barra final).

## Mercado Pago (opcional / branding)

| Variável | Uso |
|----------|-----|
| `MERCADO_PAGO_PUBLIC_KEY` | Chave pública (ex.: checkout ou admin; não é o access token) |
| `MERCADO_PAGO_ENV` | `production` ou `sandbox` |
| `MERCADO_PAGO_STATEMENT_DESCRIPTOR` | Texto no extrato |
| `MERCADO_PAGO_MAX_INSTALLMENTS` | Limite de parcelas |

## APIs opcionais

| Variável | Uso |
|----------|-----|
| `OPENAI_API_KEY` | `/api/openai-chat`, assistente admin |
| `OPENAI_CHAT_MODEL` | Modelo chat (ex.: `gpt-4o-mini`) |
| `N8N_PRODUCTS_SECRET` | Header para `/api/n8n-products` |
| `TRIPO_API_KEY` | `/api/gerar-3d` |
| `ADMIN_EMAIL_ALLOW` | Restrição de e-mail admin, se implementado |

## Raiz do deploy

O repositório **já é** a raiz do projeto (um `index.html`, uma pasta `api/`, uma `js/`).  
Não há pasta duplicada `conforta-store/conforta-store` para mover.

## Segurança — checklist

- Frontend (`*.html`, `js/*.js`): apenas `SUPABASE_URL` + **anon/publishable**.
- Segredos MP e `SUPABASE_SERVICE_ROLE_KEY`: **somente** `process.env` em `api/*.js`.
- Asaas: rotas legadas respondem **410**; fluxo ativo é Mercado Pago.
