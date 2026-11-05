"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {WebSocket}=require("ws"),{createServer}=require("../server");
async function waitFor(fn){
 const end=Date.now()+4000;
 while(Date.now()<end){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}
 throw Error("Timed out");
}
async function peer(url,role,observerOnly=false){
 const ws=new WebSocket(url),messages=[];
 ws.on("message",raw=>messages.push(JSON.parse(raw)));
 await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role,observerOnly}));
 await waitFor(()=>messages.find(m=>m.type==="hello.ack"));
 return {ws,messages,send:m=>ws.send(JSON.stringify(m))};
}
const presence=(revision,others=[])=>({version:1,type:"players.snapshot",moduleId:"PlayerReporter",
 sessionId:"observer",revision,placeId:"123",jobId:"home",reporterUserId:"1",
 players:[{userId:"1",name:"Observer",displayName:"Observer"},...others]});
test("observer relocates only for another favorite in its server and cannot receive execution or automation",async t=>{
 const server=createServer({history:{filePath:null,uri:null},gateway:{settings:{uri:null},logs:{uri:null},delivery:{filePath:null,uri:null}}}),peers=[];
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 const url="ws://127.0.0.1:"+server.address().port+"/sae/ws";
 const viewer=await peer(url,"viewer"),observer=await peer(url,"reporter",true);peers.push(viewer,observer);
 observer.send(presence(1));await waitFor(()=>observer.messages.find(m=>m.type==="players.ack"));
 const config=await waitFor(()=>viewer.messages.find(m=>m.type==="delivery.policy"));
 viewer.send({type:"delivery.configure",expectedRevision:config.revision,favoriteUserIds:["1","2"],minimumIncomePerSecond:2e9});
 await waitFor(()=>observer.messages.find(m=>m.type==="reporting.policy"&&m.favorite));
 assert.equal(observer.messages.findLast(m=>m.type==="reporting.policy").sendTeleport,false);
 assert.equal(observer.messages.findLast(m=>m.type==="reporting.policy").sendSettings,false);
 await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"&&!m.relocate));
 observer.send(presence(2,[{userId:"2",name:"Favorite",displayName:"Favorite"}]));
 const relocation=await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"&&m.relocate));
 assert.deepEqual(relocation.favoriteUserIds,["2"]);assert.equal(relocation.jobId,"home");
 assert.equal(relocation.placeId,"123");assert.ok(relocation.avoidJobIds.includes("home"));
 const before=observer.messages.length;observer.send(presence(3));
 await waitFor(()=>observer.messages.slice(before).find(m=>m.type==="observer.relocate"&&!m.relocate));
 assert.equal(observer.messages.filter(m=>m.type==="teleport.request"||m.type==="eggs.targets").length,0);
 viewer.send({version:1,type:"execute.request",code:"return 1",connectionId:"anything"});
 await waitFor(()=>viewer.messages.find(m=>m.type==="error"));
 assert.equal(observer.messages.some(m=>m.type.startsWith("execute.")),false);
});