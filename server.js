const express = require("express");

const app = express();

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.CARDAPIO_API_KEY;

const MERCHANT_ID = "51038";

let pedidos = {};
let clientes = [];

function getTodayString() {
  const agora = new Date();

  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function isToday(dateString) {
  if (!dateString) return false;

  const data = new Date(dateString);

  if (isNaN(data.getTime())) return false;

  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}` === getTodayString();
}

function extractOrders(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.orders)) {
    return data.orders;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (data.data && Array.isArray(data.data.orders)) {
    return data.data.orders;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  return [];
}

/*
==================================================
API CARDÁPIO WEB
==================================================
*/

async function consultarPedidos(page = 1) {
  if (!API_KEY) {
    throw new Error("CARDAPIO_API_KEY não configurada.");
  }

  const url = new URL(
    "https://integracao.cardapioweb.com/api/partner/v1/orders"
  );

  url.searchParams.set("page", String(page));

  const resposta = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-KEY": API_KEY,
      "Accept": "application/json"
    }
  });

  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(
      `Cardápio Web ${resposta.status}: ${texto}`
    );
  }

  return JSON.parse(texto);
}

/*
==================================================
SINCRONIZAÇÃO
==================================================
*/

async function sincronizar() {
  try {
    console.log("");
    console.log("Consultando pedidos no Cardápio Web...");

    let total = 0;

    for (let pagina = 1; pagina <= 10; pagina++) {
      const data = await consultarPedidos(pagina);

      const lista = extractOrders(data);

      console.log(
        `Página ${pagina}: ${lista.length} pedidos`
      );

      if (lista.length === 0) {
        break;
      }

      total += lista.length;

      for (const pedido of lista) {
        const id =
          pedido.id ||
          pedido.order_id ||
          pedido.code;

        if (!id) continue;

        pedidos[id] = {
          ...(pedidos[id] || {}),
          ...pedido
        };
      }

      if (lista.length < 100) {
        break;
      }
    }

    console.log(
      "=========================================="
    );

    console.log(
      "TOTAL DE PEDIDOS RECEBIDOS:",
      total
    );

    console.log(
      "TOTAL DE PEDIDOS NA MEMÓRIA:",
      Object.keys(pedidos).length
    );

    console.log(
      "PEDIDOS DE HOJE:",
      Object.values(pedidos).filter(
        pedido =>
          isToday(pedido.created_at)
      ).length
    );

    console.log(
      "=========================================="
    );

    broadcast();

  } catch (erro) {
    console.error(
      "ERRO AO CONSULTAR CARDÁPIO WEB:",
      erro.message
    );
  }
}

/*
==================================================
DASHBOARD
==================================================
*/

function getDashboard() {
  const hoje = Object.values(pedidos).filter(
    pedido =>
      isToday(pedido.created_at)
  );

  const counters = {
    waiting_confirmation: 0,
    pending_payment: 0,
    pending_online_payment: 0,
    confirmed: 0,
    scheduled_confirmed: 0,
    ready: 0,
    waiting_to_catch: 0,
    released: 0
  };

  hoje.forEach(pedido => {
    if (
      counters[pedido.status] !== undefined
    ) {
      counters[pedido.status]++;
    }
  });

  return {
    total_today: hoje.length,

    counters,

    avg_prep_time: 0,

    active_orders: hoje.filter(
      pedido =>
        pedido.status !== "closed" &&
        pedido.status !== "canceled" &&
        pedido.status !== "delivered"
    )
  };
}

/*
==================================================
SSE
==================================================
*/

function broadcast() {
  const data = JSON.stringify(
    getDashboard()
  );

  clientes.forEach(cliente => {
    try {
      cliente.write(
        `data: ${data}\n\n`
      );
    } catch (erro) {}
  });
}

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

  res.write(
    `data: ${JSON.stringify(
      getDashboard()
    )}\n\n`
  );

  clientes.push(res);

  req.on("close", () => {
    clientes = clientes.filter(
      cliente => cliente !== res
    );
  });
});

/*
==================================================
API DASHBOARD
==================================================
*/

app.get("/api/dashboard", (req, res) => {
  res.json(
    getDashboard()
  );
});

/*
==================================================
HEALTH
==================================================
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,

    pedidos:
      Object.keys(pedidos).length,

    pedidos_hoje:
      Object.values(pedidos).filter(
        pedido =>
          isToday(
            pedido.created_at
          )
      ).length,

    hora:
      new Date().toISOString()
  });
});

/*
==================================================
INICIAR
==================================================
*/

app.listen(PORT, () => {
  console.log(
    `Contador rodando na porta ${PORT}`
  );

  sincronizar();
});

/*
==================================================
ATUALIZA A CADA 30 SEGUNDOS
==================================================
*/

setInterval(
  sincronizar,
  30000
);
