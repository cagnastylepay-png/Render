"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {WebSocket}=require("ws"),{createServer}=require("../server"),{createClientLogs}=require("../src/store/ClientLogs");
async function waitFor(fn){const until=Date.now()+4000;while(Date.now()<until){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error("Timeout");}
async function peer(url,role){const ws=new WebSocket(url),messages=[];ws.on("message",data=>messages.push(JSON.parse(data)));await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role}));await waitFor(()=>messages.find(m=>m.type==="hello.ack"));return {ws,messages,send:message=>ws.send(JSON.stringify(message))};}


test("logs persist in Mongo, restore, enforce retention and reject invalid batches atomically",async()=>{
 let saved=[];
 const factory=()=>({async connect(){},async close(){},db(){return {collection(){return {
  async createIndex(){},find(){let skip=0,limit=Infinity;return {sort(){return this},skip(n){skip=n;return this},limit(n){limit=n;return this},async toArray(){return [...saved].reverse().slice(skip,skip+limit)}}},
  async bulkWrite(ops){for(const op of ops){const row=op.updateOne.update.$setOnInsert;if(!saved.some(old=>old.id===row.id))saved.push(row);}},async deleteMany(filter){saved=filter.id?saved.filter(row=>!filter.id.$in.includes(row.id)):[];}
 }}}}});
 const identity={userId:"42",name:"Alice",jobId:"job",placeId:"123"},store=createClientLogs({uri:"mongodb://fake",clientFactory:factory,maxEntries:3});
 await new Promise(r=>setTimeout(r,0));
 const batch={version:1,sessionId:"session",lines:Array.from({length:5},(_,i)=>({sequence:i+1,text:"Action "+i}))};
 assert.equal(store.append(identity,batch).length,5);await store.close();assert.equal(saved.length,3);
 const restored=createClientLogs({uri:"mongodb://fake",clientFactory:factory,maxEntries:3});await new Promise(r=>setTimeout(r,0));
 assert.equal(restored.state().storage,"mongodb");assert.equal(restored.state().entries.length,3);
 assert.equal(restored.append(identity,{...batch,lines:batch.lines.slice(-3)}).length,0);
 assert.throws(()=>restored.append(identity,{...batch,lines:[{sequence:9,text:"ok"},{sequence:10,text:4}]}));assert.equal(restored.state().entries.length,3);
 await restored.clear();assert.equal(saved.length,0);assert.equal(restored.state().entries.length,0);
 await restored.close();
});
