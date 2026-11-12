"use strict";
// Keep one distinct Observer account per place/job. Admin and Hub never move.
function planObserverSpread(clients){
 const groups=new Map(),plans=new Map();
 for(const client of clients){
  const id=client.reporterIdentity;
  if(client.role!=="reporter"||client.clientKind!=="observer"||!client.observerOnly||client.superseded||!id)continue;
  plans.set(client,null);
  const key=id.placeId+"/"+id.jobId;
  if(!groups.has(key))groups.set(key,new Map());
  const accounts=groups.get(key);
  if(!accounts.has(id.userId))accounts.set(id.userId,[]);
  accounts.get(id.userId).push(client);
 }
 for(const accounts of groups.values()){
  const ids=[...accounts.keys()].sort((a,b)=>a.length-b.length||a.localeCompare(b));
  if(ids.length<2)continue;
  for(let i=1;i<ids.length;i++)for(const client of accounts.get(ids[i])){
   const id=client.reporterIdentity;
   plans.set(client,{placeId:id.placeId,jobId:id.jobId,keeperUserId:ids[0],delaySeconds:8+i*4});
  }
 }
 return plans;
}
module.exports={planObserverSpread};
