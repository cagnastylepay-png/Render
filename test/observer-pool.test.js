"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createObserverServerPool}=require("../src/ws/ObserverServerPool");
const server=(id,playing,maxPlayers=7)=>({id,playing,maxPlayers});
const response=(data,cursor=null)=>({status:200,ok:true,json:async()=>({data,nextPageCursor:cursor})});
test("shared server cache filters 2-5 players and assigns distinct reservations atomically",async()=>{
 let calls=0;
 const pool=createObserverServerPool({random:()=>0,fetchFn:async()=>{calls++;return response([server("solo",1),server("two",2),server("five",5),server("six",6),server("full",3,3)]);}});
 await pool.refresh("123");
 const [a,b]=await Promise.all([pool.reserve("a","123",()=>new Set()),pool.reserve("b","123",()=>new Set())]);
 assert.equal(calls,1);assert.equal(a.jobId,"two");assert.equal(b.jobId,"five");assert.notEqual(a.leaseId,b.leaseId);
 assert.equal((await pool.reserve("a","123",()=>new Set())).leaseId,a.leaseId);
 assert.equal(pool.state().reservations,2);pool.close();
});
test("pagination advances centrally, stale rows expire and current exclusions are rechecked after fetch",async()=>{
 let time=1000,calls=0,unblock;const urls=[];
 const pool=createObserverServerPool({now:()=>time,fetchFn:async url=>{
  urls.push(new URL(url));calls++;
  if(calls===1)return response([server("six",6)],"next");
  await new Promise(resolve=>{unblock=resolve;});return response([server("favorite",3),server("observer",4),server("available",5)]);
 }});
 await pool.refresh("123");assert.equal(pool.state().cachedServers,0);
 time+=3000;let avoid=new Set();const pending=pool.reserve("a","123",()=>avoid);
 await new Promise(r=>setImmediate(r));avoid=new Set(["favorite","observer"]);unblock();
 const lease=await pending;assert.equal(lease.jobId,"available");assert.equal(urls[1].searchParams.get("cursor"),"next");
 time+=50000;assert.equal(pool.state().cachedServers,0);pool.close();
});
test("HTTP 429 backs off shared requests and honors Retry-After",async()=>{
 let time=1000,calls=0;
 const pool=createObserverServerPool({now:()=>time,fetchFn:async()=>{calls++;return{status:429,headers:{get:()=>"120"}};}});
 await pool.refresh("123");assert.equal(pool.state().nextRequestAt,121000);
 for(let i=0;i<5;i++)await pool.reserve(String(i),"123",()=>new Set());
 assert.equal(calls,1);time=121000;await pool.refresh("123");assert.equal(calls,2);assert.ok(pool.state().nextRequestAt>=time+120000);pool.close();
});
test("failed leases are released and the same observer never repeats them within the cycle",async()=>{
 let time=1000,calls=0;
 const pool=createObserverServerPool({now:()=>time,random:()=>0,fetchFn:async()=>{calls++;return response([server("one",3),server("two",4)]);}});
 const a=await pool.reserve("owner","123",()=>new Set());pool.failed("owner",a.leaseId);assert.equal(pool.state().reservations,0);
 const b=await pool.reserve("owner","123",()=>new Set());assert.equal(b.jobId,"two");
 pool.arrived("owner","123",b.jobId);assert.equal(pool.state().reservations,0);
 time+=50000;await pool.refresh("123");assert.equal(await pool.reserve("owner","123",()=>new Set()),null);
 time=300000;await pool.refresh("123");assert.ok(await pool.reserve("owner","123",()=>new Set()));pool.close();
});