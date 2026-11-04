"use strict";
const { getEggImage } = require("../assets/EggImages");
const RARITIES = new Set(["Divine", "Eternal", "Secret", "Cosmic"]);
function text(value, name, max = 160) {
  if (typeof value !== "string" || !value.length || value.length > max) throw new Error("Invalid " + name);
  return value;
}
function metric(value, name, negative = false) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || (!negative && value < 0)) throw new Error("Invalid " + name);
  return value;
}
function baseMessage(message, type, moduleId) {
  if (!message || message.version !== 1 || message.type !== type || message.moduleId !== moduleId) throw new Error("Unsupported message");
  return { version: 1, type, moduleId, sessionId: text(message.sessionId, "sessionId"),
    placeId: text(message.placeId, "placeId"), jobId: text(message.jobId, "jobId") };
}
function point(value) {
  if (value == null) return null;
  const result = { x: metric(value.x, "x", true), y: metric(value.y, "y", true), z: metric(value.z, "z", true) };
  if (Object.values(result).some(n => n === null)) throw new Error("Invalid position");
  return result;
}
function validateSnapshot(message) {
  const base = baseMessage(message, "eggs.snapshot", "EggReporter");
  const cycleId = text(message.cycleId, "cycleId", 32);
  if (!/^\d+$/.test(cycleId) || !Number.isSafeInteger(Number(cycleId))) throw new Error("Invalid cycleId");
  if (!Number.isSafeInteger(message.revision) || message.revision < 1) throw new Error("Invalid revision");
  if (typeof message.observedAt !== "string" || !Number.isFinite(Date.parse(message.observedAt))) throw new Error("Invalid observedAt");
  if (!Array.isArray(message.eggs) || message.eggs.length > 500) throw new Error("Invalid eggs");
  const seen = new Set();
  const eggs = message.eggs.map(egg => {
    if (!egg || !RARITIES.has(egg.rarity)) throw new Error("Invalid rarity");
    const uid = text(egg.uid, "uid");
    if (seen.has(uid)) throw new Error("Duplicate UID");
    seen.add(uid);
    const item = { uid, category: text(egg.category, "category"), name: text(egg.name, "name", 240),
      rarity: egg.rarity, weightKg: metric(egg.weightKg, "weightKg"), incomePerSecond: metric(egg.incomePerSecond, "incomePerSecond"),
      sellValue: metric(egg.sellValue, "sellValue"), assetScale: metric(egg.assetScale, "assetScale"),
      position: point(egg.position), ownerUserId: metric(egg.ownerUserId, "ownerUserId"), carrierUserId: metric(egg.carrierUserId, "carrierUserId") };
    for (const key of ["state", "areaId", "zone", "baseMutation", "gender", "personality", "skin", "icon"]) {
      if (egg[key] != null) item[key] = text(egg[key], key, key === "icon" ? 500 : 160);
    }
    if (egg.mutations != null) {
      if (!Array.isArray(egg.mutations) || egg.mutations.length > 32) throw new Error("Invalid mutations");
      item.mutations = egg.mutations.map(value => text(value, "mutation", 100));
    }
    if (egg.cframe != null) {
      if (!Array.isArray(egg.cframe) || egg.cframe.length !== 12 || egg.cframe.some(n => typeof n !== "number" || !Number.isFinite(n))) throw new Error("Invalid cframe");
      item.cframe = egg.cframe;
    }
    for (const key of ["colorSeed", "colorIndex", "version", "nestScale", "droppedAt"]) item[key] = metric(egg[key], key, key === "colorSeed" || key === "colorIndex");
    for (const key of ["nestId", "eyeColor"]) if (egg[key] != null) item[key] = text(egg[key], key);
    item.hasParasite = egg.hasParasite === true;
    item.observationOnly = egg.observationOnly === true;
    return item;
  });
  return { ...base, cycleId, revision: message.revision, observedAt: message.observedAt, eggs,
    cycleEndsAt: metric(message.cycleEndsAt, "cycleEndsAt") };
}
function nextResetAt(now = Date.now()) { return (Math.floor(now / 300000) + 1) * 300000; }
function createEggStore({ now = Date.now, ttlMs = 600000, maxServers = 100 } = {}) {
  const servers = new Map();
  const revisions = new Map();
  const listeners = new Set();
  function events(rows) { for (const listener of listeners) listener(rows); }
  function decorate(egg, snapshot, receivedAt, expiresAt) {
    return { ...egg, imageUrl: getEggImage(egg), globalUid: snapshot.jobId + "/" + egg.uid, key: snapshot.placeId + "/" + snapshot.jobId + "/" + egg.uid,
      placeId: snapshot.placeId, jobId: snapshot.jobId, cycleId: snapshot.cycleId, expiresAt,
      observedAt: snapshot.observedAt, receivedAt: new Date(receivedAt).toISOString() };
  }
  function changes(previous, current, reason) {
    const before = new Map((previous?.snapshot.eggs || []).map(egg => [egg.uid, egg]));
    const after = new Map((current?.snapshot.eggs || []).map(egg => [egg.uid, egg]));
    const rows = [];
    for (const [uid, egg] of before) if (!after.has(uid)) rows.push({ action: "disappeared", reason,
      egg: decorate(egg, previous.snapshot, previous.receivedAt, previous.expiresAt) });
    for (const [uid, egg] of after) {
      const prior = before.get(uid);
      if (!prior) rows.push({ action: "appeared", reason, egg: decorate(egg, current.snapshot, current.receivedAt, current.expiresAt) });
      else if (prior.state !== egg.state || prior.carrierUserId !== egg.carrierUserId ||
        prior.weightKg !== egg.weightKg || prior.incomePerSecond !== egg.incomePerSecond)
        rows.push({ action: "updated", reason, egg: decorate(egg, current.snapshot, current.receivedAt, current.expiresAt) });
    }
    if (rows.length) events(rows);
  }
  function prune() {
    let changed = false;
    for (const [key, row] of servers) {
      if (now() - row.receivedAt > ttlMs || now() >= row.expiresAt) {
        servers.delete(key); changes(row, null, now() >= row.expiresAt ? "cycle-expired" : "stale");
        changed = true;
      }
    }
    for (const [key, row] of revisions) if (now() - row.at > ttlMs) revisions.delete(key);
    return changed;
  }
  function accept(input) {
    const snapshot = validateSnapshot(input);
    prune();
    const key = JSON.stringify([snapshot.placeId, snapshot.jobId]);
    const revKey = JSON.stringify([snapshot.placeId, snapshot.jobId, snapshot.sessionId, snapshot.cycleId]);
    const previous = servers.get(key);
    if (previous && Number(snapshot.cycleId) < Number(previous.snapshot.cycleId)) return false;
    if ((revisions.get(revKey)?.revision || 0) >= snapshot.revision) return false;
    const sentAt = Date.parse(snapshot.observedAt);
    if (Math.abs(now() - sentAt) > ttlMs) return false;
    const expiresAt = snapshot.cycleEndsAt == null ? nextResetAt(now()) : snapshot.cycleEndsAt * 1000;
    if (expiresAt <= now() || expiresAt > now() + 1200000) return false;
    revisions.delete(revKey); revisions.set(revKey, { revision: snapshot.revision, at: now() });
    while (revisions.size > 4000) revisions.delete(revisions.keys().next().value);
    const current = { snapshot, receivedAt: now(), expiresAt };
    servers.delete(key); servers.set(key, current);
    changes(previous, current, "observation");
    while (servers.size > maxServers) {
      const oldest = servers.keys().next().value;
      changes(servers.get(oldest), null, "capacity"); servers.delete(oldest);
    }
    return true;
  }
  function state() {
    prune();
    const eggs = [];
    for (const row of servers.values()) for (const egg of row.snapshot.eggs)
      eggs.push(decorate(egg, row.snapshot, row.receivedAt, row.expiresAt));
    eggs.sort((a, b) => (b.incomePerSecond ?? -1) - (a.incomePerSecond ?? -1) || b.receivedAt.localeCompare(a.receivedAt));
    return { version: 1, type: "eggs.state", serverTime: now(), nextResetAt: nextResetAt(now()), serverCount: servers.size, eggs };
  }
  return { accept, state, prune, onEvents(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
}
module.exports = { createEggStore, validateSnapshot, text, metric, baseMessage, nextResetAt };
