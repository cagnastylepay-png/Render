"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { createEggStore } = require("../src/store/EggStore");
const { createServer } = require("../server");

const egg = { uid: "egg-1", category: "Cat", name: "Cat Egg", rarity: "Eternal", weightKg: 123, incomePerSecond: 1 };
function snapshot(extra = {}) {
  return { version: 1, type: "eggs.snapshot", moduleId: "EggReporter", sessionId: "session-a",
    placeId: "123", jobId: "job-a", cycleId: "10", revision: 1, observedAt: new Date().toISOString(), eggs: [egg], ...extra };
}
test("store replaces snapshots, handles independent revisions, clears empty cycles and expires", () => {
  let clock = Date.now();
  const store = createEggStore({ now: () => clock, ttlMs: 100 });
  assert.equal(store.accept(snapshot()), true);
  assert.equal(store.accept(snapshot()), false);
  assert.equal(store.accept(snapshot({ sessionId: "session-b" })), true);
  assert.equal(store.state().eggs.length, 1);
  assert.equal(store.accept(snapshot({ cycleId: "9", revision: 2 })), false);
  assert.equal(store.accept(snapshot({ cycleId: "11", eggs: [] })), true);
  assert.equal(store.state().eggs.length, 0);
  assert.equal(store.accept(snapshot({ cycleId: "11", revision: 2, eggs: [{ ...egg, weightKg: null }] })), true);
  clock += 101;
  assert.equal(store.state().serverCount, 0);
  assert.throws(() => store.accept(snapshot({ eggs: [{ ...egg, rarity: "" }] })));
  assert.throws(() => store.accept(snapshot({ eggs: [{ ...egg, incomePerSecond: Infinity }] })));
});
async function connect(url, role, token) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
  await once(ws, "open");
  ws.send(JSON.stringify({ version: 1, type: "hello", role, token }));
  return { ws, messages };
}
async function waitFor(predicate) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for WebSocket message");
}
test("real HTTP and WebSocket: auth, publish, broadcast, empty snapshot, viewer read-only, reconnect", async t => {
  const server = createServer({ history: { filePath: null }, gateway: { reportToken: "test-report", viewerToken: "test-view" } });
  const peers = [];
  t.after(async () => {
    for (const peer of peers) peer.ws.terminate();
    server.autoSAE.close();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const url = base.replace("http:", "ws:") + "/sae/ws";
  assert.equal((await (await fetch(base + "/health")).json()).reporting, "ready");
  assert.equal((await fetch(base)).status, 200);
  const viewer = await connect(url, "viewer", "test-view"); peers.push(viewer);
  const reporter = await connect(url, "reporter", "test-report"); peers.push(reporter);
  await waitFor(() => reporter.messages.find(m => m.type === "hello.ack"));
  reporter.ws.send(JSON.stringify(presence()));
  await waitFor(() => reporter.messages.find(m=>m.type==="players.ack"&&m.accepted));
  await waitFor(() => viewer.messages.find(m=>m.type==="players.state"&&m.players.some(p=>p.reporterConnected)));
  reporter.ws.send(JSON.stringify(snapshot()));
  await waitFor(() => reporter.messages.find(m => m.type === "eggs.ack" && m.accepted));
  await waitFor(() => viewer.messages.find(m => m.type === "eggs.state" && m.eggs.length === 1));
  await waitFor(() => viewer.messages.find(m => m.type === "history.append" && m.entries.some(row=>row.action==="appeared")));
  await waitFor(() => viewer.messages.find(m => m.type === "eggs.events" && m.events.some(row=>row.action==="appeared")));
  viewer.ws.send(JSON.stringify(snapshot({ revision: 2 })));
  await waitFor(() => viewer.messages.find(m => m.type === "error" && /read-only/.test(m.message)));
  reporter.ws.send(JSON.stringify(snapshot({ revision: 2, eggs: [] })));
  await waitFor(() => viewer.messages.find(m => m.type === "eggs.state" && m.serverCount === 1 && !m.eggs.length));
  reporter.ws.close();
  await waitFor(() => viewer.messages.find(m=>m.type==="players.state"&&m.sessionCount===0));
  const reporter2 = await connect(url, "reporter", "test-report"); peers.push(reporter2);
  await waitFor(() => reporter2.messages.find(m => m.type === "hello.ack"));
  reporter2.ws.send(JSON.stringify(snapshot({ revision: 3 })));
  await waitFor(() => reporter2.messages.find(m => m.type === "eggs.ack" && m.accepted));
  const invalid = new WebSocket(url); peers.push({ ws: invalid });
  await once(invalid, "open");
  invalid.send(JSON.stringify({ version: 1, type: "hello", role: "reporter", token: "wrong" }));
  const [code] = await once(invalid, "close");
  assert.equal(code, 1008);
});

const { createPlayerStore } = require("../src/store/PlayerStore");
const { nextResetAt } = require("../src/store/EggStore");
test("global egg identity, Cosmic metadata, disappearance/reappearance and aligned expiration", () => {
  let clock = Date.UTC(2026,10,4,8,1,0);
  const store = createEggStore({now:()=>clock});
  const updates=[];
  store.onEvents(events=>updates.push(...events));
  const item={...egg,rarity:"Cosmic",position:{x:-1,y:2,z:3},sellValue:123,state:"Slot",mutations:["Golden"]};
  const make=(options={})=>snapshot({observedAt:new Date(clock).toISOString(),eggs:[item],...options});
  assert.equal(store.accept(make()),true);
  assert.equal(store.accept(make({jobId:"job-b"})),true);
  const rows=store.state().eggs;
  assert.notEqual(rows[0].globalUid,rows[1].globalUid);
  assert.equal(rows[0].sellValue,123);
  assert.equal(rows[0].position.x,-1);
  assert.equal(rows[0].expiresAt,Date.UTC(2026,10,4,8,5,0));
  store.accept(make({revision:2,eggs:[]}));
  assert.equal(updates.at(-1).action,"disappeared");
  store.accept(make({revision:3}));
  assert.equal(updates.at(-1).action,"appeared");
  clock=nextResetAt(clock);
  assert.equal(store.state().eggs.length,0);
  assert.equal(updates.at(-1).reason,"cycle-expired");
  assert.equal(store.accept(make({revision:2,cycleEndsAt:clock/1000-1})),false);
});
function presence(extra={}){
 return {version:1,type:"players.snapshot",moduleId:"PlayerReporter",sessionId:"session-a",placeId:"123",jobId:"job-a",
  reporterUserId:"1",revision:1,players:[
   {userId:"1",name:"Alice",displayName:"Alice",walkSpeed:32,speedPower:100,incomePerSecond:200},
   {userId:"2",name:"Bob",displayName:"Bob",walkSpeed:16,incomePerSecond:null}
  ],...extra};
}
test("player connection badge tracks real sockets, complete rosters, changed stats and disconnect",()=>{
 let clock=1000;
 const store=createPlayerStore({now:()=>clock,ttlMs:100});
 store.accept("socket-a",presence());
 assert.equal(store.state().players.find(p=>p.userId==="1").reporterConnected,true);
 assert.equal(store.state().players.find(p=>p.userId==="2").reporterConnected,false);
 store.accept("socket-b",presence({sessionId:"session-b",reporterUserId:"2"}));
 assert.equal(store.state().players.every(p=>p.reporterConnected),true);
 store.remove("socket-a");
 assert.equal(store.state().players.find(p=>p.userId==="1").reporterConnected,false);
 const latest=presence({sessionId:"session-b",reporterUserId:"2",revision:2});
 latest.players[1].walkSpeed=99;
 store.accept("socket-b",latest);
 assert.equal(store.state().players.find(p=>p.userId==="2").walkSpeed,99);
 clock+=101;
 assert.equal(store.state().players.length,0);
});

test("history retains dates, event details, bounded entries and survives reload from disk",t=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
 const {createEggHistory}=require("../src/store/EggHistory");
 const root=fs.mkdtempSync(path.join(process.cwd(),".history-test-"));
 const file=path.join(root,"history.json");
 t.after(()=>{for(const target of [file,file+".tmp"])if(fs.existsSync(target))fs.unlinkSync(target);fs.rmdirSync(root);});
 const history=createEggHistory({filePath:file,maxEntries:2,now:()=>Date.UTC(2026,10,4,8,10,12)});
 history.append([{action:"appeared",reason:"observation",egg:{...egg,globalUid:"job-a/egg-1"}}]);
 history.append([{action:"disappeared",reason:"observation",egg:{...egg,globalUid:"job-a/egg-1"}}]);
 history.append([{action:"appeared",reason:"observation",egg:{...egg,globalUid:"job-a/egg-1"}}]);
 assert.equal(history.flush(),true);
 const restored=createEggHistory({filePath:file,maxEntries:2});
 const rows=restored.state().entries;
 assert.equal(rows.length,2);
 assert.equal(rows[0].at,"2026-11-04T08:10:12.000Z");
 assert.equal(rows[0].egg.globalUid,"job-a/egg-1");
 assert.equal(restored.state().savedToDisk,true);
 restored.close();
});

test("Mongo history upserts queued observations and reloads them across instances",async()=>{
 const {createMongoHistory}=require("../src/store/MongoHistory");
 const documents=new Map();
 let fail=true;
 const collection={
  async createIndex(){},
  find(){
   let skip=0,limit=Infinity;
   return {sort(){return this},skip(n){skip=n;return this},limit(n){limit=n;return this},
    async toArray(){return [...documents.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(skip,skip+limit)}};
  },
  async bulkWrite(operations){
   for(const operation of operations){
    const row=operation.updateOne.update.$setOnInsert;
    if(!documents.has(row.id))documents.set(row.id,row);
   }
  },
  async deleteMany(filter){for(const id of filter.id.$in)documents.delete(id);}
 };
 const factory=()=>({
  async connect(){if(fail){fail=false;throw Error("temporary");}},
  db(){return {collection(){return collection}}},
  async close(){}
 });
 const history=createMongoHistory({uri:"mongodb://fake",clientFactory:factory,retryMs:100000});
 history.append([{action:"appeared",reason:"observation",egg:{...egg,globalUid:"job/egg"}}]);
 assert.equal(await history.flush(),false);
 assert.equal(history.state().pendingWrites,1);
 assert.equal(await history.flush(),true);
 assert.equal(history.state().pendingWrites,0);
 assert.equal(history.state().storage,"mongodb");
 await history.close();
 const restored=createMongoHistory({uri:"mongodb://fake",clientFactory:factory,retryMs:100000});
 await restored.flush();
 assert.equal(restored.state().entries.length,1);
 assert.equal(restored.state().entries[0].egg.globalUid,"job/egg");
 await restored.close();
});

test("reporting accepts every observed rarity and retains all eggs",()=>{
 const store=createEggStore();
 const rarities=["Common","Uncommon","Rare","Epic","Legendary","Mythic","Cosmic","Secret","Eternal","Divine"];
 assert.equal(store.accept(snapshot({eggs:rarities.map((rarity,i)=>({...egg,uid:"all-"+i,rarity}))})),true);
 assert.equal(store.state().eggs.length,rarities.length);
 assert.deepEqual(new Set(store.state().eggs.map(e=>e.rarity)),new Set(rarities));
 assert.throws(()=>store.accept(snapshot({revision:2,eggs:[{...egg,rarity:42}]})),/rarity/);
 assert.throws(()=>store.accept(snapshot({revision:2,eggs:[{...egg,rarity:"x".repeat(65)}]})),/rarity/);
});

test("history retains only Divine/Eternal receipts on append, hydrate and disk reload",t=>{
 const fs=require("node:fs"),path=require("node:path");
 const {createEggHistory}=require("../src/store/EggHistory");
 const root=fs.mkdtempSync(path.join(process.cwd(),".history-test-")),file=path.join(root,"history.json");
 t.after(()=>{for(const name of [file,file+".tmp"])if(fs.existsSync(name))fs.unlinkSync(name);fs.rmdirSync(root);});
 const at="2026-11-04T12:00:00.000Z";
 const legacy=["Common","Secret","Cosmic","Divine","Eternal"].map((rarity,i)=>({id:"old"+i,at,action:"appeared",egg:{...egg,rarity}}));
 legacy.push({id:"gone",at,action:"disappeared",egg:{...egg,rarity:"Divine"}});
 fs.writeFileSync(file,JSON.stringify(legacy));
 const history=createEggHistory({filePath:file});
 assert.equal(history.state().total,2);
 history.hydrate(legacy);
 assert.equal(history.state().total,2);
 const events=legacy.map(row=>({action:row.action,egg:row.egg}));
 const added=history.append(events);
 assert.equal(added.length,2);
 assert.equal(history.append([{action:"updated",egg:{...egg,rarity:"Eternal"}}]).length,0);
 assert.equal(history.append([{action:"appeared",egg:{...egg,rarity:"Common"}}]).length,0);
 history.close();
 const rows=JSON.parse(fs.readFileSync(file,"utf8"));
 assert.equal(rows.length,4);
 assert.ok(rows.every(row=>row.action==="appeared"&&["Divine","Eternal"].includes(row.egg.rarity)));
});
