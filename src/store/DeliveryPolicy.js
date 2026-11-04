"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");
function validatePolicy(input) {
 if (!Array.isArray(input.favoriteUserIds) || input.favoriteUserIds.length > 200 ||
     input.favoriteUserIds.some(id => typeof id !== "string" || !/^\d{1,20}$/.test(id))) throw new Error("Invalid favorites");
 if (typeof input.minimumIncomePerSecond !== "number" || !Number.isFinite(input.minimumIncomePerSecond) || input.minimumIncomePerSecond < 0)
  throw new Error("Invalid delivery income");
 return { favoriteUserIds: [...new Set(input.favoriteUserIds)].sort(), minimumIncomePerSecond: input.minimumIncomePerSecond };
}
function createDeliveryPolicy({ uri = process.env.MONGODB_URI, database = process.env.MONGODB_DB || "autosae",
 filePath = path.join(process.env.SAE_DATA_DIR || path.join(__dirname,"..","..","data"),"delivery-policy.json"),
 clientFactory = connection => new MongoClient(connection,{serverSelectionTimeoutMS:5000}) } = {}) {
 let data = {revision:0,favoriteUserIds:[],minimumIncomePerSecond:2e9}, client, collection, storage="memory", closed=false, writes=Promise.resolve();
 const listeners=new Set();
 const state=()=>({version:1,type:"delivery.policy",...data,storage});
 const notify=()=>{for(const listener of listeners)listener(state());};
 const ready=(async()=>{
  try {
   let saved;
   if(uri){
    client=clientFactory(uri);await client.connect();collection=client.db(database).collection("delivery_policy");
    saved=await collection.findOne({_id:"default"});storage="mongodb";
   }else if(filePath){
    if(fs.existsSync(filePath))saved=JSON.parse(fs.readFileSync(filePath,"utf8"));
    storage="disk";
   }
   if(saved)data={revision:Number.isSafeInteger(saved.revision)&&saved.revision>=0?saved.revision:0,...validatePolicy(saved)};
  }catch{
   storage="memory";collection=undefined;
   console.error("Delivery policy persistence unavailable; settings are currently in memory");
  }
  if(!closed)notify();
 })();
 async function configure(input){
  await ready;
  if(input.expectedRevision!==data.revision)throw new Error("Delivery settings changed; retry with the current settings");
  const validated=validatePolicy(input);
  data={revision:data.revision+1,...validated};
  const snapshot={...data,favoriteUserIds:[...data.favoriteUserIds]};
  writes=writes.then(async()=>{
   try{
    if(collection)await collection.updateOne({_id:"default"},{$set:snapshot},{upsert:true});
    else if(filePath&&!uri){
     fs.mkdirSync(path.dirname(filePath),{recursive:true});
     fs.writeFileSync(filePath+".tmp",JSON.stringify(snapshot));fs.renameSync(filePath+".tmp",filePath);
    }
   }catch{storage="memory";console.error("Delivery policy save failed");}
  });
  notify();await writes;
  return state();
 }
 return {ready,state,configure,onChange(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  async close(){if(closed)return;closed=true;await ready;await writes;if(client)await client.close().catch(()=>{});}
 };
}
module.exports={createDeliveryPolicy,validatePolicy};
