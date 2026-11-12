"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createObserverServers}=require("../src/ws/ObserverServers");
const server=(id,playing=1,maxPlayers=8)=>({id,playing,maxPlayers});
test("exclude current, occupied and full servers; reserve different destinations",async()=>{
 let calls=0;
 const picker=createObserverServers({random:()=>0,fetchImpl:async url=>{
  calls++;assert.equal(url.hostname,"games.roblox.com");
  return {ok:true,json:async()=>({data:[server("home"),server("occupied"),server("full",8),server("a"),server("b")]})};
 }});
 const first=await picker.choose({placeId:"123",jobId:"home",userId:"1"},new Set(["occupied"]));
 assert.equal(first.jobId,"a");
 const second=await picker.choose({placeId:"123",jobId:"home",userId:"2"},new Set(["occupied"]));
 assert.equal(second.jobId,"b");assert.equal(calls,1);
 assert.equal(await picker.choose({placeId:"123",jobId:"home",userId:"3"},new Set(["occupied"])),null);
});
test("pagination, recent destinations and HTTP failure recovery",async()=>{
 let time=0,calls=0,broken=true;
 const picker=createObserverServers({now:()=>time,random:()=>0,fetchImpl:async url=>{
  calls++;
  if(broken)return {ok:false,status:429};
  return {ok:true,json:async()=>url.searchParams.has("cursor")?
   {data:[server("second")]}:{data:[server("home")],nextPageCursor:"page 2"}};
 }});
 const identity={placeId:"123",jobId:"home",userId:"1"};
 await assert.rejects(picker.choose(identity,new Set()),/429/);
 broken=false;
 assert.equal((await picker.choose(identity,new Set())).jobId,"second");
 assert.equal(calls,3);
 time=100000;
 assert.equal(await picker.choose(identity,new Set()),null,"recent destination must remain excluded after reservation expires");
 time=700000;
 assert.equal((await picker.choose(identity,new Set())).jobId,"second");
});
