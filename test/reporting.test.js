"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { createEggStore } = require("../src/store/EggStore");
const { createServer } = require("../server");

const egg = { uid: "egg-1", category: "Cat", name: "Cat Egg", rarity: "Eternal", weightKg: 123, incomePerSecond: 1 };
function snapshot(extra = {}) {
  return { version: 1, type: "eggs.snapshot", moduleId: "EggReporter", sessionId: "session-a",
    placeId: "123", jobId: "job-a", cycleId: "10", revision: 1, observedAt: new Date().toISOString(), eggs: [egg], ...extra };
}
test("store replaces snapshots, handles independent revisions, clears empty cycles and expires", () => {
  let clock = Date.now();
  const store = createEggStore({ now: () => clock, ttlMs: 100 });
  assert.equal(store.accept(snapshot()), true);
  assert.equal(store.accept(snapshot()), false);
  assert.equal(store.accept(snapshot({ sessionId: "session-b" })), true);
  assert.equal(store.state().eggs.length, 1);
  assert.equal(store.accept(snapshot({ cycleId: "9", revision: 2 })), false);
  assert.equal(store.accept(snapshot({ cycleId: "11", eggs: [] })), true);
  assert.equal(store.state().eggs.length, 0);
  assert.equal(store.accept(snapshot({ cycleId: "11", revision: 2, eggs: [{ ...egg, weightKg: null }] })), true);
  clock += 101;
  assert.equal(store.state().serverCount, 0);
  assert.throws(() => store.accept(snapshot({ eggs: [{ ...egg, rarity: "Common" }] })));
  assert.throws(() => store.accept(snapshot({ eggs: [{ ...egg, incomePerSecond: Infinity }] })));
});
async function connect(url, role, token) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  await once(ws, "open");
  ws.send(JSON.stringify({ version: 1, type: "hello", role, token }));
  return { ws, messages };
}
async function waitFor(predicate) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for WebSocket message");
}
test("real HTTP and WebSocket: auth, publish, broadcast, empty snapshot, viewer read-only, reconnect", async t => {
  const server = createServer({ gateway: { reportToken: "test-report", viewerToken: "test-view" } });
  const peers = [];
  t.after(async () => {
    for (const peer of peers) peer.ws.terminate();
    server.autoSAE.close();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const url = base.replace("http:", "ws:") + "/sae/ws";
  assert.equal((await (await fetch(base + "/health")).json()).reporting, "ready");
  assert.match(await (await fetch(base)).text(), /button.disabled=true/);
  const viewer = await connect(url, "viewer", "test-view"); peers.push(viewer);
  const reporter = await connect(url, "reporter", "test-report"); peers.push(reporter);
  await waitFor(() => reporter.messages.find(m => m.type === "hello.ack"));
  reporter.ws.send(JSON.stringify(snapshot()));
  await waitFor(() => reporter.messages.find(m => m.type === "eggs.ack" && m.accepted));
  await waitFor(() => viewer.messages.find(m => m.type === "eggs.state" && m.eggs.length === 1));
  viewer.ws.send(JSON.stringify(snapshot({ revision: 2 })));
  await waitFor(() => viewer.messages.find(m => m.type === "error" && /read-only/.test(m.message)));
  reporter.ws.send(JSON.stringify(snapshot({ revision: 2, eggs: [] })));
  await waitFor(() => viewer.messages.find(m => m.type === "eggs.state" && m.serverCount === 1 && !m.eggs.length));
  reporter.ws.close();
  const reporter2 = await connect(url, "reporter", "test-report"); peers.push(reporter2);
  await waitFor(() => reporter2.messages.find(m => m.type === "hello.ack"));
  reporter2.ws.send(JSON.stringify(snapshot({ revision: 3 })));
  await waitFor(() => reporter2.messages.find(m => m.type === "eggs.ack" && m.accepted));
  const invalid = new WebSocket(url); peers.push({ ws: invalid });
  await once(invalid, "open");
  invalid.send(JSON.stringify({ version: 1, type: "hello", role: "reporter", token: "wrong" }));
  const [code] = await once(invalid, "close");
  assert.equal(code, 1008);
});
