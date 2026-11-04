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
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ status: "ok", build: "eggs-ws-v1", reporting: "ready", ...service.gateway.info() }));
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
  createServer().listen(port, "0.0.0.0", () => console.log("M4GIX-WS listening on " + port));
}

module.exports = { createServer };
