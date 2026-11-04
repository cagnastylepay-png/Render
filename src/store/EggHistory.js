"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
function createEggHistory({ filePath = null, maxEntries = 10000, now = Date.now } = {}) {
  let entries = [], timer, lastError = null;
  if (filePath && fs.existsSync(filePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(saved)) throw new Error("Invalid history file");
      entries = saved.filter(row => row && typeof row.id === "string" && row.egg && typeof row.at === "string").slice(-maxEntries);
    } catch (error) {
      lastError = error.message;
      fs.copyFileSync(filePath, filePath + ".invalid-" + Date.now());
      console.error("Egg history could not be loaded; preserved a backup");
    }
  }
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (!filePath) return true;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temp = filePath + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(entries));
      fs.renameSync(temp, filePath);
      lastError = null;
      return true;
    } catch (error) { lastError = error.message; console.error("Egg history save failed:", error.message); return false; }
  }
  function append(events) {
    const added = events.map(event => ({ id: randomUUID(), at: new Date(now()).toISOString(),
      action: event.action, reason: event.reason, egg: event.egg }));
    entries.push(...added);
    if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
    if (filePath && !timer) { timer = setTimeout(flush, 300); timer.unref(); }
    return added;
  }
  function state() {
    return { version: 1, type: "history.state", storage: filePath ? "disk" : "memory", total: entries.length, savedToDisk: !!filePath && !lastError,
      entries: entries.slice(-2000).reverse() };
  }
  return { append, state, flush, close: flush,
    hydrate(saved) {
      const merged = new Map([...saved, ...entries].map(row => [row.id, row]));
      entries = [...merged.values()].sort((a,b) => a.at.localeCompare(b.at)).slice(-maxEntries);
    }
  };
}
module.exports = { createEggHistory };
