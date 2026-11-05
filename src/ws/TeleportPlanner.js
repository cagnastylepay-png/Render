"use strict";
// A typed destination request only: no executable code is sent to reporters.
function planTeleport(identity,settings,eggs,now=Date.now(),players=[]){
 if(!identity||!settings?.automationActive||(!settings.options?.AutoEggs&&!settings.options?.AutoIndex))return null;
 const options=settings.options;
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
  // A roaming observer's last roster remains usable only within its egg cycle.
  if(!list.some(player=>player.reporterConnected||(player.observerSnapshot&&player.observationExpiresAt>now)))continue;
  const known=list.every(player=>Number.isFinite(player.speedPower)&&player.speedPower>=0);
  competition.set(key,{playerCount:list.length,strongestSpeed:known?Math.max(...list.map(player=>player.speedPower)):Infinity});
 }
 const candidates=eggs.filter(egg=>egg.placeId===identity.placeId&&egg.jobId!==identity.jobId&&!visited.has(egg.jobId)&&
  competition.has(JSON.stringify([egg.placeId,egg.jobId]))&&
  !egg.carrierUserId&&egg.state!=="Carried"&&egg.state!=="Claimed"&&!egg.observationOnly&&
  Number.isFinite(egg.incomePerSecond)&&((options.AutoEggs&&egg.incomePerSecond>=options.AutoEggsMin&&egg.incomePerSecond<=options.AutoEggsMax)||
   (options.AutoIndex&&Object.hasOwn(settings.missingCategories||{},egg.category)&&settings.missingCategories[egg.category]===true))&&egg.expiresAt>now);
 candidates.sort((a,b)=>{
  const left=competition.get(JSON.stringify([a.placeId,a.jobId])).strongestSpeed;
  const right=competition.get(JSON.stringify([b.placeId,b.jobId])).strongestSpeed;
  if(left!==right)return left<right?-1:1;
  return b.incomePerSecond-a.incomePerSecond||a.key.localeCompare(b.key);
 });
 const target=candidates[0];
 if(!target)return null;
 return {target,playerCount:competition.get(JSON.stringify([target.placeId,target.jobId])).playerCount,immediate:target.incomePerSecond>=(options.TeleportInstantMin??50e9)};
}
module.exports={planTeleport};