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

const {planTeleport}=require("../src/ws/TeleportPlanner");

test("missing index targets bypass income ranges only when enabled and still obey capacity",()=>{
 const identity={placeId:"123",jobId:"home"};
 const settings={automationActive:true,options:{...options,AutoEggs:false,AutoIndex:true},missingCategories:{Phoenix:true}};
 const egg={key:"123/remote/egg",placeId:"123",jobId:"remote",category:"Phoenix",incomePerSecond:1,expiresAt:20000};
 const roster=[{placeId:"123",jobId:"remote",userId:"2",speedPower:5,reporterConnected:true}];
 assert.equal(planTeleport(identity,settings,[egg],10000,roster).target.category,"Phoenix");
 assert.equal(planTeleport(identity,{...settings,options:{...settings.options,AutoIndex:false}},[egg],10000,roster),null);
 assert.equal(planTeleport(identity,{...settings,missingCategories:{}},[egg],10000,roster),null);
 assert.equal(planTeleport(identity,{...settings,automationActive:false},[egg],10000,roster),null);
 assert.equal(planTeleport(identity,settings,[{...egg,carrierUserId:2}],10000,roster),null);
 const full=Array.from({length:7},(_,i)=>({...roster[0],userId:String(i)}));
 assert.equal(planTeleport(identity,settings,[egg],10000,full),null);
});

const options={AutoEggs:true,AutoTreadmill:true,AutoSell:false,AutoFuse:true,AutoOpen:true,AutoPlace:true,AutoPapillon:false,AutoIndex:true,TeleportInstantMin:10e9};
for(const key of ["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"]){options[key+"Min"]=2e9;options[key+"Max"]=100e9;}
test("teleport planner applies each favorite's running status, ranges, expiry and visited servers",()=>{
 const roster=[{placeId:"123",jobId:"remote",userId:"2",reporterConnected:true,speedPower:100},{placeId:"123",jobId:"another",userId:"3",reporterConnected:true,speedPower:100}];
 const identity={placeId:"123",jobId:"home"},settings={automationActive:true,options},egg={key:"123/remote/egg",placeId:"123",jobId:"remote",expiresAt:20000,incomePerSecond:3e9};
 assert.equal(planTeleport(identity,settings,[egg],10000,roster).immediate,false);
 assert.equal(planTeleport(identity,settings,[{...egg,incomePerSecond:10e9}],10000,roster).immediate,true);
 for(const bad of [{...egg,placeId:"other"},{...egg,jobId:"home"},{...egg,incomePerSecond:1e9},{...egg,incomePerSecond:200e9},{...egg,expiresAt:10000},{...egg,carrierUserId:3},{...egg,state:"Carried"}])assert.equal(planTeleport(identity,settings,[bad],10000,roster),null);
 assert.equal(planTeleport(identity,{...settings,automationActive:false},[egg],10000,roster),null);
 assert.equal(planTeleport(identity,{...settings,options:{...options,AutoEggs:false}},[egg],10000,roster),null);
 assert.equal(planTeleport(identity,{...settings,visitedJobIds:["remote"]},[egg],10000,roster),null);
 assert.equal(planTeleport(identity,settings,[egg,{...egg,key:"123/another/egg",jobId:"another",incomePerSecond:5e9}],10000,roster).target.jobId,"another");
});

test("teleport selection excludes full or unobserved servers, ranks income first and opponent speed only on ties",()=>{
 const identity={placeId:"123",jobId:"home"},settings={automationActive:true,options};
 const egg=(job,income,uid="egg")=>({key:"123/"+job+"/"+uid,placeId:"123",jobId:job,uid,expiresAt:20000,incomePerSecond:income});
 const roster=(job,speeds)=>speeds.map((speed,index)=>({placeId:"123",jobId:job,userId:job+index,speedPower:speed,reporterConnected:index===0}));
 const eggs=[egg("full",50e9),egg("strong",20e9),egg("weak",3e9),egg("weak",4e9,"best")];
 const players=[...roster("full",[1,1,1,1,1,1,1]),...roster("strong",[1,1000]),...roster("weak",[20,10,15,10,10,10])];
 assert.equal(planTeleport(identity,settings,eggs,10000,players).target.jobId,"strong");
 assert.equal(planTeleport(identity,settings,[eggs[0]],10000,players),null);
 assert.equal(planTeleport(identity,settings,eggs,10000,[]),null);
 assert.equal(planTeleport(identity,settings,eggs,10000,players.map(p=>({...p,reporterConnected:false}))),null);
 const unknown=egg("unknown",90e9);assert.equal(planTeleport(identity,settings,[...eggs,unknown],10000,[...players,...roster("unknown",[null])]).target.jobId,"unknown");
 assert.equal(planTeleport(identity,settings,[egg("tieA",3e9),egg("tieB",5e9)],10000,[...roster("tieA",[20]),...roster("tieB",[20])]).target.jobId,"tieB");
 assert.equal(planTeleport(identity,settings,[egg("fast",4e9),egg("slow",17e9)],10000,[...roster("fast",[1]),...roster("slow",[1e12])]).target.jobId,"slow");
 assert.equal(planTeleport(identity,settings,[egg("fast",17e9),egg("slow",17e9)],10000,[...roster("fast",[1e12]),...roster("slow",[1])]).target.jobId,"slow");
 assert.equal(planTeleport(identity,settings,[egg("known",17e9),egg("unknown",17e9)],10000,[...roster("known",[100]),...roster("unknown",[null])]).target.jobId,"known");
});

