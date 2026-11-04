"use strict";

const RARITIES = new Set(["Divine", "Eternal", "Secret"]);
function text(value, name, max = 160) {
  if (typeof value !== "string" || !value.length || value.length > max) throw new Error("Invalid " + name);
  return value;
}
function metric(value, name) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid " + name);
  return value;
}
function validateSnapshot(message) {
  if (!message || message.version !== 1 || message.type !== "eggs.snapshot" || message.moduleId !== "EggReporter")
    throw new Error("Unsupported message");
  const sessionId = text(message.sessionId, "sessionId");
  const placeId = text(message.placeId, "placeId");
  const jobId = text(message.jobId, "jobId");
  const cycleId = text(message.cycleId, "cycleId", 32);
  if (!/^\d+$/.test(cycleId) || !Number.isSafeInteger(Number(cycleId))) throw new Error("Invalid cycleId");
  if (!Number.isSafeInteger(message.revision) || message.revision < 1) throw new Error("Invalid revision");
  if (typeof message.observedAt !== "string" || !Number.isFinite(Date.parse(message.observedAt))) throw new Error("Invalid observedAt");
  if (!Array.isArray(message.eggs) || message.eggs.length > 200) throw new Error("Invalid eggs");
  const seen = new Set();
  const eggs = message.eggs.map(egg => {
    if (!egg || !RARITIES.has(egg.rarity)) throw new Error("Invalid rarity");
    const uid = text(egg.uid, "uid");
    if (seen.has(uid)) throw new Error("Duplicate UID");
    seen.add(uid);
    return { uid, category: text(egg.category, "category"), name: text(egg.name, "name", 240),
      rarity: egg.rarity, weightKg: metric(egg.weightKg, "weightKg"), incomePerSecond: metric(egg.incomePerSecond, "incomePerSecond") };
  });
  return { version: 1, type: "eggs.snapshot", moduleId: "EggReporter", sessionId, placeId, jobId, cycleId,
    revision: message.revision, observedAt: message.observedAt, eggs };
}
function createEggStore({ now = Date.now, ttlMs = 600000, maxServers = 100 } = {}) {
  const servers = new Map();
  function prune() {
    let changed = false;
    for (const [key, row] of servers) {
      if (now() - row.receivedAt > ttlMs) { servers.delete(key); changed = true; }
    }
    return changed;
  }
  function accept(input) {
    const snapshot = validateSnapshot(input);
    prune();
    const key = JSON.stringify([snapshot.placeId, snapshot.jobId]);
    const previous = servers.get(key);
    if (previous && Number(snapshot.cycleId) < Number(previous.snapshot.cycleId)) return false;
    const sameCycle = previous && previous.snapshot.cycleId === snapshot.cycleId;
    const revisions = sameCycle ? previous.revisions : new Map();
    if ((revisions.get(snapshot.sessionId) || 0) >= snapshot.revision) return false;
    revisions.delete(snapshot.sessionId);
    revisions.set(snapshot.sessionId, snapshot.revision);
    while (revisions.size > 32) revisions.delete(revisions.keys().next().value);
    // Latest complete observation for this server wins, including an empty snapshot.
    servers.delete(key);
    servers.set(key, { snapshot, revisions, receivedAt: now() });
    while (servers.size > maxServers) servers.delete(servers.keys().next().value);
    return true;
  }
  function state() {
    prune();
    const eggs = [];
    for (const { snapshot, receivedAt } of servers.values()) {
      for (const egg of snapshot.eggs) eggs.push({ ...egg, placeId: snapshot.placeId, jobId: snapshot.jobId,
        cycleId: snapshot.cycleId, observedAt: snapshot.observedAt, receivedAt: new Date(receivedAt).toISOString() });
    }
    eggs.sort((a, b) => (b.incomePerSecond ?? -1) - (a.incomePerSecond ?? -1) || b.receivedAt.localeCompare(a.receivedAt));
    return { version: 1, type: "eggs.state", serverCount: servers.size, eggs };
  }
  return { accept, state, prune };
}
module.exports = { createEggStore, validateSnapshot };
