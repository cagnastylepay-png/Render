"use strict";
const { timingSafeEqual } = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const path = "/ljrpc/ws";

function attachLJRPC(server, { luaToken = process.env.LJRPC_LUA_TOKEN, clientToken = process.env.LJRPC_CLIENT_TOKEN } = {}) {
  const enabled = typeof luaToken === "string" && typeof clientToken === "string" &&
    luaToken.length >= 32 && clientToken.length >= 32 && luaToken !== clientToken;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const peers = {};
  let pending;

  function send(ws, value) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  }
  function fail(ws, id, code, message) {
    send(ws, { jsonrpc: "2.0", id, error: { code, message } });
  }
  function finish() {
    const request = pending;
    pending = undefined;
    if (request) clearTimeout(request.timer);
    return request;
  }
  function upgrade(req, socket, head) {
    if (req.url !== path) return;
    if (!enabled || wss.clients.size >= 8) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  }

  server.on("upgrade", upgrade);
  wss.on("connection", ws => {
    ws.alive = true;
    let role;
    const handshake = setTimeout(() => ws.terminate(), 5000);
    handshake.unref();
    ws.on("pong", () => { ws.alive = true; });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(handshake);
      if (!role || peers[role] !== ws) return;
      delete peers[role];
      const request = finish();
      if (request && role === "lua") fail(peers.client, request.id, -32002, "Lua disconnected");
      if (request && role === "client") peers.lua?.terminate();
    });
    ws.on("message", (raw, binary) => {
      let message;
      try { message = JSON.parse(raw); } catch { return ws.close(1008, "Invalid JSON"); }
      if (binary || !message || typeof message !== "object") return ws.close(1008, "Invalid frame");
      if (!role) {
        const expected = message.role === "lua" ? luaToken : message.role === "client" ? clientToken : null;
        const token = Buffer.from(typeof message.token === "string" ? message.token : "");
        const secret = Buffer.from(expected ?? "");
        if (message.type !== "hello" || !expected || token.length !== secret.length ||
          !timingSafeEqual(token, secret) || peers[message.role]) return ws.close(1008, "Connection refused");
        clearTimeout(handshake);
        role = message.role;
        peers[role] = ws;
        return send(ws, { type: "ready" });
      }
      if (message.jsonrpc !== "2.0" || typeof message.id !== "string" || !message.id.length || message.id.length > 64)
        return ws.close(1008, "Invalid RPC envelope");
      if (role === "lua") {
        if (!pending || pending.id !== message.id) return;
        const hasResult = Object.hasOwn(message, "result");
        const hasError = Object.hasOwn(message, "error");
        if (hasResult === hasError ||
            (hasError && (!message.error || !Number.isInteger(message.error.code) || typeof message.error.message !== "string")))
          return ws.close(1008, "Invalid RPC response");
        finish();
        return send(peers.client, message);
      }
      if (typeof message.method !== "string" || !/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(message.method) ||
          !Array.isArray(message.params) || message.params.length > 32 || message.argc !== message.params.length)
        return fail(ws, message.id, -32600, "Invalid request");
      if (pending) return ws.close(1008, "Only one call can be in flight");
      if (peers.lua?.readyState !== WebSocket.OPEN) return fail(ws, message.id, -32002, "Lua disconnected");
      const timer = setTimeout(() => {
        finish();
        peers.lua?.terminate();
        fail(ws, message.id, -32003, "Lua timed out");
      }, 30000);
      timer.unref();
      pending = { id: message.id, timer };
      send(peers.lua, message);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else { ws.alive = false; ws.ping(); }
    }
  }, 25000);
  heartbeat.unref();
  return {
    close() {
      finish();
      clearInterval(heartbeat);
      server.removeListener("upgrade", upgrade);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve, reject) => wss.close(err => err ? reject(err) : resolve()));
    }
  };
}

module.exports = { attachLJRPC, path };
