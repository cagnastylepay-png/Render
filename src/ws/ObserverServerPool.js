"use strict";
const {randomUUID}=require("node:crypto");
function createObserverServerPool({now=Date.now,fetchFn=globalThis.fetch,random=Math.random,cacheMs=45000,leaseMs=120000,intervalMs=3000}={}){
 const rows=new Map(),cursors=new Map(),leases=new Map(),visited=new Map();
 let running=null,nextAt=0,backoff=30000,closed=false,lastError=null,lastHttpStatus=null;
 const key=(place,job)=>JSON.stringify([place,job]);
 function prune(){
  const time=now(),cycle=Math.floor(time/300000);
  for(const [id,row]of rows)if(row.at+cacheMs<=time)rows.delete(id);
  for(const [owner,row]of leases)if(row.expiresAt<=time)leases.delete(owner);
  for(const [owner,row]of visited)if(row.cycle!==cycle)visited.delete(owner);
 }
 function seen(owner){let row=visited.get(owner);const cycle=Math.floor(now()/300000);if(!row||row.cycle!==cycle){row={cycle,jobs:new Set()};visited.set(owner,row);}return row.jobs;}
 function valid(server){return server&&typeof server.id==="string"&&server.id.length>0&&server.id.length<=128&&Number.isInteger(server.playing)&&server.playing>=2&&server.playing<=5&&Number.isInteger(server.maxPlayers)&&server.playing<server.maxPlayers;}
 async function refresh(placeId){
  prune();if(closed||running||now()<nextAt||!/^[0-9]{1,20}$/.test(placeId))return;
  if([...rows.values()].filter(row=>row.placeId===placeId).length>=60)return;
  nextAt=now()+intervalMs;
  running=(async()=>{
   try{
    const url=new URL("https://games.roblox.com/v1/games/"+placeId+"/servers/Public");
    url.searchParams.set("sortOrder","Desc");url.searchParams.set("excludeFullGames","true");url.searchParams.set("limit","100");
    if(cursors.get(placeId))url.searchParams.set("cursor",cursors.get(placeId));
    const response=await fetchFn(url.toString(),{signal:AbortSignal.timeout(8000)});
    lastHttpStatus=response.status;
    if(response.status===429){
     const retry=Number(response.headers?.get?.("retry-after"));
     backoff=Math.min(300000,Math.max(60000,backoff*2,Number.isFinite(retry)?retry*1000:0));
     nextAt=now()+backoff;lastError="Roblox HTTP 429";return;
    }
    if(!response.ok)throw Error("Roblox HTTP "+response.status);
    const data=await response.json();if(!Array.isArray(data.data))throw Error("Invalid Roblox server list");
    if(closed)return;
    cursors.set(placeId,typeof data.nextPageCursor==="string"?data.nextPageCursor:null);
    for(const server of data.data)if(valid(server))rows.set(key(placeId,server.id),{placeId,jobId:server.id,playing:server.playing,maxPlayers:server.maxPlayers,at:now()});
    while(rows.size>1000)rows.delete(rows.keys().next().value);
    backoff=30000;lastError=null;
   }catch(error){lastError=String(error.message).slice(0,160);nextAt=now()+15000;}
  })();
  try{await running;}finally{running=null;}
 }
 async function reserve(owner,placeId,avoidFn){
  prune();
  const blocked=()=>new Set(avoidFn());
  const existing=leases.get(owner);
  if(existing&&existing.placeId===placeId&&!blocked().has(existing.jobId))return {...existing};
  leases.delete(owner);
  if(![...rows.values()].some(row=>row.placeId===placeId))await refresh(placeId);
  if(closed)return null;
  prune();
  const avoid=blocked(),used=seen(owner);
  for(const lease of leases.values())if(lease.placeId===placeId)avoid.add(lease.jobId);
  const choices=[...rows.values()].filter(row=>row.placeId===placeId&&!avoid.has(row.jobId)&&!used.has(row.jobId));
  if(!choices.length)return null;
  const row=choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];
  const lease={...row,leaseId:randomUUID(),expiresAt:now()+leaseMs};
  leases.set(owner,lease);rows.delete(key(placeId,row.jobId));used.add(row.jobId);
  return {...lease};
 }
 function release(owner,leaseId){const row=leases.get(owner);if(row&&(!leaseId||row.leaseId===leaseId))leases.delete(owner);}
 function arrived(owner,placeId,jobId){prune();seen(owner).add(jobId);const row=leases.get(owner);if(row&&row.placeId===placeId&&row.jobId===jobId)leases.delete(owner);}
 function failed(owner,leaseId){const row=leases.get(owner);if(row?.leaseId===leaseId){rows.delete(key(row.placeId,row.jobId));release(owner,leaseId);}}
 return {refresh,reserve,release,arrived,failed,state(){prune();return{minimumPlayers:2,maximumPlayers:5,cachedServers:rows.size,reservations:leases.size,lastHttpStatus,lastError,nextRequestAt:nextAt};},close(){closed=true;rows.clear();leases.clear();visited.clear();}};
}
module.exports={createObserverServerPool};