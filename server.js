// server.js
import http from "http";
import { WebSocketServer } from "ws";
import { URL } from "url";

const PORT = process.env.PORT || 3000;

/**
 * users: ws -> { name, type }
 * plotCache: name -> animals[]
 */
const users = new Map();
const plotCache = new Map();

let systemSocket = null;

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "OK" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const name = searchParams.get("user") || "anonymous";
  const type = searchParams.get("type") || "Client";

  if (type === "System") {
    if (systemSocket && systemSocket.readyState === ws.OPEN) {
      systemSocket.close(1000, "Replaced");
    }
    systemSocket = ws;
  }

  users.set(ws, { name, type });
  console.log(`🔌 ${type} connected: ${name}`);

  notifySystem({ type: "user_connected", name, userType: type });
  sendClientListToSystem();

  ws.on("message", raw => handleMessage(ws, raw));
  ws.on("close", () => handleDisconnect(ws));
  ws.on("error", () => handleDisconnect(ws));
});

function handleMessage(ws, raw) {
  if (raw.length > 200_000) return;

  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const user = users.get(ws);
  if (!user || !payload.type) return;

  if (payload.type === "get_clients" && user.type === "System") {
    sendClientListToSystem();
    return;
  }

  if (payload.type === "plot_update" && user.type === "Client") {
    if (!Array.isArray(payload.animals)) return;

    // Stockage par client name
    plotCache.set(user.name, payload.animals);

    console.log(`📦 plot_update from ${user.name} (${payload.animals.length})`);

    // Envoi complet du payload directement au System
    notifySystem(payload);
  }
}

function handleDisconnect(ws) {
  const user = users.get(ws);
  if (!user) return;

  users.delete(ws);
  plotCache.delete(user.name);

  if (user.type === "System") systemSocket = null;

  console.log(`❌ ${user.type} disconnected: ${user.name}`);

  notifySystem({ type: "user_disconnected", name: user.name, userType: user.type });
  sendClientListToSystem();
}

function notifySystem(obj) {
  if (!systemSocket || systemSocket.readyState !== systemSocket.OPEN) return;
  systemSocket.send(JSON.stringify(obj));
}

function sendClientListToSystem() {
  if (!systemSocket || systemSocket.readyState !== systemSocket.OPEN) return;

  const list = [];
  for (const user of users.values()) {
    if (user.type !== "System") list.push({ name: user.name, type: user.type });
  }

  systemSocket.send(JSON.stringify({ type: "clients", clients: list }));
}

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
