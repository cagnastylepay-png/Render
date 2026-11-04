"use strict";
const {MongoClient}=require("mongodb");
function createClientLogs({uri=process.env.MONGODB_URI,database=process.env.MONGODB_DB||"autosae",maxEntries=1000,clientFactory=uri=>new MongoClient(uri,{serverSelectionTimeoutMS:5000})}={}){
 const rows=new Map(),pending=new Map(),listeners=new Set();
 let client,collection,running,timer,clearing,closed=false;
 function retain(row){rows.set(row.id,row);while(rows.size>maxEntries)rows.delete(rows.keys().next().value);}
 function schedule(){if(closed||clearing||timer||!uri)return;timer=setTimeout(()=>{timer=null;void flush();},collection?500:30000);timer.unref();}
 async function persist(){
  if(!uri)return;
  try{
   if(!collection){
    client=clientFactory(uri);await client.connect();
    collection=client.db(database).collection("client_logs");
    await collection.createIndex({id:1},{unique:true});await collection.createIndex({at:-1});
    const saved=await collection.find({},{projection:{_id:0}}).sort({at:-1}).limit(maxEntries).toArray();
    const merged=[...saved,...rows.values()].sort((a,b)=>a.at.localeCompare(b.at));rows.clear();for(const row of merged)retain(row);
    for(const fn of listeners)fn();
   }
   const batch=[...pending.values()];
   if(batch.length){
    await collection.bulkWrite(batch.map(row=>({updateOne:{filter:{id:row.id},update:{$setOnInsert:row},upsert:true}})),{ordered:false});
    for(const row of batch)pending.delete(row.id);
    const overflow=await collection.find({},{projection:{id:1}}).sort({at:-1}).skip(maxEntries).limit(1000).toArray();
    if(overflow.length)await collection.deleteMany({id:{$in:overflow.map(row=>row.id)}});
   }
  }catch{
   collection=null;if(client){await client.close().catch(()=>{});client=null;}schedule();
  }
 }
 function flush(){if(running)return running;running=persist().finally(()=>{running=null;if(pending.size)schedule();});return running;}
 if(uri)void flush();
 return {
  async clear(){
   if(clearing)throw Error("Log clear already in progress");
   let release;clearing=new Promise(resolve=>{release=resolve;});clearTimeout(timer);timer=null;
   try{
    await flush();
    if(uri&&!collection)throw Error("MongoDB unavailable: logs were not cleared");
    const ids=[...rows.keys()],pendingIds=[...pending.keys()];
    if(collection)await collection.deleteMany({});
    for(const id of ids)rows.delete(id);
    for(const id of pendingIds)pending.delete(id);
   }finally{release();clearing=null;if(pending.size)schedule();}
  },
  append(identity,message){
   if(message.version!==1||typeof message.sessionId!=="string"||message.sessionId.length>100||!Array.isArray(message.lines)||message.lines.length>100)throw Error("Invalid logs batch");
   const entries=message.lines.map(line=>{
    if(!Number.isSafeInteger(line.sequence)||line.sequence<1||typeof line.text!=="string"||!line.text.length||line.text.length>4096)throw Error("Invalid log line");
    return {id:identity.userId+"/"+message.sessionId+"/"+line.sequence,at:new Date().toISOString(),clientAt:typeof line.at==="string"?line.at.slice(0,40):null,
     userId:identity.userId,playerName:identity.name||identity.userId,jobId:identity.jobId,placeId:identity.placeId,text:line.text};
   });
   const added=[];for(const row of entries){if(rows.has(row.id))continue;retain(row);pending.set(row.id,row);added.push(row);}
   while(pending.size>maxEntries)pending.delete(pending.keys().next().value);
   if(added.length)schedule();return added;
  },
  state(){return {version:1,type:"logs.state",entries:[...rows.values()],limit:maxEntries,storage:collection?"mongodb":uri?"mongodb-pending":"memory"};},
  onReady(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  async close(){closed=true;clearTimeout(timer);if(clearing)await clearing;await flush();if(client)await client.close().catch(()=>{});}
 };
}
module.exports={createClientLogs};

