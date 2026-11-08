"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { mountAutoSAE } = require("./src");
const { createDashboardAuth } = require("./src/DashboardAuth");

function createServer(options = {}) {
  const dashboardAuth = options.dashboardAuth === false ? null : createDashboardAuth(options.dashboardAuth);
  const server = http.createServer((req, res) => {
    const route = (req.url || "/").split("?")[0];
    if (route === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ status: "ok", reporting: "ready", dashboardAuthentication: dashboardAuth?.configured === true }));
      return;
    }
    if (dashboardAuth && dashboardAuth.handle(req, res)) return;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return;
    }
    const nativeImage=route.match(/^\/eggs-native\/(\d+\.png)$/);
    if(nativeImage){
      fs.readFile(path.join(__dirname,"public","eggs-native",nativeImage[1]),(error,content)=>{
        if(error){res.writeHead(error.code==="ENOENT"?404:500);res.end();return;}
        res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public, max-age=86400"});
        res.end(req.method==="HEAD"?undefined:content);
      });
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
  const service = mountAutoSAE(server, { ...options, gateway: { ...options.gateway, dashboardAuth } });
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


