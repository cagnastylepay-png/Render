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
test("only favorite reporter sockets receive income-filtered eggs from other servers",async t=>{
 const server=createServer({history:{filePath:null,uri:null},gateway:{delivery:{filePath:null,uri:null}}}),peers=[];
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 const url="ws://127.0.0.1:"+server.address().port+"/sae/ws";
 const viewer=await peer(url,"viewer");peers.push(viewer);
 const favorite=await peer(url,"reporter");peers.push(favorite);
 const ordinary=await peer(url,"reporter");peers.push(ordinary);
 favorite.send(presence("1","home"));
 // Merely observing a favorite must never make this socket a favorite.
 ordinary.send(presence("2","remote",[{userId:"1",name:"User1",displayName:"User1"}]));
 await waitFor(()=>favorite.messages.some(m=>m.type==="players.ack"));
 await waitFor(()=>ordinary.messages.some(m=>m.type==="players.ack"));
 ordinary.send({version:1,type:"eggs.snapshot",moduleId:"EggReporter",sessionId:"source",placeId:"123",jobId:"remote",cycleId:"1",revision:1,
  observedAt:new Date().toISOString(),cycleEndsAt:Date.now()/1000+120,
  eggs:[{uid:"low",category:"Cat",name:"Low",rarity:"Common",incomePerSecond:1e9},
   {uid:"high",category:"Cat",name:"High",rarity:"Divine",incomePerSecond:3e9}]});
 await waitFor(()=>ordinary.messages.some(m=>m.type==="eggs.ack"));
 assert.equal(favorite.messages.filter(m=>m.type==="eggs.targets").length,0);
 const policy=await waitFor(()=>viewer.messages.find(m=>m.type==="delivery.policy"));
 viewer.send({type:"delivery.configure",expectedRevision:policy.revision,favoriteUserIds:["1"],minimumIncomePerSecond:2e9});
 await waitFor(()=>favorite.messages.find(m=>m.type==="eggs.targets"&&m.enabled&&m.eggs.length===1));
 assert.equal(favorite.messages.filter(m=>m.type==="eggs.targets").at(-1).eggs[0].uid,"high");
 assert.equal(ordinary.messages.filter(m=>m.type==="eggs.targets").length,0);
 let current=viewer.messages.filter(m=>m.type==="delivery.policy").at(-1);
 viewer.send({type:"delivery.configure",expectedRevision:current.revision,favoriteUserIds:["1"],minimumIncomePerSecond:4e9});
 await waitFor(()=>favorite.messages.find(m=>m.type==="eggs.targets"&&m.enabled&&m.minimumIncomePerSecond===4e9&&m.eggs.length===0));
 current=viewer.messages.filter(m=>m.type==="delivery.policy").at(-1);
 viewer.send({type:"delivery.configure",expectedRevision:current.revision,favoriteUserIds:[],minimumIncomePerSecond:4e9});
 await waitFor(()=>favorite.messages.find(m=>m.type==="eggs.targets"&&!m.enabled&&m.eggs.length===0));
 ordinary.send({type:"delivery.configure",expectedRevision:0,favoriteUserIds:["2"],minimumIncomePerSecond:0});
 await waitFor(()=>ordinary.messages.find(m=>m.type==="error"&&m.message.includes("dashboard")));
 assert.equal(ordinary.messages.filter(m=>m.type==="eggs.targets").length,0);
});
test("favorite policy survives disk and Mongo restart, validates bounds and rejects stale updates",async t=>{
 const fs=require("node:fs"),path=require("node:path");
 const root=fs.mkdtempSync(path.join(process.cwd(),".delivery-test-")),filePath=path.join(root,"policy.json");
 t.after(()=>{for(const p of [filePath,filePath+".tmp"])if(fs.existsSync(p))fs.unlinkSync(p);fs.rmdirSync(root);});
 const disk=createDeliveryPolicy({filePath,uri:null});
 await disk.ready;
 await disk.configure({expectedRevision:0,favoriteUserIds:["42"],minimumIncomePerSecond:2e12});
 await assert.rejects(()=>disk.configure({expectedRevision:0,favoriteUserIds:[],minimumIncomePerSecond:0}),/changed/);
 await assert.rejects(()=>disk.configure({expectedRevision:1,favoriteUserIds:["42"],minimumIncomePerSecond:Infinity}),/income/);
 await disk.close();
 const reload=createDeliveryPolicy({filePath,uri:null});await reload.ready;
 assert.deepEqual(reload.state().favoriteUserIds,["42"]);assert.equal(reload.state().minimumIncomePerSecond,2e12);
 await reload.close();
 let saved;
 const factory=()=>({async connect(){},db(){return {collection(){return{
  async findOne(){return saved},async updateOne(_,update){saved=update.$set}
 }}}},async close(){}});
 const mongo=createDeliveryPolicy({uri:"mongodb://fake",clientFactory:factory,filePath:null});
 await mongo.ready;await mongo.configure({expectedRevision:0,favoriteUserIds:["7"],minimumIncomePerSecond:1e9});await mongo.close();
 const mongoReload=createDeliveryPolicy({uri:"mongodb://fake",clientFactory:factory,filePath:null});await mongoReload.ready;
 assert.deepEqual(mongoReload.state().favoriteUserIds,["7"]);assert.equal(mongoReload.state().storage,"mongodb");await mongoReload.close();
});
