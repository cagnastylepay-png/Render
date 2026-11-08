"use strict";
const catalog=require('./roblox-images.json');
const allowed=new Set(Object.values(catalog).map(row=>row.animal));
function createAnimalThumbnails({fetchImpl=fetch}={}){
 const cache=new Map(),waiting=new Map();let timer;
 async function flush(){
  timer=null;const batch=[...waiting.entries()].slice(0,100);for(const [id]of batch)waiting.delete(id);
  try{
   const response=await fetchImpl('https://thumbnails.roblox.com/v1/assets?assetIds='+batch.map(([id])=>id).join(',')+'&size=150x150&format=Png&isCircular=false',{signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('Thumbnail service unavailable');const data=await response.json();
   for(const [id,resolve]of batch){const row=data.data?.find(r=>String(r.targetId)===id&&r.state==='Completed');let url=null;
    if(row?.imageUrl){const parsed=new URL(row.imageUrl);if(parsed.protocol==='https:'&&(parsed.hostname==='rbxcdn.com'||parsed.hostname.endsWith('.rbxcdn.com')))url=parsed.href;}
    cache.set(id,{url,until:Date.now()+(url?86400000:10000)});resolve(url);
   }
  }catch{for(const [,resolve]of batch)resolve(null);}
  if(waiting.size&&!timer)timer=setTimeout(flush,100);
 }
 const pending=new Map();
 return {resolve(id){
  if(!allowed.has(id))return Promise.resolve(null);const old=cache.get(id);if(old?.until>Date.now())return Promise.resolve(old.url);
  if(pending.has(id))return pending.get(id);
  const p=new Promise(resolve=>{waiting.set(id,resolve);if(!timer)timer=setTimeout(flush,100);}).finally(()=>pending.delete(id));pending.set(id,p);return p;
 }};
}
module.exports={createAnimalThumbnails};
