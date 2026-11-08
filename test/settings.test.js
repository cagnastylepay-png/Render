"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {WebSocket}=require("ws"),{createServer}=require("../server"),{createClientLogs}=require("../src/store/ClientLogs");
async function waitFor(fn){const until=Date.now()+4000;while(Date.now()<until){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error("Timeout");}
async function peer(url,role){const ws=new WebSocket(url),messages=[];ws.on("message",data=>messages.push(JSON.parse(data)));await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role}));await waitFor(()=>messages.find(m=>m.type==="hello.ack"));return {ws,messages,send:message=>ws.send(JSON.stringify(message))};}

const {createClientSettings}=require("../src/store/ClientSettings");
const options={AutoEggs:true,AutoTreadmill:true,AutoSell:false,AutoFuse:true,AutoOpen:true,AutoPlace:true,AutoPapillon:false,AutoIndex:true};
for(const key of ["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"]){options[key+"Min"]=2e9;options[key+"Max"]=1e33;}

test("settings persist latest values in Mongo and reject invalid snapshots atomically",async()=>{
 let saved=[];const factory=()=>({async connect(){},async close(){},db(){return {collection(){return {async createIndex(){},find(){return {async toArray(){return saved;}}},async bulkWrite(ops){for(const op of ops){const row=op.updateOne.update.$set;saved=saved.filter(old=>old.userId!==row.userId);saved.push(row);}}};}}}});
 const identity={userId:"42",name:"Alice",jobId:"job",placeId:"123"};
 const store=createClientSettings({uri:"fake",clientFactory:factory});await new Promise(r=>setTimeout(r,0));
 const snapshot={version:1,sessionId:"s",revision:1,options};assert.equal(store.accept(identity,snapshot),true);assert.equal(store.accept(identity,snapshot),false);
 assert.throws(()=>store.accept(identity,{...snapshot,revision:2,options:{...options,AutoEggsMin:-1}}));assert.equal(store.get("42").revision,1);
 store.accept(identity,{...snapshot,revision:2,options:{...options,AutoEggs:false}});await store.close();assert.equal(saved.length,1);
 const restored=createClientSettings({uri:"fake",clientFactory:factory});await new Promise(r=>setTimeout(r,0));assert.equal(restored.storage(),"mongodb");assert.equal(restored.get("42").options.AutoEggs,false);await restored.close();
});

