"use strict";
const {createECDH,createHmac,createCipheriv,createPrivateKey,randomBytes,sign}=require("node:crypto");
const {MongoClient}=require("mongodb");
const types={
 flightSuccess:"Vol réussi",flightFailure:"Vol échoué",butterflies:"Papillons démarrés",
 skyfall:"Skyfall démarré",cosmic:"Cosmic Eclipse démarrée",slickRick:"Slick Rick est présent"
};
const allowedHosts=new Set(["fcm.googleapis.com","updates.push.services.mozilla.com"]);
function sender(secret){
 const key=createECDH("prime256v1");
 // Domain-separated scalar, stable across deployments with the same secret.
 const order=BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
 const hash=createHmac("sha256",secret).update("M4GIX Web Push VAPID v1").digest("hex");
 key.setPrivateKey(Buffer.from((BigInt("0x"+hash)%(order-1n)+1n).toString(16).padStart(64,"0"),"hex"));
 const pub=key.getPublicKey(),publicKey=pub.toString("base64url");
 const privateKey=createPrivateKey({format:"jwk",key:{kty:"EC",crv:"P-256",d:Buffer.from(key.getPrivateKey().toString("hex").padStart(64,"0"),"hex").toString("base64url"),x:pub.subarray(1,33).toString("base64url"),y:pub.subarray(33).toString("base64url")}});
 const mac=(k,data)=>createHmac("sha256",k).update(data).digest();
 return {publicKey,async send(subscription,payload){
  const peer=Buffer.from(subscription.keys.p256dh,"base64url"),auth=Buffer.from(subscription.keys.auth,"base64url");
  const ephemeral=createECDH("prime256v1"),server=ephemeral.generateKeys(),salt=randomBytes(16);
  const shared=ephemeral.computeSecret(peer);
  const info=Buffer.concat([Buffer.from("WebPush: info\0"),peer,server,Buffer.from([1])]);
  const prk=mac(salt,mac(mac(auth,shared),info));
  const cipher=createCipheriv("aes-128-gcm",mac(prk,Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0,16),mac(prk,Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0,12));
  const body=Buffer.concat([salt,Buffer.from([0,0,16,0,65]),server,cipher.update(Buffer.from(JSON.stringify(payload)+"\x02")),cipher.final(),cipher.getAuthTag()]);
  const endpoint=new URL(subscription.endpoint);
  const claims={aud:endpoint.origin,exp:Math.floor(Date.now()/1000)+3600,sub:"https://m4gix-ws.onrender.com"};
  const jwt=Buffer.from('{"typ":"JWT","alg":"ES256"}').toString("base64url")+"."+Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature=sign("sha256",Buffer.from(jwt),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
  return fetch(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:{
   Authorization:"vapid t="+jwt+"."+signature+", k="+publicKey,
   "Content-Encoding":"aes128gcm","Content-Type":"application/octet-stream",TTL:"120"
  },body});
 }};
}
function createNotifications(auth){
 const uri=process.env.MONGODB_URI;
 const enabled=Boolean(auth?.configured&&uri);
 let pushPromise;
 let client,connecting;
 async function collection(){
  if(!connecting){
   client=new MongoClient(uri,{serverSelectionTimeoutMS:5000});
   connecting=client.connect().then(()=>client.db(process.env.MONGODB_DB||"autosae"));
   connecting.catch(()=>{connecting=null;void client.close().catch(()=>{});});
  }
  return (await connecting).collection("web_push_subscriptions");
 }
 async function getPush(){
  if(!enabled)return null;
  if(!pushPromise){
   pushPromise=(async()=>{
    await collection();
    const db=await connecting;
    const config=db.collection("web_push_config");
    const entry=await config.findOneAndUpdate({_id:"vapid"},{$setOnInsert:{secret:randomBytes(32).toString("base64url")}},{upsert:true,returnDocument:"after"});
    return sender(entry.secret);
   })().catch(error=>{pushPromise=null;throw error;});
  }
  return pushPromise;
 }
 async function request(req,res){
  const reply=(status,body)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(body));};
  if(!auth?.authenticated(req))return reply(401,{error:"Connecte-toi au tableau."});
  if(req.method==="GET"){
   try{return reply(200,{publicKey:(await getPush())?.publicKey??null});}
   catch{return reply(503,{error:"Stockage des notifications indisponible."});}
  }
  if(req.method!=="POST"||!auth.sameOrigin(req)||!/^application\/json(?:;|$)/i.test(req.headers["content-type"]||""))return reply(403,{error:"Requête refusée."});
  if(!enabled)return reply(503,{error:"Notifications indisponibles sur ce serveur."});
  try{
   let body="";
   for await(const chunk of req){
    body+=chunk;
    if(body.length>8192)return reply(413,{error:"Requête trop longue."});
   }
   const {subscription,preferences,remove,read}=JSON.parse(body);
   const endpoint=new URL(subscription?.endpoint);
   if(endpoint.protocol!=="https:"||endpoint.port||endpoint.username||endpoint.password||!allowedHosts.has(endpoint.hostname)||!subscription.keys||
    typeof subscription.keys.p256dh!=="string"||!/^B[A-Za-z0-9_-]{86}$/.test(subscription.keys.p256dh)||
    typeof subscription.keys.auth!=="string"||!/^[A-Za-z0-9_-]{22}$/.test(subscription.keys.auth))return reply(400,{error:"Abonnement invalide."});
   const _id=endpoint.href,rows=await collection();
   if(read){
    const row=await rows.findOne({_id});
    return reply(200,{preferences:row?.preferences??null});
   }
   if(remove){await rows.deleteOne({_id});return reply(200,{ok:true});}
   const selected=Object.fromEntries(Object.keys(types).map(key=>[key,preferences?.[key]===true]));
   if(!await rows.findOne({_id})&&await rows.estimatedDocumentCount()>=100)return reply(409,{error:"Limite d’appareils atteinte."});
   await rows.updateOne({_id},{$set:{subscription:{endpoint:_id,keys:subscription.keys},preferences:selected}},{upsert:true});
   reply(200,{ok:true});
  }catch{reply(400,{error:"Impossible d’enregistrer les notifications."});}
 }
 async function emit(type,id,body){
  if(!enabled||!Object.hasOwn(types,type)||typeof id!=="string"||id.length>250)return;
  try{
   const push=await getPush();
   const rows=await collection();
   const devices=await rows.find({["preferences."+type]:true}).limit(100).toArray();
   await Promise.allSettled(devices.map(async row=>{
    const tag=type+":"+id;
    const claimed=await rows.updateOne({_id:row._id,delivered:{$ne:tag},["preferences."+type]:true},{$push:{delivered:{$each:[tag],$slice:-128}}});
    if(!claimed.modifiedCount)return;
    const response=await push.send(row.subscription,{title:types[type],body,tag:type+":"+id});
    if(response.status===404||response.status===410)await rows.deleteOne({_id:row._id});
   }));
  }catch{console.warn("Web Push unavailable");}
 }
 return {request,emit,close:()=>client?.close()};
}
module.exports={createNotifications,sender};
