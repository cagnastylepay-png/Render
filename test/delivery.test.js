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

