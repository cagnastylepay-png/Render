// server.js
import http from "http";
import { WebSocketServer } from "ws";
import { URL } from "url";

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30_000;

/**
 * Users registry
 * key: WebSocket
 * value: { name: string, isAlive: boolean }
 */
const users = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "OK" }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const name = searchParams.get("user") || "anonymous";

  users.set(ws, { name, isAlive: true });

  ws.on("pong", () => {
    const user = users.get(ws);
    if (user) user.isAlive = true;
  });

  console.log(`🔌 ${name} connected`);

  if (name !== "System") {
    notifySystem({ type: "user_connected", name });
    sendClientListToSystem();
  }

  ws.on("message", (raw) => {
    let payload;

    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (name === "System" && payload.type === "get_clients") {
      sendClientListToSystem();
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });

  ws.on("error", () => {
    handleDisconnect(ws);
  });
});

function handleDisconnect(ws) {
  const user = users.get(ws);
  if (!user) return;

  users.delete(ws);

  console.log(`❌ ${user.name} disconnected`);

  if (user.name !== "System") {
    notifySystem({ type: "user_disconnected", name: user.name });
    sendClientListToSystem();
  }
}

function notifySystem(payload) {
  const message = JSON.stringify(payload);

  for (const [socket, user] of users) {
    if (user.name !== "System") continue;
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

function sendClientListToSystem() {
  const clients = [];

  for (const user of users.values()) {
    if (user.name !== "System") {
      clients.push(user.name);
    }
  }

  notifySystem({ type: "clients", clients });
}

setInterval(() => {
  for (const [ws, user] of users) {
    if (!user.isAlive) {
      ws.terminate();
      handleDisconnect(ws);
      continue;
    }

    user.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
