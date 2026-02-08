// server.js
import http from "http";
import { WebSocketServer } from "ws";
import { URL } from "url";

const PORT = process.env.PORT || 3000;

/**
 * Users registry
 * key: WebSocket
 * value: { name: string, type: 'System' | 'Admin' | 'Client' }
 */
const users = new Map();
let systemSocket = null; // unique System

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
  const type = searchParams.get("type") || "Client"; // System, Admin, Client

  // Handle unique System
  if (type === "System") {
    if (systemSocket && systemSocket.readyState === ws.OPEN) {
      console.log(`[System] Closing old System connection`);
      systemSocket.close(1000, "New connection replacing old");
    }
    systemSocket = ws;
  }

  users.set(ws, { name, type });
  console.log(`🔌 ${type} connected: ${name}`);

  // Notify System on connection
  if (type !== "System" && systemSocket && systemSocket.readyState === ws.OPEN) {
    systemSocket.send(JSON.stringify({ type: "user_connected", name, userType: type }));
    sendClientListToSystem();
  }

  ws.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (type === "System" && payload.type === "get_clients") {
      sendClientListToSystem();
    }

    // Admin or Client messages can be handled here later
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
  console.log(`❌ ${user.type} disconnected: ${user.name}`);

  if (user.type === "System") {
    systemSocket = null;
    console.log(`[System] System socket cleared`);
  } else {
    if (systemSocket && systemSocket.readyState === systemSocket.OPEN) {
      systemSocket.send(JSON.stringify({ type: "user_disconnected", name: user.name, userType: user.type }));
      sendClientListToSystem();
    }
  }
}

function sendClientListToSystem() {
  if (!systemSocket || systemSocket.readyState !== systemSocket.OPEN) return;

  const clients = [];
  for (const user of users.values()) {
    if (user.type !== "System") clients.push({ name: user.name, type: user.type });
  }

  systemSocket.send(JSON.stringify({ type: "clients", clients }));
}

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
