"use strict";
const { text, metric, baseMessage } = require("./EggStore");
function validatePresence(message) {
  const base = baseMessage(message, "players.snapshot", "PlayerReporter");
  if (!Number.isSafeInteger(message.revision) || message.revision < 1) throw new Error("Invalid revision");
  if (!Array.isArray(message.players) || message.players.length > 200) throw new Error("Invalid players");
  const reporterUserId = text(message.reporterUserId, "reporterUserId", 32);
  const seen = new Set();
  const players = message.players.map(player => {
    const userId = text(player.userId, "userId", 32);
    if (seen.has(userId)) throw new Error("Duplicate player");
    seen.add(userId);
    return { userId, name: text(player.name, "name"), displayName: text(player.displayName, "displayName"),
      walkSpeed: metric(player.walkSpeed, "walkSpeed"), speedPower: metric(player.speedPower, "speedPower"),
      incomePerSecond: metric(player.incomePerSecond, "incomePerSecond"),
      incomeSource: player.incomeSource == null ? null : text(player.incomeSource, "incomeSource") };
  });
  if (!seen.has(reporterUserId)) throw new Error("Reporter missing from roster");
  return { ...base, revision: message.revision, reporterUserId, players };
}
function createPlayerStore({ now = Date.now, ttlMs = Infinity, maxSessions = 200 } = {}) {
  const sessions = new Map();
  const observations = new Map();
  function prune() {
    let changed = false;
    for (const [key, value] of sessions) if (now() - value.receivedAt > ttlMs) { sessions.delete(key); changed = true; }
    for (const [key,row] of observations) if(now()>=row.observationExpiresAt){observations.delete(key);changed=true;}
    return changed;
  }
  function accept(connectionId, input, {observerOnly=false}={}) {
    const snapshot = validatePresence(input);
    const previous = sessions.get(connectionId);
    if (previous && previous.snapshot.sessionId === snapshot.sessionId && previous.snapshot.revision >= snapshot.revision) return false;
    sessions.delete(connectionId);
    const row={snapshot,receivedAt:now()};
    if(observerOnly){
      row.observerSnapshot=true;row.observationExpiresAt=(Math.floor(now()/300000)+1)*300000;
      observations.set(JSON.stringify([snapshot.placeId,snapshot.jobId]),row);
      while(observations.size>maxSessions)observations.delete(observations.keys().next().value);
    }
    sessions.set(connectionId,row);
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value);
    return true;
  }
  function remove(connectionId) { return sessions.delete(connectionId); }
  function state() {
    prune();
    const servers = new Map(observations);
    const connected = new Set();
    for (const row of sessions.values()) {
      const s = row.snapshot, key = JSON.stringify([s.placeId, s.jobId]);
      const previous = servers.get(key);
      if (!previous || previous.receivedAt <= row.receivedAt) servers.set(key, row);
      connected.add(JSON.stringify([s.placeId, s.jobId, s.reporterUserId]));
    }
    const players = [];
    for (const row of servers.values()) {
      const s = row.snapshot;
      for (const player of s.players) players.push({ ...player, placeId: s.placeId, jobId: s.jobId,
        reporterConnected: connected.has(JSON.stringify([s.placeId, s.jobId, player.userId])),
        observerSnapshot:row.observerSnapshot===true,observationExpiresAt:row.observationExpiresAt||null,
        receivedAt: new Date(row.receivedAt).toISOString() });
    }
    players.sort((a,b) => Number(b.reporterConnected) - Number(a.reporterConnected) || a.name.localeCompare(b.name));
    return { version: 1, type: "players.state", serverTime: now(), sessionCount: sessions.size, players };
  }
  return { accept, remove, state, prune };
}
module.exports = { createPlayerStore, validatePresence };