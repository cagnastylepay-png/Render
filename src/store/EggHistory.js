"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
function historyIdentity(egg) {
  return createHash("sha256").update(JSON.stringify([egg.placeId||"",egg.jobId||egg.globalUid?.split("/")[0]||"",egg.uid||egg.globalUid||egg.key||"",String(egg.cycleId??"")])).digest("hex");
}
function deduplicateHistory(rows) {
  const unique=new Map();
  for(const row of rows.filter(keepHistoryEvent).sort((a,b)=>a.at.localeCompare(b.at))){
    const id=historyIdentity(row.egg);
    if(!unique.has(id))unique.set(id,{...row,id});
  }
  return [...unique.values()];
}
function keepHistoryEvent(row) {
  return row?.action === "appeared" && ["Divine", "Eternal"].includes(row.egg?.rarity);
}
function createEggHistory({ filePath = null, maxEntries = 10000, now = Date.now } = {}) {
  let entries = [], timer, lastError = null;
  if (filePath && fs.existsSync(filePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(saved)) throw new Error("Invalid history file");
      entries = deduplicateHistory(saved.filter(row => row && typeof row.id === "string" && row.egg && typeof row.at === "string")).slice(-maxEntries);
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
    const seen=new Set(entries.map(row=>row.id)),added=[];
    for(const event of events.filter(keepHistoryEvent)){
      const id=historyIdentity(event.egg);
      if(seen.has(id))continue;
      seen.add(id);added.push({id,at:new Date(now()).toISOString(),action:event.action,reason:event.reason,egg:event.egg});
    }
    if (!added.length) return added;
    entries.push(...added);
    if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
    if (filePath && !timer) { timer = setTimeout(flush, 300); timer.unref(); }
    return added;
  }
  function state() {
    return { version: 1, type: "history.state", storage: filePath ? "disk" : "memory", total: entries.length, savedToDisk: !!filePath && !lastError,
      entries: entries.slice(-2000).reverse() };
  }
  return { append, state, flush, close: flush, all:()=>entries.slice(),
    clear(){entries=[];if(!flush())throw Error("History could not be cleared on disk");},
    hydrate(saved) {
      entries = deduplicateHistory([...saved,...entries]).slice(-maxEntries);
    }
  };
}
module.exports = { createEggHistory, keepHistoryEvent, historyIdentity, deduplicateHistory };

