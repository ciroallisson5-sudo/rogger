# Variáveis de ambiente — Vercel (Conforta Colchões)

Cadastre no painel da Vercel (Project → Settings → Environment Variables).  
**Não** commite valores reais. Este arquivo lista apenas nomes e notas.

## Obrigatórias para loja + checkout Mercado Pago

| Variável | Uso |
|----------|-----|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave **anon/publishable** (apenas no cliente público; RLS obrigatório) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Somente em `/api/*`** — nunca no frontend |
| `MERCADO_PAGO_ACCESS_TOKEN` | **Somente em `/api/mercadopago-*.js`** — preferência Checkout Pro, webhook e `GET /v1/payments/:id` |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Segredo para validar assinatura `x-signature` do webhook |
| `APP_URL` | URL canônica do site **sem barra final**, **HTTPS**, domínio público (ex.: `https://www.confortacolchoes.site`). **Nunca `http://localhost` na Vercel** — o Checkout Pro e o MP exigem URLs públicas para `back_urls` e `notification_url`. Se `APP_URL` for localhost no deploy, a API tenta `VERCEL_URL` ou cabeçalhos. |
| `ALLOWED_ORIGINS` | Origens permitidas em CORS para `/api/*` (pode repetir `APP_URL` ou lista separada por vírgula) |

### `MERCADO_PAGO_ENV` (sandbox vs produção)

| Valor | Quando usar |
|-------|-------------|
| `auto` | Recomendado: detecta `TEST-*` como sandbox e `APP_USR-*` como produção. |
| `sandbox` | Access token de **teste** no painel Mercado Pago (cobranças simuladas). |
| `production` | Access token de **produção** (cobranças reais). |

Use `MERCADO_PAGO_ENV=auto` se estiver alternando entre token de teste e token real. O checkout escolhe o link correto (`sandbox_init_point` ou `init_point`) de acordo com o token, evitando a tela “link de pagamento já não está disponível”.

### Aliases opcionais de URL do site

Se preferir outro nome no painel, a API também considera (nesta ordem):  
`APP_URL` → `SITE_URL` → `SITE_PUBLIC_URL` (mesmo formato, sem barra final).  
Na Vercel, `VERCEL_URL` é usado como fallback **HTTPS** quando `APP_URL` não é utilizável (ex.: localhost).

## Pix no Mercado Pago

O checkout padrão da loja abre o **Checkout Pro do Mercado Pago**. Pix, cartão, boleto e parcelamento aparecem dentro do ambiente do Mercado Pago, conforme os meios habilitados na conta vendedora.

Para Pix aparecer em produção, confirme no painel/conta Mercado Pago que existe uma **chave Pix cadastrada e habilitada** para a conta vendedora.

Opcional: `MERCADO_PAGO_DEFAULT_PAYMENT_METHOD_ID=pix` pode tentar destacar Pix no Checkout Pro, se a opção estiver disponível para a conta.

## Webhook Mercado Pago

No painel de desenvolvedor MP, configure a URL de notificação:

`https://SEU_DOMINIO/api/mercadopago-webhook?source_news=webhooks`

- Método: **POST**
- Evento recomendado: **Payments** (pagamentos)
- O parâmetro `source_news=webhooks` pode vir na query; a rota continua funcionando.

## Mercado Pago (opcional / branding)

| Variável | Uso |
|----------|-----|
| `MERCADO_PAGO_PUBLIC_KEY` | Chave pública (checkout ou admin) |
| `MERCADO_PAGO_STATEMENT_DESCRIPTOR` | Texto no extrato |
| `MERCADO_PAGO_MAX_INSTALLMENTS` | Limite de parcelas |
| `MERCADO_PAGO_DEFAULT_PAYMENT_METHOD_ID` | Opcional; use `pix` para tentar destacar Pix no Checkout Pro |
| `MERCADO_PAGO_SEND_SHIPMENTS` | Opcional; deixe `false` por padrão. O frete já vai como item no Checkout Pro. |
| `MP_CHECKOUT_DEBUG` | `1` para logs extras no servidor (sem token) |

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

## Segurança — checklist

- Frontend (`*.html`, `js/*.js`): apenas `SUPABASE_URL` + **anon/publishable**.
- Segredos MP e `SUPABASE_SERVICE_ROLE_KEY`: **somente** `process.env` em `api/*.js`.
- Asaas: rotas legadas respondem **410**; fluxo ativo é Mercado Pago.

## Retorno do cliente (`checkout-retorno.html`)

O Mercado Pago redireciona com parâmetros como `collection_id`, `status`, `external_reference`. A página chama:

`/api/mercadopago-payment-status?order_id=...&payment_id=...`

com **Bearer** do Supabase; a API consulta `GET https://api.mercadopago.com/v1/payments/{id}` e aplica o mesmo fluxo do webhook quando o pagamento está aprovado, **sem depender só do webhook**.

## Checkout visitante sem login

Para permitir compra sem criar conta, rode no Supabase:

```sql
-- arquivo do projeto
database/guest_checkout_no_login.sql
```

Esse ajuste permite `orders.user_id = null` para pedido visitante e salva os dados do cliente no pedido/pagamento.


## Entrega por Estado

A loja não usa mais tabela de CEPs individuais. O checkout valida automaticamente se o CEP pertence ao Espírito Santo.

| Variável | Uso |
|---|---|
| `DELIVERY_ALLOWED_STATE` | Deixe `ES`. |
| `ES_FREIGHT_AMOUNT` | Valor padrão do frete para Espírito Santo. Padrão: `150`. |

Regra atual: CEPs de `29000-000` a `29999-999` podem seguir para o checkout do Mercado Pago. CEPs fora dessa faixa são bloqueados com a mensagem configurada no painel.
