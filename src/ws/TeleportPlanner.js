"use strict";
const {allowedBiome}=require("../store/Biomes");
// A typed destination request only: no executable code is sent to reporters.
function planTeleport(identity,settings,eggs,now=Date.now(),players=[]){
 if(!identity||!settings?.automationActive||(!settings.options?.AutoEggs&&!settings.options?.AutoIndex))return null;
 const options=settings.options;
 const fishing=settings.fishingActive===true&&options.IdleMode==="Fishing";
 const visited=new Set(settings.visitedJobIds||[]);
 const servers=new Map();
 for(const player of players){
  const key=JSON.stringify([player.placeId,player.jobId]);
  if(!servers.has(key))servers.set(key,new Map());
  servers.get(key).set(player.userId,player);
 }
 const competition=new Map();
 for(const [key,roster]of servers){
  const list=[...roster.values()];
  const connected=list.some(player=>player.reporterConnected);
  const abandonedSoloObserver=list.length===1&&list[0].observerSnapshot&&list[0].userId===list[0].observerReporterUserId&&!connected;
  const recentObservation=list.some(player=>player.observerSnapshot&&player.observationExpiresAt>now&&Number.isFinite(Date.parse(player.receivedAt))&&now-Date.parse(player.receivedAt)<=60000);
  // A roaming observer's last roster remains usable only within its egg cycle.
  if((list.length>=7&&! (fishing&&list[0]?.jobId===identity.jobId))||abandonedSoloObserver||(!connected&&!recentObservation))continue;
  const known=list.every(player=>Number.isFinite(player.speedPower)&&player.speedPower>=0);
  competition.set(key,{playerCount:list.length,strongestSpeed:known?Math.max(...list.map(player=>player.speedPower)):Infinity});
 }
 const candidates=eggs.filter(egg=>allowedBiome(egg,options.AutoEggsMaxBiome??"All")&&egg.placeId===identity.placeId&&(egg.jobId!==identity.jobId||fishing)&&(!visited.has(egg.jobId)||fishing&&egg.jobId===identity.jobId)&&
  competition.has(JSON.stringify([egg.placeId,egg.jobId]))&&
  !egg.carrierUserId&&egg.state!=="Carried"&&egg.state!=="Claimed"&&!egg.observationOnly&&
  Number.isFinite(egg.incomePerSecond)&&((options.AutoEggs&&egg.incomePerSecond>=options.AutoEggsMin&&egg.incomePerSecond<=options.AutoEggsMax)||
   (fishing&&options.AutoEggs&&egg.rarity==="Divine")||
   (options.AutoIndex&&Object.hasOwn(settings.missingCategories||{},egg.category)&&settings.missingCategories[egg.category]===true))&&egg.expiresAt>now);
 candidates.sort((a,b)=>{
  if(a.incomePerSecond!==b.incomePerSecond)return b.incomePerSecond-a.incomePerSecond;
  const left=competition.get(JSON.stringify([a.placeId,a.jobId])).strongestSpeed;
  const right=competition.get(JSON.stringify([b.placeId,b.jobId])).strongestSpeed;
  if(left!==right)return left<right?-1:1;
  return a.key.localeCompare(b.key);
 });
 const target=candidates[0];
 if(!target)return null;
 return {target,immediate:fishing||target.incomePerSecond>=(options.TeleportInstantMin??50e9)};
}
module.exports={planTeleport};


