"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { createServer } = require("../server");
const { createDashboardAuth } = require("../src/DashboardAuth");

async function fixture(t, auth = { password: "test-password" }) {
  const server = createServer({ dashboardAuth: auth, history: { uri: null, filePath: null }, gateway: {
    reportToken: "", viewerToken: "", delivery: { uri: null, filePath: null }, logs: { uri: null }, settings: { uri: null }
  } });
  const sockets = [];
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { for (const socket of sockets) socket.terminate(); await server.autoSAE.close(); await new Promise(resolve => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const login = (password, origin = base, extra = {}) => fetch(base + "/login", {
    method: "POST", redirect: "manual", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...extra },
    body: new URLSearchParams({ password })
  });
  async function socket(role, cookie, origin = base) {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/sae/ws", { headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
    sockets.push(ws); const frames = [];
    ws.on("message", raw => frames.push(JSON.parse(raw)));
    await once(ws, "open");
    const outcome = new Promise(resolve => {
      ws.on("close", code => resolve({ code, frames }));
      ws.on("message", raw => { const message = JSON.parse(raw); if (message.type === "hello.ack") resolve({ ws, message, frames }); });
    });
    ws.send(JSON.stringify({ version: 1, type: "hello", role, observerOnly: role === "reporter" }));
    return outcome;
  }
  return { base, login, socket };
}

test("private HTML and WebSocket require a valid login; reporters remain available", { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const loginPage = await fetch(f.base);
  assert.equal(loginPage.headers.get("referrer-policy"), "same-origin", "the browser must retain Origin on the same-origin login form POST");
  const locked = await loginPage.text();
  assert.match(locked, /Mot de passe/); assert.doesNotMatch(locked, /id="cards"/);
  assert.match(await (await fetch(f.base + "/index.html")).text(), /Mot de passe/);
  const denied = await f.socket("viewer");
  assert.equal(denied.code, 1008); assert.equal(denied.frames.length, 0);
  assert.equal((await f.socket("reporter")).message.type, "hello.ack");
  assert.equal((await f.login("wrong")).status, 401);
  assert.equal((await f.login("test-password", "null")).status, 403);
  assert.equal((await f.login("test-password", "https://other.example")).status, 403);
  const response = await f.login("test-password");
  assert.equal(response.status, 303);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /test-password/);
  const cookie = setCookie.split(";")[0];
  const page = await fetch(f.base, { headers: { Cookie: cookie } });
  assert.match(await page.text(), /id="cards"/); assert.equal(page.headers.get("cache-control"), "no-store");
  const good = await f.socket("viewer", cookie); assert.equal(good.message.type, "hello.ack");
  assert.equal((await f.socket("viewer", cookie, "https://other.example")).code, 1008);
  const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
  assert.equal((await f.socket("viewer", tampered)).code, 1008);
  const health = await (await fetch(f.base + "/health")).json();
  assert.equal(health.status, "ok"); assert.equal(health.clients, undefined); assert.equal(health.favoriteClients, undefined);
});

test("missing SECRET_MDP fails closed for viewers and leaves health and reporting available", { timeout: 10000 }, async t => {
  const f = await fixture(t, { password: "" });
  assert.equal((await fetch(f.base)).status, 503);
  assert.equal((await f.socket("viewer")).code, 1008);
  assert.equal((await f.socket("reporter")).message.type, "hello.ack");
  assert.equal((await fetch(f.base + "/health")).status, 200);
});

test("login rate limiting, secure cookie, expiration and password rotation", { timeout: 10000 }, async t => {
  let clock = Date.now();
  const f = await fixture(t, { password: "test-password", now: () => clock });
  for (let i = 0; i < 10; i++) assert.equal((await f.login("wrong")).status, 401);
  assert.equal((await f.login("test-password")).status, 429);
  clock += 60001;
  const response = await f.login("test-password", f.base.replace("http:", "https:"), { "X-Forwarded-Proto": "https" });
  assert.equal(response.status, 303); assert.match(response.headers.get("set-cookie"), /; Secure/);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const req = { headers: { cookie } };
  const auth = createDashboardAuth({ password: "test-password", now: () => clock });
  assert.equal(auth.authenticated(req), true);
  assert.equal(createDashboardAuth({ password: "changed", now: () => clock }).authenticated(req), false);
  const active = await f.socket("viewer", cookie);
  clock += 12 * 60 * 60 * 1000 + 1;
  assert.equal(auth.authenticated(req), false);
  const closed = once(active.ws, "close");
  active.ws.send(JSON.stringify({ version: 1, type: "logs.clear" }));
  assert.equal((await closed)[0], 1008);
});
