"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {WebSocket}=require("ws"),{createServer}=require("../server"),{createClientLogs}=require("../src/store/ClientLogs");
async function waitFor(fn){const until=Date.now()+4000;while(Date.now()<until){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error("Timeout");}
async function peer(url,role){const ws=new WebSocket(url),messages=[];ws.on("message",data=>messages.push(JSON.parse(data)));await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role}));await waitFor(()=>messages.find(m=>m.type==="hello.ack"));return {ws,messages,send:message=>ws.send(JSON.stringify(message))};}

const {createClientSettings}=require("../src/store/ClientSettings");
const options={AutoEggs:true,AutoTreadmill:true,AutoSell:false,AutoFuse:true,AutoOpen:true,AutoPlace:true,AutoPapillon:false,AutoIndex:true};
for(const key of ["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"]){options[key+"Min"]=2e9;options[key+"Max"]=1e33;}
test("favorite settings are gated, updated, replayed and show real socket presence",async t=>{
 const server=createServer({dashboardAuth:false,history:{filePath:null,uri:null},gateway:{settings:{uri:null},logs:{uri:null},delivery:{filePath:null,uri:null}}}),peers=[];
 server.listen(0,"127.0.0.1");await once(server,"listening");t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 const url="ws://127.0.0.1:"+server.address().port+"/sae/ws",reporter=await peer(url,"reporter"),viewer=await peer(url,"viewer");peers.push(reporter,viewer);
 const snapshot={version:1,type:"settings.snapshot",sessionId:"settings",revision:1,options};
 reporter.send(snapshot);await waitFor(()=>reporter.messages.find(m=>m.type==="error"));
 reporter.send({version:1,type:"players.snapshot",moduleId:"PlayerReporter",sessionId:"settings",revision:1,placeId:"123",jobId:"job",reporterUserId:"42",players:[{userId:"42",name:"Alice",displayName:"Alice"}]});
 await waitFor(()=>reporter.messages.find(m=>m.type==="players.ack"));
 reporter.send(snapshot);await waitFor(()=>reporter.messages.find(m=>m.type==="settings.ack"&&m.accepted===false));
 const config=await waitFor(()=>viewer.messages.find(m=>m.type==="delivery.policy"));
 viewer.send({type:"delivery.configure",expectedRevision:config.revision,favoriteUserIds:["42","99"],minimumIncomePerSecond:0});
 const state=await waitFor(()=>viewer.messages.find(m=>m.type==="favorites.state"&&m.entries.length===2));
 assert.equal(state.entries.find(x=>x.userId==="42").connected,true);assert.equal(state.entries.find(x=>x.userId==="99").connected,false);
 await waitFor(()=>reporter.messages.find(m=>m.type==="reporting.policy"&&m.sendSettings));reporter.send(snapshot);
 await waitFor(()=>viewer.messages.find(m=>m.type==="favorites.state"&&m.entries[0]?.options));
 reporter.send({...snapshot,revision:2,options:{...options,AutoEggsMin:4e9}});
 await waitFor(()=>viewer.messages.find(m=>m.type==="favorites.state"&&m.entries[0]?.options?.AutoEggsMin===4e9));
 reporter.ws.close();await waitFor(()=>viewer.messages.find(m=>m.type==="favorites.state"&&m.entries[0]?.options?.AutoEggsMin===4e9&&!m.entries[0].connected));
 const next=await peer(url,"viewer");peers.push(next);const replay=await waitFor(()=>next.messages.find(m=>m.type==="favorites.state"));assert.equal(replay.entries[0].options.AutoEggsMin,4e9);assert.equal(replay.entries[0].connected,false);
});
test("settings persist latest values in Mongo and reject invalid snapshots atomically",async()=>{
 let saved=[];const factory=()=>({async connect(){},async close(){},db(){return {collection(){return {async createIndex(){},find(){return {async toArray(){return saved;}}},async bulkWrite(ops){for(const op of ops){const row=op.updateOne.update.$set;saved=saved.filter(old=>old.userId!==row.userId);saved.push(row);}}};}}}});
 const identity={userId:"42",name:"Alice",jobId:"job",placeId:"123"};
 const store=createClientSettings({uri:"fake",clientFactory:factory});await new Promise(r=>setTimeout(r,0));
 const snapshot={version:1,sessionId:"s",revision:1,options};assert.equal(store.accept(identity,snapshot),true);assert.equal(store.accept(identity,snapshot),false);
 assert.throws(()=>store.accept(identity,{...snapshot,revision:2,options:{...options,AutoEggsMin:-1}}));assert.equal(store.get("42").revision,1);
 store.accept(identity,{...snapshot,revision:2,options:{...options,AutoEggs:false}});await store.close();assert.equal(saved.length,1);
 const restored=createClientSettings({uri:"fake",clientFactory:factory});await new Promise(r=>setTimeout(r,0));assert.equal(restored.storage(),"mongodb");assert.equal(restored.get("42").options.AutoEggs,false);await restored.close();
});

