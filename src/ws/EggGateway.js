"use strict";

const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID, timingSafeEqual } = require("node:crypto");
function sameToken(provided, expected) {
  if (!expected) return true; // Explicit anonymous test mode when no token is configured.
  const a = Buffer.from(typeof provided === "string" ? provided : "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function attachEggGateway(server, store, players, history, { reportToken = process.env.SAE_REPORT_TOKEN || "", viewerToken = process.env.SAE_VIEW_TOKEN || "" } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1048576, perMessageDeflate: false });
  let closed = false;
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 8388608) { ws.close(1013, "Slow client"); return; }
    ws.send(JSON.stringify(message));
  }
  let broadcastTimer;
  function broadcast() {
    if (broadcastTimer || closed) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = undefined;
      const state = store.state(), presence = players.state();
      for (const ws of wss.clients) if (ws.role === "viewer") { send(ws, state); send(ws, presence); }
    }, 200);
    broadcastTimer.unref();
  }
  const unsubscribeEvents = store.onEvents(events => {
    const entries = history.append(events);
    for (const ws of wss.clients) if (ws.role === "viewer") {
      send(ws, { version: 1, type: "eggs.events", serverTime: Date.now(), events });
      send(ws, { version: 1, type: "history.append", entries });
    }
  });
  const unsubscribeHistory = history.onReady?.(() => {
    for (const ws of wss.clients) if (ws.role === "viewer") send(ws, history.state());
  }) || (() => {});
  function upgrade(req, socket, head) {
    if ((req.url || "").split("?")[0] !== "/sae/ws") { socket.destroy(); return; }
    if (wss.clients.size >= 200) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  }
  server.on("upgrade", upgrade);
  wss.on("connection", ws => {
    ws.connectionId = randomUUID();
    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });
    ws.on("error", () => {}); // Socket closure drives client retries.
    const handshake = setTimeout(() => ws.close(1008, "Hello required"), 10000);
    handshake.unref();
    ws.on("close", () => { clearTimeout(handshake); if (players.remove(ws.connectionId)) broadcast(); });
    let windowAt = Date.now(), messages = 0;
    ws.on("message", (raw, binary) => {
      try {
        if (binary) throw new Error("JSON text required");
        if (Date.now() - windowAt > 10000) { windowAt = Date.now(); messages = 0; }
        if (++messages > 20) { ws.close(1008, "Rate limit"); return; }
        const message = JSON.parse(raw.toString());
        if (!ws.role) {
          if (!message || message.version !== 1 || message.type !== "hello" || !["reporter", "viewer"].includes(message.role))
            throw new Error("Invalid hello");
          if (!sameToken(message.token, message.role === "reporter" ? reportToken : viewerToken)) {
            ws.close(1008, "Authentication failed"); return;
          }
          ws.role = message.role;
          clearTimeout(handshake);
          send(ws, { version: 1, type: "hello.ack", role: ws.role });
          if (ws.role === "viewer") { send(ws, store.state()); send(ws, players.state()); send(ws, history.state()); }
          return;
        }
        if (message.type === "ping") { send(ws, { version: 1, type: "pong" }); return; }
        if (ws.role !== "reporter") throw new Error("Viewer is read-only");
        if (message.type === "players.snapshot") {
          const accepted = players.accept(ws.connectionId, message);
          send(ws, { version: 1, type: "players.ack", revision: message.revision, accepted });
          if (accepted) broadcast();
          return;
        }
        const accepted = store.accept(message);
        send(ws, { version: 1, type: "eggs.ack", sessionId: message.sessionId, cycleId: message.cycleId,
          revision: message.revision, accepted });
        if (accepted) broadcast();
      } catch (error) {
        send(ws, { version: 1, type: "error", message: String(error.message).slice(0, 160) });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
    if (store.prune() || players.prune()) broadcast();
  }, 15000);
  heartbeat.unref();
  return {
    info: () => ({ clients: wss.clients.size, reportAuthentication: !!reportToken, viewerAuthentication: !!viewerToken }),
    close() {
      if (closed) return;
      closed = true;
      unsubscribeEvents();
      unsubscribeHistory();
      clearInterval(heartbeat); clearTimeout(broadcastTimer);
      server.removeListener("upgrade", upgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    }
  };
}
module.exports = { attachEggGateway, sameToken };
