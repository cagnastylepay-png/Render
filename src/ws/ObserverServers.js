"use strict";
function createObserverServers({fetchImpl=fetch,now=Date.now,random=Math.random}={}){
 const caches=new Map(),loading=new Map(),reservations=new Map(),recent=new Map();
 async function servers(placeId){
  const cached=caches.get(placeId);
  if(cached&&now()-cached.at<45000)return cached.rows;
  if(loading.has(placeId))return loading.get(placeId);
  const request=(async()=>{
   const rows=[];let cursor;
   for(let page=0;page<3;page++){
    const url=new URL("https://games.roblox.com/v1/games/"+placeId+"/servers/Public");
    url.searchParams.set("sortOrder","Asc");url.searchParams.set("limit","100");
    url.searchParams.set("excludeFullGames","true");
    if(cursor)url.searchParams.set("cursor",cursor);
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw Error("Roblox servers HTTP "+response.status);
    const data=await response.json();
    if(!Array.isArray(data.data))throw Error("Invalid Roblox server list");
    for(const row of data.data)if(typeof row.id==="string"&&row.id.length>0&&row.id.length<=128&&
     Number.isFinite(row.playing)&&Number.isFinite(row.maxPlayers)&&row.playing>=0&&row.playing<row.maxPlayers)rows.push(row.id);
    cursor=data.nextPageCursor;
    if(typeof cursor!=="string"||!cursor)break;
   }
   const unique=[...new Set(rows)];
   caches.set(placeId,{at:now(),rows:unique});return unique;
  })();
  loading.set(placeId,request);
  try{return await request;}finally{loading.delete(placeId);}
 }
 return {async choose(identity,occupied){
  const {placeId,jobId,userId}=identity;
  if(!/^\d+$/.test(placeId))return null;
  const rows=await servers(placeId),time=now();
  for(const [key,entry]of reservations)if(entry.until<=time)reservations.delete(key);
  for(const [key,until]of recent)if(until<=time)recent.delete(key);
  const available=rows.filter(id=>id!==jobId&&!occupied.has(id)&&
   !reservations.has(placeId+"/"+id)&&!recent.has(userId+"/"+placeId+"/"+id));
  if(!available.length)return null;
  const id=available[Math.min(available.length-1,Math.floor(random()*available.length))];
  const until=time+90000;
  reservations.set(placeId+"/"+id,{until});
  recent.set(userId+"/"+placeId+"/"+id,time+600000);
  return {jobId:id,until};
 }};
}
module.exports={createObserverServers};
