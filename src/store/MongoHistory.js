"use strict";
const { MongoClient } = require("mongodb");
const { createEggHistory } = require("./EggHistory");
function createMongoHistory({ uri, database = "autosae", maxEntries = 10000,
  clientFactory = (connection) => new MongoClient(connection, { serverSelectionTimeoutMS: 5000 }), retryMs = 30000 } = {}) {
  if (!uri) throw new Error("MongoDB URI required");
  const memory = createEggHistory({ maxEntries });
  const pending = new Map(), listeners = new Set();
  let client, collection, running, clearing, closed = false, ready = false, timer;
  function notify() { for (const callback of listeners) callback(); }
  function schedule() {
    if (closed || clearing || timer) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, ready ? 300 : retryMs);
    timer.unref();
  }
  async function connect() {
    if (collection) return;
    client = clientFactory(uri);
    await client.connect();
    const target = client.db(database).collection("egg_history");
    await target.createIndex({ at: -1 });
    await target.createIndex({ "egg.rarity": 1, action: 1, at: -1 });
    await target.createIndex({ id: 1 }, { unique: true });
    const rows = await target.find({ action: "appeared", "egg.rarity": { $in: ["Divine", "Eternal"] } }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(maxEntries).toArray();
    memory.hydrate(rows);
    // Migrate old random IDs and remove duplicate receipts, keeping the earliest observation.
    const canonical=memory.all();
    if(canonical.length)await target.bulkWrite(canonical.map(row=>({updateOne:{filter:{id:row.id},update:{$set:row},upsert:true}})),{ordered:false});
    const legacy=rows.filter(row=>!canonical.some(kept=>kept.id===row.id)).map(row=>row.id);
    if(legacy.length)await target.deleteMany({id:{$in:legacy}});
    for(const row of canonical)if(pending.has(row.id))pending.set(row.id,row);
    collection = target;
    ready = true;
    notify();
  }
  async function persist() {
    try {
      await connect();
      const batch = [...pending.values()];
      if (batch.length) {
        await collection.bulkWrite(batch.map(row => ({ updateOne: { filter: { id: row.id }, update: { $setOnInsert: row }, upsert: true } })), { ordered: false });
        for (const row of batch) pending.delete(row.id);
        // Bound retained documents using the same date ordering as the UI.
        const overflow = await collection.find({}, { projection: { id: 1 } }).sort({ at: -1 }).skip(maxEntries).limit(1000).toArray();
        if (overflow.length) await collection.deleteMany({ id: { $in: overflow.map(row => row.id) } });
      }
      return true;
    } catch {
      ready = false;
      collection = undefined;
      if (client) { await client.close().catch(() => {}); client = undefined; }
      console.error("MongoDB history unavailable; observations remain queued in memory (check URI and Atlas network access)");
      notify();
      schedule();
      return false;
    }
  }
  function flush() {
    if (running) return running;
    running = persist().finally(() => { running = undefined; if (!closed && pending.size) schedule(); });
    return running;
  }
  function append(events) {
    const rows = memory.append(events);
    if (!rows.length) return rows;
    for (const row of rows) pending.set(row.id, row);
    while (pending.size > maxEntries) pending.delete(pending.keys().next().value);
    if(!clearing)void flush();
    return rows;
  }
  void flush();
  return {
    append, flush,
    async clear(){
      if(clearing)throw Error("History clear already in progress");
      let release;clearing=new Promise(resolve=>{release=resolve;});clearTimeout(timer);timer=undefined;
      try{
        if(!await flush()||!collection)throw Error("MongoDB unavailable: history was not cleared");
        const ids=memory.all().map(row=>row.id),pendingIds=[...pending.keys()];
        await collection.deleteMany({});
        const newer=memory.all().filter(row=>!ids.includes(row.id));memory.clear();memory.hydrate(newer);
        for(const id of pendingIds)pending.delete(id);
      }finally{release();clearing=undefined;if(pending.size)schedule();}
    },
    state() { return { ...memory.state(), storage: ready ? "mongodb" : "mongodb-pending", savedToDisk: false, pendingWrites: pending.size }; },
    onReady(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if(clearing)await clearing;
      await flush();
      if (client) await client.close().catch(() => {});
    }
  };
}
module.exports = { createMongoHistory };

