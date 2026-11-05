"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {WebSocket}=require("ws"),{createServer}=require("../server"),{createDeliveryPolicy}=require("../src/store/DeliveryPolicy");
async function waitFor(fn){
 const until=Date.now()+4000;
 while(Date.now()<until){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,10));}
 throw Error("WebSocket wait timed out");
}
async function peer(url,role){
 const ws=new WebSocket(url),messages=[];
 ws.on("message",data=>messages.push(JSON.parse(data)));
 await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role}));
 await waitFor(()=>messages.find(m=>m.type==="hello.ack"));
 return {ws,messages,send:m=>ws.send(JSON.stringify(m))};
}
function presence(id,job,others=[]){
 return {version:1,type:"players.snapshot",moduleId:"PlayerReporter",sessionId:"s"+id,revision:1,placeId:"123",jobId:job,
  reporterUserId:id,players:[{userId:id,name:"User"+id,displayName:"User"+id},...others]};
}


async function executionPeer(url,role,extra={}){const ws=new WebSocket(url),messages=[];ws.on("message",data=>messages.push(JSON.parse(data)));await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role,...extra}));await waitFor(()=>messages.find(m=>m.type==="hello.ack"));return {ws,messages,send:m=>ws.send(JSON.stringify(m))};}
test("execution without a key still requires explicit opt-in and a favorite; results are private",async t=>{
 const server=createServer({history:{filePath:null,uri:null},gateway:{settings:{uri:null},logs:{uri:null},delivery:{filePath:null,uri:null}}}),peers=[];
 server.listen(0,"127.0.0.1");await once(server,"listening");t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 const url="ws://127.0.0.1:"+server.address().port+"/sae/ws",viewer=await executionPeer(url,"viewer"),observer=await executionPeer(url,"viewer"),client=await executionPeer(url,"reporter",{allowExecution:true});peers.push(viewer,observer,client);
 client.send(presence("1","home"));await waitFor(()=>client.messages.find(m=>m.type==="players.ack"));
 viewer.send({version:1,type:"execute.request",clientId:"anything",code:"return 1"});await waitFor(()=>viewer.messages.find(m=>m.type==="error"&&m.message.includes("unavailable")));assert.equal(client.messages.filter(m=>m.type==="execute.request").length,0);
 const config=viewer.messages.find(m=>m.type==="delivery.policy");viewer.send({type:"delivery.configure",expectedRevision:config.revision,favoriteUserIds:["1"],minimumIncomePerSecond:0});
 const clients=await waitFor(()=>viewer.messages.find(m=>m.type==="execute.clients"&&m.clients.length));const id=clients.clients[0].clientId;await waitFor(()=>client.messages.find(m=>m.type==="reporting.policy"&&m.executionAllowed));
 viewer.send({version:1,type:"execute.request",clientId:id,code:"return 1 + 1",timeoutMs:1000});const request=await waitFor(()=>client.messages.find(m=>m.type==="execute.request"));assert.equal(request.code,"return 1 + 1");
 observer.send({version:1,type:"execute.result",requestId:request.requestId,ok:true,result:99});await waitFor(()=>observer.messages.find(m=>m.type==="error"));
 client.send({version:1,type:"execute.result",requestId:request.requestId,ok:true,result:2,resultCount:1,durationMs:1});const result=await waitFor(()=>viewer.messages.find(m=>m.type==="execute.result"));assert.equal(result.result,2);assert.equal(observer.messages.filter(m=>m.type==="execute.result").length,0);
 viewer.send({version:1,type:"execute.request",clientId:id,code:"return 3"});await waitFor(()=>client.messages.filter(m=>m.type==="execute.request").length===2);
 client.ws.close();await waitFor(()=>viewer.messages.find(m=>m.type==="execute.result"&&m.error==="CLIENT_DISCONNECTED"));
});
test("explicit client opt-in is required even without authentication",()=>{
 const {createExecutionBridge}=require("../src/ws/ExecutionBridge");const client={connectionId:"c",role:"reporter",readyState:1,reporterIdentity:{userId:"1"}},viewer={role:"viewer",readyState:1},clients=new Set([client,viewer]);
 const bridge=createExecutionBridge({clients,send(){},isFavorite:()=>true});bridge.register(client,{});assert.equal(bridge.ready(client),false);assert.throws(()=>bridge.handle(viewer,{version:1,type:"execute.request",clientId:"c",code:"return 1"}));
 bridge.register(client,{allowExecution:true});assert.equal(bridge.ready(client),true);assert.equal(bridge.policy(viewer).authorized,true);assert.throws(()=>bridge.handle(client,{version:1,type:"execute.request",clientId:"c",code:"return 1"}));assert.throws(()=>bridge.handle(viewer,{version:1,type:"execute.request",clientId:"c",code:"x".repeat(32769)}));bridge.close();
});

test("execution is cancelled when the favorite authorization is removed",()=>{
 const {createExecutionBridge}=require("../src/ws/ExecutionBridge");let favorite=true;const output=[];
 const client={connectionId:"c",role:"reporter",readyState:1,reporterIdentity:{userId:"1"}},viewer={role:"viewer",readyState:1},clients=new Set([client,viewer]);
 const bridge=createExecutionBridge({clients,send:(ws,m)=>output.push({ws,m}),isFavorite:()=>favorite});
 bridge.register(client,{allowExecution:true});bridge.handle(viewer,{version:1,type:"execute.request",clientId:"c",code:"return 1"});
 favorite=false;bridge.changed();assert.ok(output.some(row=>row.ws===client&&row.m.type==="execute.cancel"));assert.ok(output.some(row=>row.ws===viewer&&row.m.type==="execute.result"&&row.m.error==="CLIENT_NO_LONGER_AUTHORIZED"));bridge.close();
});
