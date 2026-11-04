"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { mountAutoSAE } = require("./src");

function createServer(options = {}) {
  const server = http.createServer((req, res) => {
    const route = (req.url || "/").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return;
    }
    if (route === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ status: "ok", build: "eggs-players-v2", reporting: "ready", historyStorage: service.history.state().storage, ...service.gateway.info() }));
      return;
    }
    const image = route.match(/^\/eggs\/([a-z0-9-]+\.webp)$/);
    if (image) {
      fs.readFile(path.join(__dirname, "public", "eggs", image[1]), (error, content) => {
        if (error) { res.writeHead(error.code === "ENOENT" ? 404 : 500); res.end(); return; }
        res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" });
        res.end(req.method === "HEAD" ? undefined : content);
      });
      return;
    }
    if (route === "/" || route === "/eggs" || route === "/index.html") {
      fs.readFile(path.join(__dirname, "public", "index.html"), (error, content) => {
        if (error) { res.writeHead(500); res.end("Page unavailable"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(req.method === "HEAD" ? undefined : content);
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : "Not found");
  });
  const service = mountAutoSAE(server, options);
  server.on("close", () => service.close());
  server.autoSAE = service;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, "0.0.0.0", () => console.log("M4GIX-WS listening on " + port));
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    await server.autoSAE.close();
    server.close(() => process.exit(0));
  }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

module.exports = { createServer };
