const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "data.json");

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
    console.error("Erro ao carregar data.json:", error);
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
    console.error("Erro ao salvar data.json:", error);
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

    if (!order.status) continue;

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
   TOTAL DE PEDIDOS
========================= */

function getTotalToday() {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo"
  }).format(new Date());

  let total = 0;

  for (const id in orders) {
    const order = orders[id];

    if (!order.created_at) continue;

    const dataPedido = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo"
    }).format(new Date(order.created_at));

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
   ATUALIZA PAINEL
========================= */

function broadcast() {
  const data =
    `data: ${JSON.stringify(dashboardData())}\n\n`;

  for (const client of clients) {
    try {
      client.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

/* =========================
   WEBHOOK CARDÁPIO WEB
========================= */

app.post(
  "/webhook/cardapioweb",
  (req, res) => {
    try {
      const event = req.body;

      console.log(
        "Webhook recebido:",
        JSON.stringify(event)
      );

      if (!event.order_id) {
        return res.status(400).json({
          error: "order_id não informado"
        });
      }

      const id = String(event.order_id);

      orders[id] = {
        id: event.order_id,
        status: event.order_status,
        event_type: event.event_type,
        created_at: event.created_at,
        updated_at: new Date().toISOString()
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
        error: "Erro interno"
      });
    }
  }
);

/* =========================
   SSE
========================= */

app.get("/events", (req, res) => {
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

  res.write(
    `data: ${JSON.stringify(
      dashboardData()
    )}\n\n`
  );

  req.on("close", () => {
    clients.delete(res);
  });
});

/* =========================
   API DO PAINEL
========================= */

app.get("/api/dashboard", (req, res) => {
  res.json(dashboardData());
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    total_today: getTotalToday(),
    webhook: true
  });
});

/* =========================
   SERVIDOR
========================= */

app.listen(PORT, () => {
  console.log(
    `Contador rodando na porta ${PORT}`
  );
});
