const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const STATUS = {
  waiting_confirmation: "aguardando",
  pending_payment: "aguardando",
  pending_online_payment: "aguardando",
  scheduled_confirmed: "em_preparo",
  confirmed: "em_preparo",
  ready: "prontos",
  released: "em_entrega",
  waiting_to_catch: "prontos_retirada",
  delivered: "entregues",
  canceling: "cancelados",
  canceled: "cancelados",
  closed: "finalizados"
};

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { orders: {}, eventIds: {} };
  }
}

let db = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(getStats())}\n\n`;
  for (const res of clients) res.write(payload);
}

function localDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function getStats() {
  const today = localDate();
  const counts = {
    aguardando: 0,
    em_preparo: 0,
    prontos: 0,
    prontos_retirada: 0,
    em_entrega: 0,
    entregues: 0,
    cancelados: 0,
    finalizados: 0
  };

  const activeOrders = [];
  let totalToday = 0;

  for (const order of Object.values(db.orders)) {
    if (localDate(order.created_at) === today) totalToday++;
    const bucket = STATUS[order.status] || "aguardando";
    if (bucket in counts) counts[bucket]++;

    if (["aguardando","em_preparo","prontos","prontos_retirada","em_entrega"].includes(bucket)) {
      activeOrders.push({
        id: order.id,
        display_id: order.display_id,
        status: order.status,
        bucket,
        created_at: order.created_at,
        updated_at: order.updated_at
      });
    }
  }

  activeOrders.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

  return {
    updated_at: new Date().toISOString(),
    total_today: totalToday,
    counts,
    active_orders: activeOrders
  };
}

function updateOrder(event) {
  if (!event || !event.order_id || !event.order_status) return false;

  // Deduplicação: a Cardápio Web informa que event_id é único e deve
  // ser usado para evitar processar retentativas mais de uma vez.
  if (event.event_id && db.eventIds[event.event_id]) return false;

  const key = String(event.order_id);
  const previous = db.orders[key] || {};

  db.orders[key] = {
    id: Number(event.order_id),
    display_id: previous.display_id ?? Number(event.order_id),
    merchant_id: event.merchant_id ?? previous.merchant_id ?? null,
    status: event.order_status,
    created_at: previous.created_at || event.created_at || new Date().toISOString(),
    updated_at: event.created_at || new Date().toISOString()
  };

  if (event.event_id) db.eventIds[event.event_id] = true;

  // Evita crescimento infinito do arquivo de IDs.
  const ids = Object.keys(db.eventIds);
  if (ids.length > 10000) {
    for (const id of ids.slice(0, ids.length - 5000)) delete db.eventIds[id];
  }

  saveData();
  broadcast();
  return true;
}

function authorized(req) {
  if (!WEBHOOK_SECRET) return true;
  const supplied = req.headers["x-webhook-secret"] || "";
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(WEBHOOK_SECRET));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, code, obj) {
  res.writeHead(code, {"Content-Type": "application/json; charset=utf-8"});
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, {error:"forbidden"});

  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, {error:"not_found"});
    const ext = path.extname(file);
    const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
    res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/stats") {
    return sendJson(res, 200, getStats());
  }

  if (req.method === "GET" && req.url === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(`data: ${JSON.stringify(getStats())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/webhook/cardapioweb") {
    if (!authorized(req)) return sendJson(res, 401, {error:"unauthorized"});

    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        const event = JSON.parse(body);
        updateOrder(event);
        return sendJson(res, 200, {ok:true});
      } catch {
        return sendJson(res, 400, {error:"invalid_json"});
      }
    });
    return;
  }

  if (req.method === "GET") return serveStatic(req, res);
  return sendJson(res, 405, {error:"method_not_allowed"});
});

server.listen(PORT, () => {
  console.log(`Painel rodando em http://localhost:${PORT}`);
  console.log(`Webhook: POST http://localhost:${PORT}/webhook/cardapioweb`);
});
