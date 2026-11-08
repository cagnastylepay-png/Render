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


test("roaming observer roster survives departure only until reset and keeps targets selectable",()=>{
 const {createPlayerStore}=require("../src/store/PlayerStore");
 const {planTeleport}=require("../src/ws/TeleportPlanner");
 let now=300010;
 const players=createPlayerStore({now:()=>now});
 players.accept("observer",presence(1),{observerOnly:true});
 players.remove("observer");
 const roster=players.state().players;
 assert.equal(roster.length,1);assert.equal(roster[0].reporterConnected,false);
 assert.equal(roster[0].observationExpiresAt,600000);
 const egg={key:"123/home/e",placeId:"123",jobId:"home",incomePerSecond:3e9,expiresAt:600000};
 const settings={automationActive:true,options:{AutoEggs:true,AutoEggsMin:2e9,AutoEggsMax:10e9}};
 assert.equal(planTeleport({placeId:"123",jobId:"elsewhere"},settings,[egg],now,roster),null,"a departed lone observer cannot keep the server alive");
 players.accept("observer",presence(2,[{userId:"2",name:"Guest",displayName:"Guest"}]),{observerOnly:true});
 players.remove("observer");
 const populated=players.state().players;
 assert.equal(planTeleport({placeId:"123",jobId:"elsewhere"},settings,[egg],now,populated).target.jobId,"home");
 now+=61000;
 assert.equal(planTeleport({placeId:"123",jobId:"elsewhere"},settings,[egg],now,populated),null,"old capacity observations must not trigger a teleport");
 now=600000;assert.equal(players.state().players.length,0);
 assert.equal(planTeleport({placeId:"123",jobId:"elsewhere"},settings,[{...egg,expiresAt:900000}],now,roster),null);
});

