const express = require("express");

const app = express();

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.CARDAPIO_API_KEY;

const MERCHANT_ID = "51038";

let pedidos = {};
let clientes = [];

let ultimaSincronizacao = null;
let ultimoErro = null;
let sincronizando = false;


/*
==================================================
DATA / HORA - BRASIL
==================================================
*/

function getTodayString() {
  const agora = new Date();

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(agora);
}


/*
==================================================
VERIFICA SE É HOJE
==================================================
*/

function isToday(dateString) {
  if (!dateString) return false;

  try {
    let data;

    /*
    Se a API mandar uma data sem timezone,
    tratamos como horário de São Paulo.
    */

    if (
      typeof dateString === "string" &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateString)
    ) {
      data = new Date(
        dateString.replace(" ", "T") + "-03:00"
      );
    }

    else if (
      typeof dateString === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateString)
    ) {
      data = new Date(
        dateString + "-03:00"
      );
    }

    else {
      data = new Date(dateString);
    }

    if (isNaN(data.getTime())) {
      return false;
    }

    const dataBrasil = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(data);

    return dataBrasil === getTodayString();

  } catch (erro) {
    console.error(
      "Erro ao interpretar data:",
      dateString,
      erro.message
    );

    return false;
  }
}


/*
==================================================
EXTRAIR PEDIDOS DA RESPOSTA
==================================================
*/

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

  if (
    data.data &&
    Array.isArray(data.data.orders)
  ) {
    return data.data.orders;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (
    data.result &&
    Array.isArray(data.result.orders)
  ) {
    return data.result.orders;
  }

  return [];
}


/*
==================================================
IDENTIFICAR ID DO PEDIDO
==================================================
*/

function getOrderId(pedido) {
  if (!pedido) return null;

  return (
    pedido.id ||
    pedido.order_id ||
    pedido.uuid ||
    pedido.code ||
    null
  );
}


/*
==================================================
CONSULTAR CARDÁPIO WEB
==================================================
*/

async function consultarPedidos(page = 1) {

  if (!API_KEY) {
    throw new Error(
      "CARDAPIO_API_KEY não configurada."
    );
  }

  const url = new URL(
    "https://integracao.cardapioweb.com/api/partner/v1/orders"
  );

  url.searchParams.set(
    "page",
    String(page)
  );

  console.log(
    `Consultando API - página ${page}...`
  );

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

  let data;

  try {

    data = JSON.parse(texto);

  } catch (erro) {

    throw new Error(
      `Resposta inválida da Cardápio Web: ${texto.substring(0, 500)}`
    );
  }

  return data;
}


/*
==================================================
DESCOBRIR INFORMAÇÕES DE PAGINAÇÃO
==================================================
*/

function getPaginationInfo(data) {

  if (!data || typeof data !== "object") {
    return {};
  }

  const possiveis = [
    data.pagination,
    data.meta,
    data.paging,
    data.data?.pagination,
    data.data?.meta,
    data.data?.paging
  ];

  for (const info of possiveis) {

    if (
      info &&
      typeof info === "object"
    ) {
      return info;
    }
  }

  return {};
}


/*
==================================================
SINCRONIZAÇÃO
==================================================
*/

async function sincronizar() {

  if (sincronizando) {

    console.log(
      "Sincronização anterior ainda está rodando. Ignorando esta."
    );

    return;
  }

  sincronizando = true;

  try {

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "INICIANDO SINCRONIZAÇÃO"
    );
    console.log(
      "Hoje no Brasil:",
      getTodayString()
    );
    console.log(
      "=========================================="
    );

    /*
    Não apagamos a memória imediatamente.

    Montamos uma nova coleção e só substituímos
    a antiga quando a sincronização terminar com sucesso.
    */

    const novosPedidos = {};

    let pagina = 1;
    let totalRecebido = 0;
    let paginasProcessadas = 0;

    const paginasVistas = new Set();

    /*
    Limite de segurança.
    Evita loop infinito caso a API fique
    repetindo a mesma página.
    */

    const MAX_PAGINAS = 1000;

    while (pagina <= MAX_PAGINAS) {

      const data = await consultarPedidos(pagina);

      const lista = extractOrders(data);

      const pagination =
        getPaginationInfo(data);

      console.log(
        `Página ${pagina}: ${lista.length} pedidos`
      );

      /*
      Se não veio nenhum pedido,
      terminamos.
      */

      if (lista.length === 0) {
        console.log(
          "Página vazia. Fim da paginação."
        );

        break;
      }

      paginasProcessadas++;

      totalRecebido += lista.length;


      /*
      Detectar página repetida.
      */

      const idsDaPagina = lista
        .map(getOrderId)
        .filter(Boolean)
        .map(String);

      const assinaturaPagina =
        idsDaPagina.join(",");

      if (
        assinaturaPagina &&
        paginasVistas.has(assinaturaPagina)
      ) {

        console.log(
          "Página repetida detectada. Encerrando paginação."
        );

        break;
      }

      if (assinaturaPagina) {
        paginasVistas.add(
          assinaturaPagina
        );
      }


      /*
      Salvar pedidos.
      */

      for (const pedido of lista) {

        const id = getOrderId(pedido);

        if (!id) {

          console.log(
            "Pedido sem ID encontrado:",
            JSON.stringify(pedido).substring(0, 300)
          );

          continue;
        }

        novosPedidos[String(id)] = {
          ...(novosPedidos[String(id)] || {}),
          ...pedido
        };
      }


      /*
      ==========================================
      VERIFICAR PAGINAÇÃO DA API
      ==========================================
      */

      const currentPage =
        Number(
          pagination.current_page ??
          pagination.currentPage ??
          pagination.page ??
          pagina
        );

      const lastPage =
        Number(
          pagination.last_page ??
          pagination.lastPage ??
          pagination.total_pages ??
          pagination.totalPages ??
          0
        );


      /*
      Se a API informar explicitamente
      a última página.
      */

      if (
        lastPage > 0 &&
        currentPage >= lastPage
      ) {

        console.log(
          `Última página informada pela API: ${lastPage}`
        );

        break;
      }


      /*
      Verificar next_page.
      */

      const nextPage =
        pagination.next_page ??
        pagination.nextPage ??
        pagination.next;


      if (
        nextPage === null ||
        nextPage === false
      ) {

        console.log(
          "API informou que não existe próxima página."
        );

        break;
      }


      /*
      Se existe next_page numérico.
      */

      if (
        typeof nextPage === "number"
      ) {

        pagina = nextPage;
        continue;
      }


      /*
      Se existe next_page como string numérica.
      */

      if (
        typeof nextPage === "string" &&
        /^\d+$/.test(nextPage)
      ) {

        pagina = Number(nextPage);
        continue;
      }


      /*
      ==========================================
      FALLBACK
      ==========================================
      
      Caso a API não forneça informações de
      paginação, continuamos enquanto houver
      pedidos.

      NÃO usamos mais "< 100".
      */

      pagina++;

    }


    /*
    ==========================================
    SINCRONIZAÇÃO CONCLUÍDA
    ==========================================
    */

    pedidos = novosPedidos;

    ultimaSincronizacao =
      new Date().toISOString();

    ultimoErro = null;


    const todos = Object.values(pedidos);

    const hoje = todos.filter(
      pedido =>
        isToday(
          pedido.created_at ||
          pedido.createdAt ||
          pedido.date ||
          pedido.created
        )
    );


    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "SINCRONIZAÇÃO CONCLUÍDA"
    );

    console.log(
      "PÁGINAS:",
      paginasProcessadas
    );

    console.log(
      "PEDIDOS RECEBIDOS:",
      totalRecebido
    );

    console.log(
      "PEDIDOS ÚNICOS:",
      todos.length
    );

    console.log(
      "PEDIDOS DE HOJE:",
      hoje.length
    );

    console.log(
      "=========================================="
    );


    broadcast();

  } catch (erro) {

    ultimoErro = {
      mensagem: erro.message,
      data: new Date().toISOString()
    };

    console.error("");
    console.error(
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    );

    console.error(
      "ERRO AO CONSULTAR CARDÁPIO WEB"
    );

    console.error(
      erro.message
    );

    console.error(
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    );

    /*
    MUITO IMPORTANTE:

    Não apagamos os pedidos anteriores
    quando a API falha.

    Assim o painel não vai zerar por causa
    de uma falha temporária.
    */

    broadcast();

  } finally {

    sincronizando = false;
  }
}


/*
==================================================
PEGAR DATA DO PEDIDO
==================================================
*/

function getOrderDate(pedido) {

  if (!pedido) return null;

  return (
    pedido.created_at ||
    pedido.createdAt ||
    pedido.date ||
    pedido.created ||
    pedido.order_date ||
    pedido.orderDate ||
    null
  );
}


/*
==================================================
DASHBOARD
==================================================
*/

function getDashboard() {

  const hoje = Object.values(pedidos).filter(
    pedido =>
      isToday(
        getOrderDate(pedido)
      )
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

    const status =
      pedido.status;

    if (
      counters[status] !== undefined
    ) {

      counters[status]++;
    }

  });


  return {

    total_today: hoje.length,

    counters,

    avg_prep_time: 0,

    active_orders:
      hoje.filter(
        pedido =>
          pedido.status !== "closed" &&
          pedido.status !== "canceled" &&
          pedido.status !== "delivered"
      ),

    ultima_sincronizacao:
      ultimaSincronizacao,

    ultimo_erro:
      ultimoErro

  };
}


/*
==================================================
SSE - BROADCAST
==================================================
*/

function broadcast() {

  const data =
    JSON.stringify(
      getDashboard()
    );


  clientes.forEach(cliente => {

    try {

      cliente.write(
        `data: ${data}\n\n`
      );

    } catch (erro) {

      /*
      Cliente morreu.
      Será removido pelo req.close.
      */

    }

  });

}


/*
==================================================
SSE
==================================================
*/

app.get("/events", (req, res) => {

  res.setHeader(
    "Content-Type",
    "text/event-stream"
  );

  res.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  res.setHeader(
    "Connection",
    "keep-alive"
  );

  res.setHeader(
    "X-Accel-Buffering",
    "no"
  );

  res.flushHeaders();


  /*
  Envia estado imediatamente.
  */

  res.write(
    `data: ${JSON.stringify(
      getDashboard()
    )}\n\n`
  );


  clientes.push(res);


  /*
  Heartbeat.

  Evita que proxy/hospedagem mate
  a conexão SSE por ficar parada.
  */

  const heartbeat =
    setInterval(() => {

      try {

        res.write(": heartbeat\n\n");

      } catch (erro) {}

    }, 15000);


  req.on("close", () => {

    clearInterval(heartbeat);

    clientes =
      clientes.filter(
        cliente =>
          cliente !== res
      );

  });

});


/*
==================================================
API DASHBOARD
==================================================
*/

app.get(
  "/api/dashboard",
  (req, res) => {

    res.json(
      getDashboard()
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

    const todos =
      Object.values(pedidos);

    const hoje =
      todos.filter(
        pedido =>
          isToday(
            getOrderDate(pedido)
          )
      );


    res.json({

      ok: true,

      servidor:
        "contador-pedidos",

      merchant_id:
        MERCHANT_ID,

      api_key_configurada:
        Boolean(API_KEY),

      pedidos_memoria:
        todos.length,

      pedidos_hoje:
        hoje.length,

      hoje_brasil:
        getTodayString(),

      sincronizando,

      ultima_sincronizacao:
        ultimaSincronizacao,

      ultimo_erro:
        ultimoErro,

      hora_servidor:
        new Date().toISOString()

    });

  }
);


/*
==================================================
 TESTE MANUAL
==================================================
*/

app.get(
  "/api/sincronizar",
  async (req, res) => {

    await sincronizar();

    res.json({
      ok: true,
      dashboard:
        getDashboard()
    });

  }
);


/*
==================================================
INICIAR SERVIDOR
==================================================
*/

app.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      `Contador rodando na porta ${PORT}`
    );

    console.log(
      "Merchant ID:",
      MERCHANT_ID
    );

    console.log(
      "API KEY:",
      API_KEY
        ? "CONFIGURADA"
        : "NÃO CONFIGURADA"
    );

    console.log(
      "Hoje Brasil:",
      getTodayString()
    );

    console.log(
      "=========================================="
    );


    /*
    Primeira sincronização.
    */

    sincronizar();

  }
);


/*
==================================================
ATUALIZA A CADA 30 SEGUNDOS
==================================================
*/

setInterval(
  sincronizar,
  30000
);
