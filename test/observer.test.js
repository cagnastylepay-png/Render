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

test("observer holds populated eligible servers, leaves full servers and releases after favorite arrival",async t=>{
 const server=createServer({history:{filePath:null,uri:null},gateway:{settings:{uri:null},logs:{uri:null},delivery:{filePath:null,uri:null}}}),peers=[];
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 const url="ws://127.0.0.1:"+server.address().port+"/sae/ws";
 const viewer=await peer(url,"viewer"),observer=await peer(url,"reporter",true),favorite=await peer(url,"reporter");peers.push(viewer,observer,favorite);
 const config=await waitFor(()=>viewer.messages.find(m=>m.type==="delivery.policy"));
 viewer.send({type:"delivery.configure",expectedRevision:config.revision,favoriteUserIds:["2"],minimumIncomePerSecond:0});
 observer.send(presence(1));
 favorite.send({...presence(1),sessionId:"f",jobId:"favorite-home",reporterUserId:"2",players:[{userId:"2",name:"Favorite",displayName:"Favorite"}]});
 await waitFor(()=>favorite.messages.find(m=>m.type==="reporting.policy"&&m.sendSettings));
 const options={AutoEggs:true,AutoIndex:true,AutoTreadmill:false,AutoSell:false,AutoFuse:false,AutoOpen:false,AutoPlace:false,AutoPapillon:false};
 for(const key of ["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"]){options[key+"Min"]=2e9;options[key+"Max"]=100e9;}
 const settings={version:1,type:"settings.snapshot",sessionId:"f",revision:1,automationActive:true,options};
 favorite.send(settings);await waitFor(()=>favorite.messages.find(m=>m.type==="settings.ack"));
 const snapshot={version:1,type:"eggs.snapshot",moduleId:"EggReporter",sessionId:"observer",revision:1,placeId:"123",jobId:"home",
 cycleId:"1",observedAt:new Date().toISOString(),cycleEndsAt:Date.now()/1000+120,eggs:[{uid:"e",category:"Cat",name:"Cat",rarity:"Secret",incomePerSecond:3e9}]};
 observer.send(snapshot);
 const hold=await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"&&m.mode==="hold"));
 assert.equal(hold.relocate,false);assert.deepEqual(hold.waitingForUserIds,["2"]);
 await waitFor(()=>observer.messages.find(m=>m.type==="eggs.ack"&&m.revision===1));
 assert.ok(observer.messages.indexOf(hold)<observer.messages.findIndex(m=>m.type==="eggs.ack"&&m.revision===1));
 observer.send(presence(2,[{userId:"3",name:"Guest",displayName:"Guest"}]));
 await waitFor(()=>observer.messages.find(m=>m.type==="players.ack"&&m.revision===2));
 await new Promise(r=>setTimeout(r,250));
 assert.equal(observer.messages.findLast(m=>m.type==="observer.relocate").mode,"hold");
 observer.send(presence(3,Array.from({length:6},(_,i)=>({userId:String(i+3),name:"Guest"+i,displayName:"Guest"+i}))));
 await waitFor(()=>observer.messages.findLast(m=>m.type==="observer.relocate")?.mode==="roam");
 observer.send(presence(4,[{userId:"3",name:"Guest",displayName:"Guest"}]));
 await waitFor(()=>observer.messages.findLast(m=>m.type==="observer.relocate")?.mode==="hold");
 let before=observer.messages.length;
 observer.send({...snapshot,revision:2,eggs:[]});
 await waitFor(()=>observer.messages.slice(before).find(m=>m.type==="observer.relocate"&&m.mode==="roam"));
 observer.send({...snapshot,revision:3});await waitFor(()=>observer.messages.findLast(m=>m.type==="observer.relocate")?.mode==="hold");
 favorite.send({...settings,revision:2,automationActive:false,automationReason:"Mode AUTO OFF"});
 await waitFor(()=>observer.messages.findLast(m=>m.type==="observer.relocate")?.mode==="roam");
 favorite.send({...settings,revision:3});await waitFor(()=>observer.messages.findLast(m=>m.type==="observer.relocate")?.mode==="hold");
 favorite.send({...settings,revision:4,automationActive:false,automationReason:"Teleportation en cours",visitedJobIds:["home"]});
 await waitFor(()=>favorite.messages.find(m=>m.type==="settings.ack"&&m.revision===4));
 favorite.ws.close();await new Promise(r=>setTimeout(r,300));
 assert.equal(observer.messages.findLast(m=>m.type==="observer.relocate").mode,"hold");
 before=observer.messages.length;
 observer.send(presence(5,[{userId:"2",name:"Favorite",displayName:"Favorite"}]));
 await waitFor(()=>observer.messages.slice(before).find(m=>m.type==="observer.relocate"&&m.mode==="roam"));
});


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

test("observer roams after reporting, excludes favorite and observer servers, and never enables automation",async t=>{
 const server=createServer({history:{filePath:null,uri:null},gateway:{settings:{uri:null},logs:{uri:null},delivery:{filePath:null,uri:null}}}),peers=[];
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 const url="ws://127.0.0.1:"+server.address().port+"/sae/ws";
 const viewer=await peer(url,"viewer"),observer=await peer(url,"reporter",true);peers.push(viewer,observer);
 observer.send(presence(1));await waitFor(()=>observer.messages.find(m=>m.type==="players.ack"));
 const config=await waitFor(()=>viewer.messages.find(m=>m.type==="delivery.policy"));
 viewer.send({type:"delivery.configure",expectedRevision:config.revision,favoriteUserIds:["1","2"],minimumIncomePerSecond:2e9});
 await waitFor(()=>viewer.messages.find(m=>m.type==="delivery.policy"&&m.favoriteUserIds.includes("2")));
 assert.equal(observer.messages.findLast(m=>m.type==="reporting.policy").favorite,false);
 assert.equal(observer.messages.findLast(m=>m.type==="reporting.policy").sendTeleport,false);
 assert.equal(observer.messages.findLast(m=>m.type==="reporting.policy").sendSettings,false);
 const initial=await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"));
 assert.equal(initial.mode,"roam");assert.equal(initial.minimumFreeSlots,2);assert.equal(initial.relocate,true);
 observer.send(presence(2,[{userId:"2",name:"Favorite",displayName:"Favorite"}]));
 const relocation=await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"&&m.favoriteUserIds.includes("2")));
 assert.deepEqual(relocation.favoriteUserIds,["2"]);assert.equal(relocation.jobId,"home");
 assert.equal(relocation.placeId,"123");assert.ok(relocation.avoidJobIds.includes("home"));
 const before=observer.messages.length;observer.send(presence(3));
 await waitFor(()=>observer.messages.slice(before).find(m=>m.type==="observer.relocate"&&m.favoriteUserIds.length===0));
 const other=await peer(url,"reporter",true);peers.push(other);
 other.send({...presence(1),sessionId:"other",jobId:"observed",reporterUserId:"3",players:[{userId:"3",name:"Other",displayName:"Other"}]});
 await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"&&m.avoidJobIds.includes("observed")));
 const favorite=await peer(url,"reporter");peers.push(favorite);
 favorite.send({...presence(1),sessionId:"favorite",jobId:"favorite-home",reporterUserId:"2",players:[{userId:"2",name:"Favorite",displayName:"Favorite"}]});
 await waitFor(()=>observer.messages.find(m=>m.type==="observer.relocate"&&m.avoidJobIds.includes("favorite-home")));
 const beforeLeave=observer.messages.length;other.ws.close();
 await waitFor(()=>observer.messages.slice(beforeLeave).find(m=>m.type==="observer.relocate"&&!m.avoidJobIds.includes("observed")));
 assert.equal(observer.messages.filter(m=>m.type==="teleport.request"||m.type==="eggs.targets").length,0);
 viewer.send({version:1,type:"execute.request",code:"return 1",connectionId:"anything"});
 await waitFor(()=>viewer.messages.find(m=>m.type==="error"));
 assert.equal(observer.messages.some(m=>m.type.startsWith("execute.")),false);
});
