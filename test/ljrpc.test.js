"use strict";
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { once } = require("node:events");
const { createServer } = require("node:http");
const { test } = require("node:test");
const { WebSocket } = require("ws");
const { attachLJRPC, path } = require("../src/ws/LJRPCGateway");

test("LJRPC forwards a null result and rejects a null error", { timeout: 10000 }, async () => {
  const server = createServer();
  const tokens = {
    lua: randomBytes(32).toString("hex"),
    client: randomBytes(32).toString("hex")
  };
  const relay = attachLJRPC(server, { luaToken: tokens.lua, clientToken: tokens.client });
  try {
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const url = "ws://127.0.0.1:" + server.address().port + path;
    async function connect(role) {
      const socket = new WebSocket(url);
      await once(socket, "open");
      const ready = read(socket);
      send(socket, { type: "hello", role, token: tokens[role] });
      assert.deepEqual(await ready, { type: "ready" });
      return socket;
    }

    const lua = await connect("lua");
    const client = await connect("client");
    async function call(id, reply) {
      const request = { jsonrpc: "2.0", id, method: "Eval", params: ["return nil"], argc: 1 };
      const received = read(lua);
      const response = read(client);
      send(client, request);
      assert.deepEqual(await received, request);
      send(lua, { jsonrpc: "2.0", id, ...reply });
      return response;
    }

    assert.deepEqual(await call("valid", { result: null }), { jsonrpc: "2.0", id: "valid", result: null });
    assert.deepEqual(await call("malformed", { error: null }), {
      jsonrpc: "2.0", id: "malformed", error: { code: -32002, message: "Lua disconnected" }
    });
  } finally {
    await relay.close();
    await new Promise(resolve => server.close(resolve));
  }
});

async function read(socket) {
  const [message] = await once(socket, "message");
  return JSON.parse(message.toString());
}

function send(socket, message) {
  socket.send(JSON.stringify(message));
}
