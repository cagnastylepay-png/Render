"use strict";
const {MongoClient}=require("mongodb");
const toggles=["AutoEggs","AutoTreadmill","AutoSell","AutoFuse","AutoOpen","AutoPlace","AutoPapillon","AutoIndex"];
const ranges=["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"];
function validateSettings(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid client settings");
 const result={};
 if(input.TeleportInstantMin!==undefined&&(typeof input.TeleportInstantMin!=="number"||!Number.isFinite(input.TeleportInstantMin)||input.TeleportInstantMin<0||input.TeleportInstantMin>1e33))throw Error("Invalid instant teleport income");
 result.TeleportInstantMin=input.TeleportInstantMin??50e9;
 if(input.QueueNearest!==undefined&&typeof input.QueueNearest!=="boolean")throw Error("Invalid queue sort");
 result.QueueNearest=input.QueueNearest===true;
 for(const key of toggles){if(typeof input[key]!=="boolean")throw Error("Invalid setting "+key);result[key]=input[key];}
 for(const key of ranges){
  for(const suffix of ["Min","Max"]){const value=input[key+suffix];if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>1e33)throw Error("Invalid setting "+key+suffix);result[key+suffix]=value;}
  if(result[key+"Min"]>result[key+"Max"])throw Error("Invalid settings range");
 }
 return result;
}
function createClientSettings({uri=process.env.MONGODB_URI,database=process.env.MONGODB_DB||"autosae",clientFactory=uri=>new MongoClient(uri,{serverSelectionTimeoutMS:5000})}={}){
 const rows=new Map(),pending=new Map(),listeners=new Set();
 let client,collection,running,timer,closed=false;
 function schedule(){if(!uri||closed||timer)return;timer=setTimeout(()=>{timer=null;void flush();},collection?300:30000);timer.unref();}
 async function persist(){
  if(!uri)return;
  try{
   if(!collection){
    client=clientFactory(uri);await client.connect();collection=client.db(database).collection("client_settings");
    await collection.createIndex({userId:1},{unique:true});
    for(const row of await collection.find({},{projection:{_id:0}}).toArray())if(!rows.has(row.userId))rows.set(row.userId,row);
    for(const fn of listeners)fn();
   }
   const batch=[...pending.values()];
   if(batch.length){await collection.bulkWrite(batch.map(row=>({updateOne:{filter:{userId:row.userId},update:{$set:row},upsert:true}})),{ordered:false});for(const row of batch)if(pending.get(row.userId)===row)pending.delete(row.userId);}
  }catch{collection=null;if(client)await client.close().catch(()=>{});client=null;schedule();}
 }
 function flush(){if(running)return running;running=persist().finally(()=>{running=null;if(pending.size)schedule();});return running;}
 if(uri)void flush();
 return {
  accept(identity,message){
   if(message.version!==1||typeof message.sessionId!=="string"||!message.sessionId.length||message.sessionId.length>100||!Number.isSafeInteger(message.revision)||message.revision<1)throw Error("Invalid settings snapshot");
   if(message.automationActive!==undefined&&typeof message.automationActive!=="boolean")throw Error("Invalid automation status");
   if(message.visitedJobIds!==undefined&&(!Array.isArray(message.visitedJobIds)||message.visitedJobIds.length>500||message.visitedJobIds.some(id=>typeof id!=="string"||!id.length||id.length>128)))throw Error("Invalid visited servers");
   const missing=message.missingCategories??{};
   if(!missing||typeof missing!=="object"||Array.isArray(missing)||Object.keys(missing).length>5000||Object.entries(missing).some(([key,value])=>!key.length||key.length>160||value!==true))throw Error("Invalid missing index");
   const options=validateSettings(message.options),old=rows.get(identity.userId);
   if(old?.sessionId===message.sessionId&&old.revision>=message.revision)return false;
   const row={userId:identity.userId,playerName:identity.name,placeId:identity.placeId,jobId:identity.jobId,sessionId:message.sessionId,revision:message.revision,at:new Date().toISOString(),automationActive:message.automationActive===true,visitedJobIds:[...new Set(message.visitedJobIds||[])],missingCategories:{...missing},options};
   rows.set(row.userId,row);pending.set(row.userId,row);schedule();return true;
  },
  get:userId=>rows.get(userId),
  storage:()=>collection?"mongodb":uri?"mongodb-pending":"memory",
  onReady(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  async close(){closed=true;clearTimeout(timer);await flush();if(client)await client.close().catch(()=>{});}
 };
}
module.exports={createClientSettings,validateSettings};