"use strict";
const {randomUUID}=require('node:crypto');
const {validateSettings}=require('../store/ClientSettings');
const {getEggImage,getAnimalImage,registerGameImageIds}=require('../assets/EggImages');
const actions=new Set(['images.collect','egg.mutate','egg.open','egg.sell','egg.place','animal.sell','animal.fuse','equip.best','settings.update','automation.set']);
function imageId(value){if(value==null)return null;if(typeof value!=='string'||!(/^[1-9]\d{0,19}$/).test(value))throw Error('Invalid Roblox image asset ID');return value;}
function validateInventory(m){
 if(m.version!==1||typeof m.sessionId!=='string'||!m.sessionId||m.sessionId.length>100||!Number.isSafeInteger(m.revision)||m.revision<1)throw Error('Invalid admin inventory');
 const metric=v=>v==null?null:typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e100?v:(()=>{throw Error('Invalid metric');})();
 const list=(rows,kind)=>{
  if(!Array.isArray(rows)||rows.length>5000)throw Error('Invalid inventory list');const seen=new Set();
  return rows.map(r=>{if(!r||typeof r.uid!=='string'||!r.uid||r.uid.length>128||seen.has(r.uid)||!['plot','backpack'].includes(r.location)||typeof r.name!=='string'||r.name.length>160||typeof r.category!=='string'||r.category.length>160)throw Error('Invalid inventory item');seen.add(r.uid);
   if(r.rarity!=null&&(typeof r.rarity!=='string'||r.rarity.length>40))throw Error('Invalid rarity');
   if(r.mutations!=null&&(!Array.isArray(r.mutations)||r.mutations.length>32||r.mutations.some(v=>typeof v!=='string'||!v||v.length>100)))throw Error('Invalid mutations');
   if(r.baseMutation!=null&&(typeof r.baseMutation!=='string'||r.baseMutation.length>100))throw Error('Invalid base mutation');
   const value={uid:r.uid,name:r.name,category:r.category,rarity:r.rarity||'Unknown',mutations:r.mutations||[],baseMutation:r.baseMutation||null,eggImageAssetId:imageId(r.eggImageAssetId),animalImageAssetId:imageId(r.animalImageAssetId),location:r.location,incomePerSecond:metric(r.incomePerSecond),weightKg:metric(r.weightKg),sellValue:metric(r.sellValue),remainingSeconds:kind==='egg'?metric(r.remainingSeconds):null,ready:r.ready===true,locked:r.locked===true};
   return value;});
 };
 const stats={};for(const key of ['speedPower','money','incomePerSecond','offlinePerDay','offlineDurationSeconds','offlineRateMultiplier'])stats[key]=metric(m.stats?.[key]);
 const ids=new Set();const mutationConsumables=m.mutationConsumables??[];
 if(!Array.isArray(mutationConsumables)||mutationConsumables.length>32)throw Error('Invalid mutation inventory');
 const mutations=mutationConsumables.map(r=>{
  if(!r||typeof r.id!=='string'||!r.id||r.id.length>80||ids.has(r.id)||typeof r.name!=='string'||r.name.length>100||!Number.isSafeInteger(r.count)||r.count<0||r.count>1e9)throw Error('Invalid mutation consumable');ids.add(r.id);
  const successPercent=metric(r.successPercent),multiplier=metric(r.multiplier);if(successPercent>100)throw Error('Invalid mutation probability');
  return {id:r.id,name:r.name,count:r.count,successPercent,multiplier};
 });
 if(m.mutationStatus!=null&&(typeof m.mutationStatus!=='string'||m.mutationStatus.length>500))throw Error('Invalid mutation status');
 if(m.automationStatus!=null&&(typeof m.automationStatus!=='string'||m.automationStatus.length>500))throw Error('Invalid automation status');
 const imageCatalog=m.imageCatalog??[];if(!Array.isArray(imageCatalog)||imageCatalog.length>5000)throw Error('Invalid image catalog');
 const images=imageCatalog.map(r=>{if(!r||typeof r.category!=='string'||!r.category||r.category.length>160||typeof r.name!=='string'||r.name.length>160)throw Error('Invalid image catalog entry');return {category:r.category,name:r.name,eggImageAssetId:imageId(r.eggImageAssetId),animalImageAssetId:imageId(r.animalImageAssetId)};});
 const eggs=list(m.eggs,'egg'),animals=list(m.animals,'animal');
 // Register only after validating the whole snapshot, so rejected messages cannot extend the image allowlist.
 for(const r of [...images,...eggs,...animals])registerGameImageIds(r);
 for(const r of eggs)r.imageUrl=getEggImage(r);for(const r of animals)r.imageUrl=getAnimalImage(r);
 return {sessionId:m.sessionId,revision:m.revision,receivedAt:Date.now(),stats,eggs,animals,imageCatalog:images,mutationConsumables:mutations,mutationStatus:m.mutationStatus||null,automationStatus:m.automationStatus||null};
}
function createAdminPanel({send,viewers,adminSocket,settings,onChange,now=Date.now}){
 let inventory=null,pending=null,lastResult=null;const seen=new Map();
 const snapshot=()=>{const admin=adminSocket();return {version:1,type:'admin.inventory.state',inventory,connected:Boolean(admin&&inventory&&inventory.connectionId===admin.connectionId),pending:pending?{requestId:pending.requestId,action:pending.action}:null,result:lastResult};};
 const broadcast=()=>{for(const v of viewers())send(v,snapshot());};
 function finish(status,message){if(!pending)return;clearTimeout(pending.timer);lastResult={requestId:pending.requestId,action:pending.action,status,message,at:now()};seen.set(pending.clientRequestId,lastResult);while(seen.size>100)seen.delete(seen.keys().next().value);pending=null;broadcast();}
 return {
  state:snapshot,
  changed(){if(pending&&adminSocket()?.connectionId!==pending.connectionId)finish('unknown','Connexion interrompue : résultat inconnu, aucune relance automatique.');broadcast();},
  accept(ws,m){const value=validateInventory(m);if(inventory?.connectionId===ws.connectionId&&inventory.sessionId===value.sessionId&&inventory.revision>=value.revision)return false;inventory={...value,connectionId:ws.connectionId};broadcast();return true;},
  command(viewer,m){
   if(!actions.has(m.action))throw Error('Unknown admin action');
   if(typeof m.clientRequestId!=='string'||!m.clientRequestId||m.clientRequestId.length>100)throw Error('Invalid request ID');
   if(seen.has(m.clientRequestId)){send(viewer,{version:1,type:'admin.command.result',...seen.get(m.clientRequestId)});return;}
   if(pending){if(pending.clientRequestId===m.clientRequestId){send(viewer,{version:1,type:'admin.command.ack',requestId:pending.requestId});return;}throw Error('Une action Admin est déjà en cours');}
   const admin=adminSocket();if(!admin)throw Error('Admin.lua déconnecté');
   let payload={};
   if(m.action==='automation.set'){
    if(typeof m.enabled!=='boolean')throw Error('Invalid automation switch');payload={enabled:m.enabled};
   }else if(m.action==='settings.update'){
    const saved=settings.get(admin.reporterIdentity.userId);if(!saved||m.settingsRevision!==saved.revision||m.settingsSessionId!==saved.sessionId)throw Error('Paramètres modifiés : recharge les valeurs');
    payload={options:validateSettings(m.options),settingsRevision:saved.revision};
   }else{
    if(!inventory||inventory.connectionId!==admin.connectionId||now()-inventory.receivedAt>30000||m.inventoryRevision!==inventory.revision||m.inventorySessionId!==inventory.sessionId)throw Error('Inventaire périmé : attends sa mise à jour');
    if(!['equip.best','images.collect'].includes(m.action)){
     const kind=m.action.startsWith('egg.')?'eggs':'animals',item=inventory[kind].find(r=>r.uid===m.uid);
     if(!item)throw Error('Objet absent');if(item.locked)throw Error('Objet verrouillé ou occupé');
     if((['egg.open','egg.mutate'].includes(m.action))!==(item.location==='plot'))throw Error('Action incompatible avec cet emplacement');
     if(m.action==='egg.open'&&!item.ready)throw Error('Œuf pas encore prêt');
     payload.uid=item.uid;
     if(m.action==='egg.mutate'){
      const mutation=inventory.mutationConsumables.find(r=>r.id===m.mutationId&&r.count>0);
      if(!mutation||!['Boss','Scrambled','Enchanted','Nitro','Spectral','Musical','Alien','DarkMatter'].includes(m.mutationId)||item.baseMutation===m.mutationId||item.mutations.includes(m.mutationId))throw Error('Mutation absente ou déjà appliquée');
      payload.mutationId=m.mutationId;
     }
     if(m.action==='animal.fuse'){
      if(!Array.isArray(m.uids)||m.uids.length!==3||new Set(m.uids).size!==3||!m.uids.includes(item.uid))throw Error('Sélectionne trois animaux distincts');
      if(m.uids.some(uid=>!inventory.animals.some(a=>a.uid===uid&&a.location==='backpack'&&!a.locked&&a.category===item.category)))throw Error('Fusion : trois animaux disponibles de même espèce requis');
      payload.uids=m.uids;
     }
    }
   }
   const requestId=randomUUID();pending={requestId,clientRequestId:m.clientRequestId,connectionId:admin.connectionId,action:m.action,timer:setTimeout(()=>finish('unknown','Délai dépassé : résultat inconnu, aucune relance automatique.'),120000)};pending.timer.unref();
   send(admin,{version:1,type:'admin.command',requestId,action:m.action,...payload});send(viewer,{version:1,type:'admin.command.ack',requestId});broadcast();
  },
  result(ws,m){if(!pending||pending.connectionId!==ws.connectionId||pending.requestId!==m.requestId)return false;
   if(!['confirmed','rejected','unknown'].includes(m.status)||typeof m.message!=='string'||m.message.length>500)throw Error('Invalid admin result');finish(m.status,m.message);onChange();return true;},
  close(){if(pending)clearTimeout(pending.timer);}
 };
}
module.exports={createAdminPanel,validateInventory};
