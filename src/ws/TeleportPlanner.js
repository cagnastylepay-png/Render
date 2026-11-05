"use strict";
// A typed destination request only: no executable code is sent to reporters.
function planTeleport(identity,settings,eggs,now=Date.now()){
 if(!identity||!settings?.automationActive||!settings.options?.AutoEggs)return null;
 const options=settings.options;
 const visited=new Set(settings.visitedJobIds||[]);
 const candidates=eggs.filter(egg=>egg.placeId===identity.placeId&&egg.jobId!==identity.jobId&&!visited.has(egg.jobId)&&
  !egg.carrierUserId&&egg.state!=="Carried"&&!egg.observationOnly&&
  Number.isFinite(egg.incomePerSecond)&&egg.incomePerSecond>=options.AutoEggsMin&&egg.incomePerSecond<=options.AutoEggsMax&&egg.expiresAt>now);
 candidates.sort((a,b)=>b.incomePerSecond-a.incomePerSecond||a.key.localeCompare(b.key));
 const target=candidates[0];
 if(!target)return null;
 return {target,immediate:target.incomePerSecond>=(options.TeleportInstantMin??100e9)};
}
module.exports={planTeleport};
