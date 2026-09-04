const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "data.json");

// Token do Cardápio Web
const CARDAPIO_API_KEY = process.env.CARDAPIO_API_KEY;

// API do Cardápio Web
const CARDAPIO_API_URL =
  "https://integracao.cardapioweb.com/api/partner/v1";

let orders = {};

const clients = new Set();

/* =========================
   BANCO LOCAL
========================= */

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      orders = {};
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    if (data.orders) {
      orders = data.orders;
    }
  } catch (error) {
    console.error(
      "Erro ao carregar data.json:",
      error
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
          orders
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "Erro ao salvar data.json:",
      error
    );
  }
}

loadData();

/* =========================
   STATUS
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

  for (const id in orders) {
    const order = orders[id];

    if (!order.status) {
      continue;
    }

    switch (order.status) {
      case "waiting_confirmation":
      case "pending_payment":
      case "pending_online_payment":
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
   TOTAL DE PEDIDOS DE HOJE
========================= */

function getTodayString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo"
  }).format(new Date());
}

function getTotalToday() {
  const hoje = getTodayString();

  let total = 0;

  for (const id in orders) {
    const order = orders[id];

    if (!order.created_at) {
      continue;
    }

    const dataPedido =
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo"
      }).format(
        new Date(order.created_at)
      );

    if (dataPedido === hoje) {
      total++;
    }
  }

  return total;
}

/* =========================
   DADOS DO PAINEL
========================= */

function dashboardData() {
  return {
    total_today: getTotalToday(),
    counters: getCounters()
  };
}

/* =========================
   ATUALIZAR PAINEL
========================= */

function broadcast() {
  const message =
    "data: " +
    JSON.stringify(dashboardData()) +
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
   SINCRONIZAR PEDIDOS
   API /orders
========================= */

async function syncOrders() {
  if (!CARDAPIO_API_KEY) {
    console.error(
      "CARDAPIO_API_KEY não configurada no Render."
    );

    return;
  }

  try {
    console.log(
      "Consultando pedidos no Cardápio Web..."
    );

    const url =
      CARDAPIO_API_URL +
      "/orders";

    const response = await fetch(url, {
      method: "GET",

      headers: {
        "X-API-KEY": CARDAPIO_API_KEY,
        "Accept": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(
        "Erro Cardápio Web:",
        response.status,
        text
      );

      return;
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      console.error(
        "Resposta inválida do Cardápio Web:",
        text
      );

      return;
    }

    const pedidos =
      data.orders || [];

    console.log(
      "Pedidos recebidos pela API:",
      pedidos.length
    );

    let novos = 0;
    let atualizados = 0;

    for (const pedido of pedidos) {
      if (!pedido.id) {
        continue;
      }

      const id = String(pedido.id);

      const existente =
        orders[id];

      orders[id] = {
        ...(existente || {}),
        ...pedido,

        id: pedido.id,

        status:
          pedido.status ||
          existente?.status,

        created_at:
          pedido.created_at ||
          existente?.created_at,

        updated_at:
          pedido.updated_at ||
          existente?.updated_at ||
          new Date().toISOString()
      };

      if (existente) {
        atualizados++;
      } else {
        novos++;
      }
    }

    saveData();

    console.log(
      "Novos pedidos:",
      novos
    );

    console.log(
      "Pedidos atualizados:",
      atualizados
    );

    console.log(
      "TOTAL DE PEDIDOS HOJE:",
      getTotalToday()
    );

    broadcast();

  } catch (error) {
    console.error(
      "Erro ao consultar /orders:",
      error
    );
  }
}

/* =========================
   WEBHOOK CARDÁPIO WEB
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
        return res.status(400).json({
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

        id: event.order_id,

        status:
          event.order_status ||
          existente.status,

        event_type:
          event.event_type,

        created_at:
          existente.created_at ||
          event.created_at,

        updated_at:
          new Date().toISOString()
      };

      saveData();

      broadcast();

      res.json({
        success: true
      });

    } catch (error) {
      console.error(
        "Erro no webhook:",
        error
      );

      res.status(500).json({
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
   API DO PAINEL
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
   HEALTH CHECK
========================= */

app.get(
  "/health",
  (req, res) => {

    res.json({
      status: "ok",

      total_today:
        getTotalToday(),

      webhook: true,

      api_configurada:
        !!CARDAPIO_API_KEY,

      pedidos_salvos:
        Object.keys(orders).length
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
      "Contador rodando na porta " +
      PORT
    );

    console.log(
      "API configurada:",
      !!CARDAPIO_API_KEY
    );

    // Sincroniza imediatamente
    await syncOrders();

    // Atualiza a cada 30 segundos
    setInterval(
      syncOrders,
      30000
    );
  }
);
