"use strict";

const { createHmac, createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const COOKIE = "sea_dashboard";
const TTL = 12 * 60 * 60 * 1000;
const digest = value => createHash("sha256").update(value).digest();

function createDashboardAuth({ password = process.env.SECRET_MDP || "", now = Date.now } = {}) {
  const expected = digest(password);
  const attempts = new Map();
  const sign = value => createHmac("sha256", expected).update("sea-dashboard-v1:" + value).digest("base64url");
  function sameOrigin(req) {
    if (!req.headers.origin) return false;
    try {
      const origin = new URL(req.headers.origin);
      const protocol = String(req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")).split(",")[0].trim();
      return origin.host === req.headers.host && origin.protocol === protocol + ":";
    } catch { return false; }
  }
  function authenticated(req) {
    if (!password) return false;
    const cookie = String(req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="));
    const token = cookie?.slice(COOKIE.length + 1) || "";
    const match = token.match(/^(\d{13})\.([a-zA-Z0-9_-]{22})\.([a-zA-Z0-9_-]{43})$/);
    if (!match) return false;
    const expires = Number(match[1]);
    if (expires <= now() || expires > now() + TTL) return false;
    const mac = Buffer.from(sign(match[1] + "." + match[2]));
    const supplied = Buffer.from(match[3]);
    return supplied.length === mac.length && timingSafeEqual(supplied, mac);
  }
  function page(res, status, message = "") {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"
    });
    res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M4GIX — Connexion</title><style>body{background:#0d111a;color:#e7edf8;font:17px system-ui;display:grid;place-items:center;min-height:90vh}main{max-width:360px;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:1px solid #47536a}button{background:#b0fa75;color:#182112;font-weight:bold}p{color:#afbdd0}</style><main><h1>M4GIX</h1><p>Accès privé au tableau de bord.</p><form method="post" action="/login"><label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button>Se connecter</button></form><p role="status">' + message + '</p></main></html>');
  }
  function handle(req, res) {
    const route = (req.url || "/").split("?")[0];
    if (!password) { page(res, 503, "Accès indisponible : SECRET_MDP doit être configuré sur Render."); return true; }
    if (route === "/login" && req.method === "POST") {
      if (!sameOrigin(req) || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers["content-type"] || "")) {
        page(res, 403, "Requête refusée."); return true;
      }
      // Render appends the connecting address to X-Forwarded-For. Never trust its first entry.
      const key = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",").at(-1).trim();
      const time = now();
      for (const [ip, row] of attempts) if (row.until <= time) attempts.delete(ip);
      const row = attempts.get(key) || { count: 0, until: time + 60000 };
      if (row.count >= 10 || (!attempts.has(key) && attempts.size >= 10000)) {
        res.setHeader("Retry-After", "60"); page(res, 429, "Trop de tentatives. Réessaie dans une minute."); req.resume(); return true;
      }
      row.count++; attempts.set(key, row);
      let body = "", size = 0, ended = false;
      req.on("data", chunk => {
        size += chunk.length;
        if (size > 4096 && !ended) { ended = true; page(res, 413, "Requête trop longue."); }
        if (!ended) body += chunk.toString("utf8");
      });
      req.on("end", () => {
        if (ended) return;
        const supplied = new URLSearchParams(body).get("password") || "";
        if (!timingSafeEqual(digest(supplied), expected)) { page(res, 401, "Mot de passe incorrect."); return; }
        attempts.delete(key);
        const value = String(now() + TTL) + "." + randomBytes(16).toString("base64url");
        const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store", "Set-Cookie": COOKIE + "=" + value + "." + sign(value) + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + TTL / 1000 + (secure ? "; Secure" : "") });
        res.end();
      });
      return true;
    }
    if (!authenticated(req)) { page(res, req.method === "GET" || req.method === "HEAD" ? 200 : 401); return true; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    return false;
  }
  return { handle, authenticated, sameOrigin, configured: Boolean(password) };
}
module.exports = { createDashboardAuth };
