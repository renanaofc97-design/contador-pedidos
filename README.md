# Contador de pedidos — Cardápio Web

Painel em tempo real para a cozinha, alimentado pelos webhooks de pedidos da Cardápio Web.

## 1) Requisitos
- Node.js 18 ou superior.
- Uma URL HTTPS pública para receber o webhook em produção.

## 2) Rodar no computador
No terminal, dentro desta pasta:

    npm start

Abra:

    http://localhost:3000

## 3) Endpoint do webhook

    POST /webhook/cardapioweb

Exemplo de payload aceito:

    {
      "event_id": "067c677bf1c096ad7db136dc",
      "event_type": "ORDER_CREATED",
      "merchant_id": 3268,
      "order_id": 237456,
      "order_status": "waiting_confirmation",
      "created_at": "2023-06-22T19:04:20.292-03:00"
    }

O painel também aceita ORDER_STATUS_UPDATED.

## 4) Segurança opcional

Defina a variável:

    WEBHOOK_SECRET=uma-senha-grande

e envie o mesmo valor no header:

    X-Webhook-Secret: uma-senha-grande

IMPORTANTE: confirme na documentação da Cardápio Web qual método de autenticação/segredo a sua configuração de webhook usa antes de colocar isso em produção. Não envie tokens OAuth no navegador.

## 5) Status usados

- waiting_confirmation / pending_payment / pending_online_payment -> Aguardando
- confirmed / scheduled_confirmed -> Em preparo
- ready -> Prontos
- released -> Em entrega
- waiting_to_catch -> Prontos / retirada
- delivered -> Entregues
- canceled / canceling -> Cancelados
- closed -> Finalizados

A documentação da Cardápio Web define esses valores de status no endpoint de detalhes do pedido.

## 6) Importante sobre o primeiro dia

O painel começa a contar a partir dos eventos recebidos pelo webhook. Para iniciar já com os pedidos que estavam em andamento antes de instalar o painel, faça uma sincronização inicial usando o endpoint de consulta/polling de pedidos da Cardápio Web.

## 7) Produção

Hospede esta aplicação em um serviço com HTTPS (por exemplo, um servidor Node, Render, Railway, Fly.io ou similar), configure a URL:

    https://SEU-DOMINIO/webhook/cardapioweb

na configuração do webhook da Cardápio Web e deixe a aplicação rodando.

O arquivo data.json guarda os pedidos recebidos. Para uma operação maior, recomenda-se trocar esse armazenamento por PostgreSQL/Supabase.
