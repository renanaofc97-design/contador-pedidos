```js
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

const CARDAPIO_API_KEY = process.env.CARDAPIO_API_KEY;
const CARDAPIO_API_URL =
  "https://integracao.cardapioweb.com/api/partner/v1";

let orders = {};
const clients = new Set();

/* =========================
   CARREGAR DADOS
========================= */

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );

      if (data && data.orders) {
        orders = data.orders;
      }
    }
  } catch (error) {
    console.error(
      "Erro ao carregar data.json:",
      error.message
    );

    orders = {};
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          orders: orders
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "Erro ao salvar data.json:",
      error.message
    );
  }
}

loadData();

/* =========================
   DATA DE HOJE
========================= */

function getTodayString() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "America/Sao_Paulo"
    }
  ).format(new Date());
}

/* =========================
   VERIFICAR DATA
========================= */

function isToday(dateString) {
  if (!dateString) {
    return false;
  }

  try {
    const dataPedido =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "America/Sao_Paulo"
        }
      ).format(
        new Date(dateString)
      );

    return dataPedido === getTodayString();
  } catch (error) {
    return false;
  }
}

/* =========================
   SALVAR PEDIDO
========================= */

function saveOrder(pedido) {
  if (!pedido || !pedido.id) {
    return false;
  }

  const id = String(pedido.id);
  const existente = orders[id] || {};

  orders[id] = {
    ...existente,
    ...pedido,

    id: pedido.id,

    status:
      pedido.status ||
      existente.status,

    created_at:
      pedido.created_at ||
      existente.created_at,

    updated_at:
      pedido.updated_at ||
      existente.updated_at ||
      new Date().toISOString()
  };

  return !existente.id;
}

/* =========================
   CONTADORES
========================= */

function getCounters() {
  const counters = {
    aguardando: 0,
    em_preparo: 0,
    prontos: 0,
    em_entrega: 0,
    entregues: 0,
    cancelados: 0
  };

  const hoje = getTodayString();

  for (const id in orders) {
    const order = orders[id];

    if (!order || !order.created_at) {
      continue;
    }

    let dataPedido;

    try {
      dataPedido =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone: "America/Sao_Paulo"
          }
        ).format(
          new Date(order.created_at)
        );
    } catch (error) {
      continue;
    }

    if (dataPedido !== hoje) {
      continue;
    }

    switch (order.status) {

      case "waiting_confirmation":
      case "pending_payment":
      case "pending_online_payment":
      case "waiting_payment":

        counters.aguardando++;
        break;

      case "confirmed":
      case "scheduled_confirmed":

        counters.em_preparo++;
        break;

      case "ready":
      case "waiting_to_catch":

        counters.prontos++;
        break;

      case "released":
      case "out_for_delivery":

        counters.em_entrega++;
        break;

      case "delivered":
      case "closed":

        counters.entregues++;
        break;

      case "canceled":
      case "canceling":

        counters.cancelados++;
        break;
    }
  }

  return counters;
}

/* =========================
   TOTAL DE HOJE
========================= */

function getTotalToday() {
  const hoje = getTodayString();
  let total = 0;

  for (const id in orders) {
    const order = orders[id];

    if (!order || !order.created_at) {
      continue;
    }

    try {
      const dataPedido =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone: "America/Sao_Paulo"
          }
        ).format(
          new Date(order.created_at)
        );

      if (dataPedido === hoje) {
        total++;
      }

    } catch (error) {
      continue;
    }
  }

  return total;
}

/* =========================
   DASHBOARD
========================= */

function dashboardData() {
  return {
    total_today: getTotalToday(),
    counters: getCounters()
  };
}

/* =========================
   ENVIAR AO PAINEL
========================= */

function broadcast() {
  const message =
    "data: " +
    JSON.stringify(
      dashboardData()
    ) +
    "\n\n";

  for (const res of clients) {
    try {
      res.write(message);
    } catch (error) {
      clients.delete(res);
    }
  }
}

/* =========================
   EXTRAIR PEDIDOS
========================= */

function extractOrders(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.orders)) {
    return data.orders;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (
    data.data &&
    Array.isArray(data.data.orders)
  ) {
    return data.data.orders;
  }

  if (
    data.results &&
    Array.isArray(data.results)
  ) {
    return data.results;
  }

  return [];
}

/* =========================
   CONSULTAR API
========================= */

async function requestOrders(url) {
  const response = await fetch(
    url,
    {
      method: "GET",

      headers: {
        "X-API-KEY":
          CARDAPIO_API_KEY,

        "Accept":
          "application/json"
      }
    }
  );

  const text =
    await response.text();

  console.log(
    "Status API:",
    response.status
  );

  return {
    response: response,
    text: text
  };
}

/* =========================
   SINCRONIZAR PEDIDOS
========================= */

async function syncOrders() {

  if (!CARDAPIO_API_KEY) {
    console.error(
      "ERRO: CARDAPIO_API_KEY não configurada."
    );

    return;
  }

  try {

    console.log(
      "----------------------------------------"
    );

    console.log(
      "Consultando pedidos no Cardápio Web..."
    );

    const agora = new Date();

    const oitoHorasAtras =
      new Date(
        agora.getTime() -
        8 * 60 * 60 * 1000
      );

    const updatedSince =
      oitoHorasAtras.toISOString();

    let totalRecebidos = 0;
    let totalNovos = 0;
    let totalAtualizados = 0;

    for (
      let page = 1;
      page <= 10;
      page++
    ) {

      const url =
        CARDAPIO_API_URL +
        "/orders" +
        "?updated_since=" +
        encodeURIComponent(
          updatedSince
        ) +
        "&page=" +
        page +
        "&per_page=100";

      console.log(
        "Consultando página:",
        page
      );

      console.log(
        "URL:",
        url
      );

      const result =
        await requestOrders(url);

      const response =
        result.response;

      const text =
        result.text;

      if (!response.ok) {

        console.error(
          "Erro Cardápio Web:",
          response.status
        );

        console.error(text);

        if (page === 1) {
          return;
        }

        break;
      }

      let data;

      try {
        data = JSON.parse(text);
      } catch (error) {

        console.error(
          "A resposta da API não é JSON:"
        );

        console.error(text);

        return;
      }

      console.log(
        "Resposta recebida:"
      );

      console.log(
        JSON.stringify(data)
      );

      const pedidos =
        extractOrders(data);

      console.log(
        "Pedidos recebidos na página " +
        page +
        ":",
        pedidos.length
      );

      if (pedidos.length === 0) {
        break;
      }

      totalRecebidos +=
        pedidos.length;

      for (
        const pedido of pedidos
      ) {

        if (!pedido || !pedido.id) {
          continue;
        }

        const novo =
          saveOrder(pedido);

        if (novo) {
          totalNovos++;
        } else {
          totalAtualizados++;
        }
      }

      if (pedidos.length < 100) {
        break;
      }
    }

    saveData();

    console.log(
      "Total recebidos pela API:",
      totalRecebidos
    );

    console.log(
      "Novos pedidos:",
      totalNovos
    );

    console.log(
      "Pedidos atualizados:",
      totalAtualizados
    );

    console.log(
      "TOTAL DE PEDIDOS HOJE:",
      getTotalToday()
    );

    console.log(
      "CONTADORES:",
      JSON.stringify(
        getCounters()
      )
    );

    broadcast();

  } catch (error) {

    console.error(
      "Erro ao consultar /orders:",
      error.message
    );
  }
}

/* =========================
   WEBHOOK
========================= */

app.post(
  "/webhook/cardapioweb",
  (req, res) => {

    try {

      const event =
        req.body;

      console.log(
        "Webhook recebido:",
        JSON.stringify(event)
      );

      if (!event.order_id) {

        return res
          .status(400)
          .json({
            error:
              "order_id não informado"
          });
      }

      const id =
        String(event.order_id);

      const existente =
        orders[id] || {};

      orders[id] = {

        ...existente,

        id:
          event.order_id,

        status:
          event.order_status ||
          existente.status,

        event_type:
          event.event_type ||
          existente.event_type,

        created_at:
          existente.created_at ||
          event.created_at,

        updated_at:
          new Date().toISOString()
      };

      saveData();

      console.log(
        "Pedido atualizado pelo webhook:",
        id
      );

      console.log(
        "Status:",
        orders[id].status
      );

      console.log(
        "TOTAL DE PEDIDOS HOJE:",
        getTotalToday()
      );

      broadcast();

      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "Erro no webhook:",
        error.message
      );

      res
        .status(500)
        .json({
          error:
            "Erro interno"
        });
    }
  }
);

/* =========================
   SSE
========================= */

app.get(
  "/events",
  (req, res) => {

    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.flushHeaders();

    clients.add(res);

    const message =
      "data: " +
      JSON.stringify(
        dashboardData()
      ) +
      "\n\n";

    res.write(message);

    req.on(
      "close",
      () => {
        clients.delete(res);
      }
    );
  }
);

/* =========================
   API DASHBOARD
========================= */

app.get(
  "/api/dashboard",
  (req, res) => {

    res.json(
      dashboardData()
    );
  }
);

/* =========================
   HEALTH
========================= */

app.get(
  "/health",
  (req, res) => {

    res.json({

      status:
        "ok",

      total_today:
        getTotalToday(),

      counters:
        getCounters(),

      webhook:
        true,

      api_configurada:
        !!CARDAPIO_API_KEY,

      pedidos_salvos:
        Object.keys(
          orders
        ).length
    });
  }
);

/* =========================
   SERVIDOR
========================= */

app.listen(
  PORT,
  async () => {

    console.log(
      "========================================"
    );

    console.log(
      "Contador rodando na porta " +
      PORT
    );

    console.log(
      "API configurada:",
      !!CARDAPIO_API_KEY
    );

    console.log(
      "========================================"
    );

    await syncOrders();

    setInterval(
      syncOrders,
      30000
    );
  }
);
```
