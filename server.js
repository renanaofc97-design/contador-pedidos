const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, "data.json");

const API_KEY = process.env.CARDAPIO_API_KEY;
const MERCHANT_ID = "51038";

let orders = {};
let clients = [];

/*
==================================================
DATA / HISTÓRICO
==================================================
*/

function getTodayString() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

let dailyStats = {
  date: getTodayString(),
  prepTimes: {},
  deliveryTimes: {}
};

function resetDailyStatsIfNeeded() {
  const hoje = getTodayString();

  if (!dailyStats || dailyStats.date !== hoje) {
    console.log("Novo dia detectado. Iniciando histórico:", hoje);

    dailyStats = {
      date: hoje,
      prepTimes: {},
      deliveryTimes: {}
    };
  }

  if (!dailyStats.prepTimes) {
    dailyStats.prepTimes = {};
  }

  if (!dailyStats.deliveryTimes) {
    dailyStats.deliveryTimes = {};
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log("data.json ainda não existe.");
      resetDailyStatsIfNeeded();
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    if (data && data.orders) {
      orders = data.orders;
    }

    if (data && data.dailyStats) {
      dailyStats = data.dailyStats;
    }

    resetDailyStatsIfNeeded();

    rebuildDailyStatsFromOrders();

    console.log(
      "Pedidos carregados:",
      Object.keys(orders).length
    );

    console.log(
      "Tempos de preparo carregados:",
      Object.keys(dailyStats.prepTimes).length
    );

  } catch (error) {
    console.error(
      "Erro ao carregar data.json:",
      error.message
    );
  }
}

function saveData() {
  try {
    resetDailyStatsIfNeeded();

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          orders,
          dailyStats
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

/*
==================================================
DATA
==================================================
*/

function isToday(dateString) {
  if (!dateString) {
    return false;
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return (
    `${year}-${month}-${day}` ===
    getTodayString()
  );
}

/*
==================================================
SALVAR PEDIDO
==================================================
*/

function saveOrder(pedido) {
  if (!pedido) {
    return null;
  }

  const id =
    pedido.id ||
    pedido.order_id ||
    pedido.code;

  if (!id) {
    return null;
  }

  const existente =
    orders[id] || {};

  orders[id] = {
    ...existente,
    ...pedido,

    id: id,

    created_at:
      existente.created_at ||
      pedido.created_at ||
      null,

    ready_at:
      existente.ready_at ||
      pedido.ready_at ||
      null,

    prep_time_minutes:
      existente.prep_time_minutes ??
      pedido.prep_time_minutes ??
      null,

    released_at:
      existente.released_at ||
      pedido.released_at ||
      null,

    delivered_at:
      existente.delivered_at ||
      pedido.delivered_at ||
      null,

    delivery_time_minutes:
      existente.delivery_time_minutes ??
      pedido.delivery_time_minutes ??
      null
  };

  return orders[id];
}

/*
==================================================
RECONSTRUIR HISTÓRICO
==================================================
*/

function rebuildDailyStatsFromOrders() {
  resetDailyStatsIfNeeded();

  let prepCount = 0;
  let deliveryCount = 0;

  for (const id in orders) {
    const order = orders[id];

    if (!order) {
      continue;
    }

    if (!order.created_at) {
      continue;
    }

    if (!isToday(order.created_at)) {
      continue;
    }

    const prep =
      Number(order.prep_time_minutes);

    if (
      Number.isFinite(prep) &&
      prep >= 0 &&
      prep <= 180
    ) {
      dailyStats.prepTimes[id] = prep;
      prepCount++;
    }

    const delivery =
      Number(order.delivery_time_minutes);

    if (
      Number.isFinite(delivery) &&
      delivery >= 0 &&
      delivery <= 240
    ) {
      dailyStats.deliveryTimes[id] = delivery;
      deliveryCount++;
    }
  }

  console.log("Histórico reconstruído.");

  console.log(
    "Tempos de preparo:",
    prepCount
  );

  console.log(
    "Tempos de entrega:",
    deliveryCount
  );
}

/*
==================================================
TEMPO DE PREPARO
==================================================
*/

function registerReady(
  order,
  eventCreatedAt
) {
  if (!order) {
    return;
  }

  resetDailyStatsIfNeeded();

  if (
    order.ready_at &&
    Number.isFinite(
      Number(order.prep_time_minutes)
    )
  ) {
    dailyStats.prepTimes[order.id] =
      Number(order.prep_time_minutes);

    return;
  }

  if (!order.created_at) {
    console.log(
      "Pedido sem created_at:",
      order.id
    );

    return;
  }

  const readyAt =
    eventCreatedAt ||
    new Date().toISOString();

  const inicio =
    new Date(
      order.created_at
    ).getTime();

  const fim =
    new Date(
      readyAt
    ).getTime();

  if (
    !Number.isFinite(inicio) ||
    !Number.isFinite(fim) ||
    fim <= inicio
  ) {
    console.log(
      "Tempo de preparo inválido:",
      order.id,
      "created_at:",
      order.created_at,
      "ready_at:",
      readyAt
    );

    return;
  }

  const minutos =
    (fim - inicio) / 60000;

  if (
    minutos < 0 ||
    minutos > 180
  ) {
    console.log(
      "Tempo de preparo ignorado:",
      order.id,
      "=>",
      minutos,
      "min"
    );

    return;
  }

  order.ready_at =
    readyAt;

  order.prep_time_minutes =
    Number(
      minutos.toFixed(2)
    );

  dailyStats.prepTimes[order.id] =
    order.prep_time_minutes;

  console.log(
    "========================================"
  );

  console.log(
    "TEMPO DE PREPARO REGISTRADO:",
    order.id,
    "=>",
    order.prep_time_minutes,
    "min"
  );

  console.log(
    "TOTAL DE TEMPOS DE PREPARO HOJE:",
    Object.keys(
      dailyStats.prepTimes
    ).length
  );

  console.log(
    "========================================"
  );
}

/*
==================================================
BUSCAR PEDIDO COMPLETO NA API
==================================================
*/

async function findOrderInApi(orderId) {
  if (!API_KEY) {
    return null;
  }

  try {
    const updatedSince =
      new Date(
        Date.now() -
        8 * 60 * 60 * 1000
      ).toISOString();

    for (
      let page = 1;
      page <= 10;
      page++
    ) {
      const data =
        await requestOrders(
          updatedSince,
          page
        );

      const pedidos =
        extractOrders(data);

      if (
        pedidos.length === 0
      ) {
        break;
      }

      for (
        const pedido of pedidos
      ) {
        const id =
          pedido.id ||
          pedido.order_id ||
          pedido.code;

        if (
          String(id) ===
          String(orderId)
        ) {
          return pedido;
        }
      }

      if (
        pedidos.length < 100
      ) {
        break;
      }
    }

  } catch (error) {
    console.error(
      "Erro buscando pedido na API:",
      orderId,
      error.message
    );
  }

  return null;
}

/*
==================================================
ENTREGA
==================================================
*/

function registerReleased(
  order,
  eventCreatedAt
) {
  if (!order) {
    return;
  }

  if (order.released_at) {
    return;
  }

  const releasedAt =
    eventCreatedAt ||
    new Date().toISOString();

  order.released_at =
    releasedAt;

  console.log(
    "SAÍDA PARA ENTREGA REGISTRADA:",
    order.id,
    "=>",
    releasedAt
  );
}

function registerDelivered(
  order,
  eventCreatedAt
) {
  if (!order) {
    return;
  }

  if (!order.released_at) {
    console.log(
      "Pedido entregue sem released_at:",
      order.id
    );

    if (!order.delivered_at) {
      order.delivered_at =
        eventCreatedAt ||
        new Date().toISOString();
    }

    return;
  }

  if (order.delivered_at) {
    return;
  }

  const deliveredAt =
    eventCreatedAt ||
    new Date().toISOString();

  const inicio =
    new Date(
      order.released_at
    ).getTime();

  const fim =
    new Date(
      deliveredAt
    ).getTime();

  if (
    !Number.isFinite(inicio) ||
    !Number.isFinite(fim) ||
    fim <= inicio
  ) {
    console.log(
      "Tempo de entrega inválido:",
      order.id
    );

    return;
  }

  const minutos =
    (fim - inicio) / 60000;

  if (
    minutos < 0 ||
    minutos > 240
  ) {
    console.log(
      "Tempo de entrega ignorado:",
      order.id,
      "=>",
      minutos,
      "min"
    );

    return;
  }

  order.delivered_at =
    deliveredAt;

  order.delivery_time_minutes =
    Number(
      minutos.toFixed(2)
    );

  resetDailyStatsIfNeeded();

  dailyStats.deliveryTimes[order.id] =
    order.delivery_time_minutes;

  console.log(
    "TEMPO DE ENTREGA REGISTRADO:",
    order.id,
    "=>",
    order.delivery_time_minutes,
    "min"
  );
}

/*
==================================================
MÉDIA DE PREPARO
==================================================
*/

function getAveragePrepTime() {
  resetDailyStatsIfNeeded();

  const tempos =
    Object.values(
      dailyStats.prepTimes
    )
      .map(Number)
      .filter(
        (tempo) =>
          Number.isFinite(tempo) &&
          tempo >= 0 &&
          tempo <= 180
      );

  console.log(
    "MÉDIA PREPARO - quantidade:",
    tempos.length
  );

  if (
    tempos.length === 0
  ) {
    return 0;
  }

  const soma =
    tempos.reduce(
      (total, tempo) =>
        total + tempo,
      0
    );

  return Number(
    (soma / tempos.length).toFixed(1)
  );
}

/*
==================================================
MÉDIA DE ENTREGA
==================================================
*/

function getAverageDeliveryTime() {
  resetDailyStatsIfNeeded();

  const tempos =
    Object.values(
      dailyStats.deliveryTimes
    )
      .map(Number)
      .filter(
        (tempo) =>
          Number.isFinite(tempo) &&
          tempo >= 0 &&
          tempo <= 240
      );

  if (
    tempos.length === 0
  ) {
    return 0;
  }

  const soma =
    tempos.reduce(
      (total, tempo) =>
        total + tempo,
      0
    );

  return Number(
    (soma / tempos.length).toFixed(1)
  );
}

/*
==================================================
CONTADORES
==================================================

ATENÇÃO:
Esses nomes precisam ser exatamente iguais
aos nomes usados pelo HTML.
==================================================
*/

function getCounters() {
  const counters = {
    aguardando: 0,
    em_preparo: 0,
    prontos: 0,
    em_entrega: 0,
    entregues: 0
  };

  for (const id in orders) {
    const order =
      orders[id];

    if (!order) {
      continue;
    }

    if (
      !isToday(
        order.created_at
      )
    ) {
      continue;
    }

    const status =
      order.status;

    /*
    ================================================
    AGUARDANDO
    ================================================
    */

    if (
      status === "waiting_confirmation" ||
      status === "pending_payment" ||
      status === "pending_online_payment" ||
      status === "waiting_payment"
    ) {
      counters.aguardando++;
      continue;
    }

    /*
    ================================================
    EM PREPARO
    ================================================
    */

    if (
      status === "confirmed" ||
      status === "scheduled_confirmed"
    ) {
      counters.em_preparo++;
      continue;
    }

    /*
    ================================================
    PRONTOS
    ================================================
    */

    if (
      status === "ready" ||
      status === "waiting_to_catch"
    ) {
      counters.prontos++;
      continue;
    }

    /*
    ================================================
    EM ENTREGA
    ================================================
    */

    if (
      status === "released" ||
      status === "out_for_delivery"
    ) {
      counters.em_entrega++;
      continue;
    }

    /*
    ================================================
    ENTREGUES
    ================================================
    */

    if (
      status === "delivered" ||
      status === "closed"
    ) {
      counters.entregues++;
      continue;
    }
  }

  return counters;
}

/*
==================================================
TOTAL DE PEDIDOS HOJE
==================================================
*/

function getTotalToday() {
  let total = 0;

  for (const id in orders) {
    const order =
      orders[id];

    if (!order) {
      continue;
    }

    if (
      isToday(
        order.created_at
      )
    ) {
      total++;
    }
  }

  return total;
}

/*
==================================================
PEDIDOS ATIVOS
==================================================
*/

function getActiveOrders() {
  const ativos = [];

  for (const id in orders) {
    const order =
      orders[id];

    if (!order) {
      continue;
    }

    if (
      !isToday(
        order.created_at
      )
    ) {
      continue;
    }

    const status =
      order.status;

    if (
      status === "canceled" ||
      status === "closed" ||
      status === "delivered"
    ) {
      continue;
    }

    ativos.push(order);
  }

  ativos.sort(
    (a, b) => {
      const dateA =
        new Date(
          a.created_at
        ).getTime();

      const dateB =
        new Date(
          b.created_at
        ).getTime();

      return dateA - dateB;
    }
  );

  return ativos;
}

/*
==================================================
DASHBOARD
==================================================
*/

function dashboardData() {
  return {
    total_today:
      getTotalToday(),

    counters:
      getCounters(),

    avg_prep_time:
      getAveragePrepTime(),

    avg_delivery_time:
      getAverageDeliveryTime(),

    active_orders:
      getActiveOrders()
  };
}

/*
==================================================
SSE
==================================================
*/

function broadcast() {
  const data =
    JSON.stringify(
      dashboardData()
    );

  clients.forEach(
    (client) => {
      try {
        client.write(
          `data: ${data}\n\n`
        );
      } catch (error) {
        // cliente desconectado
      }
    }
  );
}

/*
==================================================
EXTRAIR PEDIDOS
==================================================
*/

function extractOrders(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (
    Array.isArray(
      data.orders
    )
  ) {
    return data.orders;
  }

  if (
    Array.isArray(
      data.data
    )
  ) {
    return data.data;
  }

  if (
    data.data &&
    Array.isArray(
      data.data.orders
    )
  ) {
    return data.data.orders;
  }

  if (
    Array.isArray(
      data.results
    )
  ) {
    return data.results;
  }

  return [];
}

/*
==================================================
REQUISIÇÃO API CARDÁPIO WEB
==================================================
*/

async function requestOrders(
  updatedSince = null,
  page = 1
) {
  if (!API_KEY) {
    throw new Error(
      "CARDAPIO_API_KEY não configurada"
    );
  }

  const url =
    new URL(
      "https://integracao.cardapioweb.com/api/partner/v1/orders"
    );

  url.searchParams.set(
    "page",
    String(page)
  );

  if (updatedSince) {
    url.searchParams.set(
      "updated_since",
      updatedSince
    );
  }

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "X-API-KEY": API_KEY,
          "Accept":
            "application/json"
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Cardápio Web ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Resposta inválida da API Cardápio Web"
    );
  }
}

/*
==================================================
SINCRONIZAÇÃO
==================================================
*/

async function syncOrders() {
  try {
    console.log(
      "Consultando pedidos no Cardápio Web..."
    );

    const updatedSince =
      new Date(
        Date.now() -
        8 * 60 * 60 * 1000
      ).toISOString();

    let totalRecebidos = 0;
    let novos = 0;
    let atualizados = 0;

    for (
      let page = 1;
      page <= 10;
      page++
    ) {
      let data;

      try {
        data =
          await requestOrders(
            updatedSince,
            page
          );

      } catch (error) {
        console.error(
          "Erro na página",
          page,
          ":",
          error.message
        );

        break;
      }

      const pedidos =
        extractOrders(data);

      console.log(
        `Página ${page}: ${pedidos.length} pedidos`
      );

      if (
        pedidos.length === 0
      ) {
        break;
      }

      totalRecebidos +=
        pedidos.length;

      for (
        const pedido of pedidos
      ) {
        const id =
          pedido.id ||
          pedido.order_id ||
          pedido.code;

        if (!id) {
          continue;
        }

        const existia =
          Boolean(
            orders[id]
          );

        const order =
          saveOrder(
            pedido
          );

        if (existia) {
          atualizados++;
        } else {
          novos++;
        }

        const status =
          pedido.status;

        const evento =
          pedido.updated_at ||
          pedido.created_at ||
          new Date().toISOString();

        /*
        ============================================
        PREPARO
        ============================================
        */

        if (
          status === "ready" ||
          status ===
            "waiting_to_catch"
        ) {
          registerReady(
            order,
            evento
          );
        }

        /*
        ============================================
        ENTREGA
        ============================================
        */

        if (
          status === "released" ||
          status ===
            "out_for_delivery"
        ) {
          registerReleased(
            order,
            evento
          );
        }

        if (
          status === "delivered" ||
          status === "closed"
        ) {
          registerDelivered(
            order,
            evento
          );
        }
      }

      if (
        pedidos.length < 100
      ) {
        break;
      }
    }

    saveData();

    console.log(
      "Pedidos recebidos pela API:",
      totalRecebidos
    );

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

    console.log(
      "CONTADORES:",
      JSON.stringify(
        getCounters()
      )
    );

    console.log(
      "========================================"
    );

    console.log(
      "TEMPOS DE PREPARO ARMAZENADOS HOJE:",
      Object.keys(
        dailyStats.prepTimes
      ).length
    );

    console.log(
      "TEMPO MÉDIO DE PREPARO:",
      getAveragePrepTime(),
      "min"
    );

    console.log(
      "========================================"
    );

    broadcast();

  } catch (error) {
    console.error(
      "Erro ao sincronizar pedidos:",
      error.message
    );
  }
}

/*
==================================================
WEBHOOK
==================================================
*/

app.post(
  "/webhook/cardapioweb",
  async (req, res) => {
    try {
      const event =
        req.body;

      console.log(
        "Webhook recebido:",
        JSON.stringify(event)
      );

      if (
        String(
          event.merchant_id
        ) !==
        String(
          MERCHANT_ID
        )
      ) {
        console.log(
          "Webhook ignorado: merchant_id diferente"
        );

        return res
          .status(200)
          .json({
            ok: true,
            ignored: true
          });
      }

      const orderId =
        event.order_id;

      if (!orderId) {
        return res
          .status(200)
          .json({
            ok: true
          });
      }

      const status =
        event.order_status;

      const eventTime =
        event.created_at ||
        new Date().toISOString();

      let order =
        orders[orderId];

      /*
      ================================================
      PEDIDO NOVO NO WEBHOOK
      ================================================
      */

      if (!order) {
        let pedidoApi = null;

        if (
          status === "ready" ||
          status === "waiting_to_catch"
        ) {
          console.log(
            "Pedido não estava na memória.",
            "Buscando created_at original na API:",
            orderId
          );

          pedidoApi =
            await findOrderInApi(
              orderId
            );
        }

        if (pedidoApi) {
          console.log(
            "Pedido encontrado na API:",
            orderId,
            "created_at:",
            pedidoApi.created_at
          );

          order =
            saveOrder(
              pedidoApi
            );

          order.status =
            status;

        } else {
          console.log(
            "Pedido não encontrado na API:",
            orderId
          );

          order =
            saveOrder({
              id: orderId,
              status: status,
              created_at:
                status === "ready" ||
                status ===
                  "waiting_to_catch"
                  ? null
                  : eventTime
            });
        }

      } else {
        order.status =
          status;
      }

      /*
      ================================================
      PREPARO
      ================================================
      */

      if (
        status === "ready" ||
        status ===
          "waiting_to_catch"
      ) {
        if (
          !order.created_at
        ) {
          console.log(
            "Tentando recuperar created_at para:",
            orderId
          );

          const pedidoApi =
            await findOrderInApi(
              orderId
            );

          if (
            pedidoApi &&
            pedidoApi.created_at
          ) {
            order.created_at =
              pedidoApi.created_at;

            console.log(
              "created_at recuperado:",
              orderId,
              "=>",
              order.created_at
            );
          }
        }

        registerReady(
          order,
          eventTime
        );
      }

      /*
      ================================================
      ENTREGA
      ================================================
      */

      if (
        status === "released" ||
        status ===
          "out_for_delivery"
      ) {
        registerReleased(
          order,
          eventTime
        );
      }

      if (
        status === "delivered" ||
        status === "closed"
      ) {
        registerDelivered(
          order,
          eventTime
        );
      }

      /*
      ================================================
      SALVAR
      ================================================
      */

      saveData();

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

      console.log(
        "TEMPOS DE PREPARO ARMAZENADOS:",
        Object.keys(
          dailyStats.prepTimes
        ).length
      );

      console.log(
        "TEMPO MÉDIO DE PREPARO:",
        getAveragePrepTime(),
        "min"
      );

      broadcast();

      return res
        .status(200)
        .json({
          ok: true
        });

    } catch (error) {
      console.error(
        "Erro no webhook:",
        error.message
      );

      return res
        .status(200)
        .json({
          ok: true
        });
    }
  }
);

/*
==================================================
EVENTOS SSE
==================================================
*/

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

    res.write(
      `data: ${JSON.stringify(
        dashboardData()
      )}\n\n`
    );

    clients.push(res);

    req.on(
      "close",
      () => {
        clients =
          clients.filter(
            (client) =>
              client !== res
          );
      }
    );
  }
);

/*
==================================================
DASHBOARD
==================================================
*/

app.get(
  "/api/dashboard",
  (req, res) => {
    res.json(
      dashboardData()
    );
  }
);

/*
==================================================
HEALTH
==================================================
*/

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,

      total_today:
        getTotalToday(),

      counters:
        getCounters(),

      avg_prep_time:
        getAveragePrepTime(),

      avg_delivery_time:
        getAverageDeliveryTime(),

      prep_times_today:
        Object.keys(
          dailyStats.prepTimes
        ).length,

      orders:
        Object.keys(
          orders
        ).length,

      clients:
        clients.length,

      time:
        new Date().toISOString()
    });
  }
);

/*
==================================================
INICIAR
==================================================
*/

loadData();

app.listen(
  PORT,
  () => {
    console.log(
      `Contador rodando na porta ${PORT}`
    );

    console.log(
      "Pedidos carregados:",
      Object.keys(
        orders
      ).length
    );

    console.log(
      "Tempos de preparo carregados:",
      Object.keys(
        dailyStats.prepTimes
      ).length
    );

    console.log(
      "TEMPO MÉDIO DE PREPARO INICIAL:",
      getAveragePrepTime(),
      "min"
    );

    console.log(
      "CONTADORES INICIAIS:",
      JSON.stringify(
        getCounters()
      )
    );

    console.log(
      "Consultando total de pedidos..."
    );

    syncOrders();
  }
);

/*
==================================================
SINCRONIZA A CADA 30 SEGUNDOS
==================================================
*/

setInterval(
  syncOrders,
  30000
);
