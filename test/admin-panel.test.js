"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createAdminPanel,validateInventory}=require('../src/ws/AdminPanel');
const options={AutoEggs:true,AutoIndex:false,AutoTreadmill:false,AutoSell:false,AutoFuse:false,AutoOpen:false,AutoPlace:false,AutoPapillon:false,QueueNearest:false,TeleportInstantMin:50e9};
for(const key of ['AutoEggs','AutoSell','AutoFuse','AutoOpen','AutoPlace']){options[key+'Min']=0;options[key+'Max']=1e33;}
const item=(uid,location='backpack',extra={})=>({uid,name:'Cat',category:'Cat',location,...extra});
const inventory=(revision=1)=>({version:1,type:'admin.inventory.snapshot',sessionId:'inventory',revision,stats:{money:1e12,speedPower:1e9,incomePerSecond:3e9,offlinePerDay:3e9*36000*.1,offlineDurationSeconds:36000,offlineRateMultiplier:.1},eggs:[item('open','plot',{ready:true,remainingSeconds:0}),item('growing','plot',{ready:false,remainingSeconds:90}),item('egg')],animals:[item('a'),item('b'),item('c'),item('worn','plot'),item('locked','backpack',{locked:true})]});
function harness(t){
 const messages=[],admin={connectionId:'admin',reporterIdentity:{userId:'42'}},viewer={connectionId:'viewer'},saved={sessionId:'settings',revision:1,options};let active=admin,now=Date.now();
 const panel=createAdminPanel({send:(ws,m)=>messages.push({ws,m}),viewers:()=>[viewer],adminSocket:()=>active,settings:{get:()=>saved},onChange(){},now:()=>now});t.after(()=>panel.close());
 const command=(action,extra={})=>panel.command(viewer,{clientRequestId:'id-'+messages.length,action,inventoryRevision:1,inventorySessionId:'inventory',...extra});
 return {panel,admin,viewer,messages,saved,command,offline(){active=null;panel.changed();},age(){now+=31000;}};
}
test('inventory preserves exact game metrics and rejects malformed/duplicate/oversized records',()=>{
 const value=validateInventory(inventory());assert.equal(value.stats.offlinePerDay,3e9*3600);assert.equal(value.eggs[0].ready,true);
 assert.throws(()=>validateInventory({...inventory(),eggs:{}}));assert.throws(()=>validateInventory({...inventory(),eggs:[item('a'),item('a')]}));
 assert.throws(()=>validateInventory({...inventory(),stats:{money:NaN}}));assert.throws(()=>validateInventory({...inventory(),animals:[item('x','other')]}));
 assert.throws(()=>validateInventory({...inventory(),eggs:Array.from({length:5001},(_,i)=>item(String(i)))}));
});

test('admin images distinguish eggs and animals, preserve mutations and reject unsafe metadata',()=>{
 const snapshot={...inventory(),eggs:[{...item('egg'),category:'Dog',rarity:'Common',baseMutation:'Gold',mutations:['Rainbow']}],animals:[{...item('animal'),category:'Dog'}]};
 const value=validateInventory(snapshot);assert.equal(value.eggs[0].imageUrl,'/eggs-native/123926130544109.png');assert.match(value.animals[0].imageUrl,/128470938015055\.png$/);assert.notEqual(value.eggs[0].imageUrl,value.animals[0].imageUrl);assert.deepEqual(value.eggs[0].mutations,['Rainbow']);
 assert.throws(()=>validateInventory({...snapshot,eggs:[{...snapshot.eggs[0],mutations:{}}]}));
 assert.throws(()=>validateInventory({...snapshot,eggs:[{...snapshot.eggs[0],baseMutation:4}]}));
});
test('commands revalidate ownership, placement, readiness, freshness, fusion membership and options',t=>{
 const h=harness(t);h.panel.accept(h.admin,inventory());
 for(const [action,extra]of [['egg.open',{uid:'egg'}],['egg.sell',{uid:'open'}],['egg.open',{uid:'growing'}],['animal.sell',{uid:'worn'}],['animal.sell',{uid:'locked'}],['animal.fuse',{uid:'a',uids:['a','a','c']}],['animal.fuse',{uid:'a',uids:['a','b','worn']}],['egg.sell',{uid:'missing'}]])assert.throws(()=>h.command(action,extra));
 assert.throws(()=>h.command('execute',{code:'print(1)'}));assert.throws(()=>h.command('egg.sell',{uid:'egg',inventoryRevision:0}));
 assert.throws(()=>h.command('settings.update',{settingsSessionId:'settings',settingsRevision:0,options}));
 assert.throws(()=>h.command('settings.update',{settingsSessionId:'settings',settingsRevision:1,options:{...options,AutoEggsMin:-1}}));
 h.age();assert.throws(()=>h.command('equip.best'),/périmé/);h.offline();assert.throws(()=>h.command('equip.best'),/déconnecté/);
});
test('one action at a time, no duplicate forwarding, matching session result only and disconnect is unknown',t=>{
 const h=harness(t);assert.equal(h.panel.accept(h.admin,inventory()),true);assert.equal(h.panel.accept(h.admin,inventory()),false);
 const command={clientRequestId:'stable',action:'egg.sell',uid:'egg',inventoryRevision:1,inventorySessionId:'inventory'};
 h.panel.command(h.viewer,command);const forwarded=h.messages.find(x=>x.ws===h.admin).m;
 assert.equal(forwarded.action,'egg.sell');assert.equal(forwarded.uid,'egg');h.panel.command(h.viewer,command);
 assert.equal(h.messages.filter(x=>x.ws===h.admin).length,1);assert.throws(()=>h.command('equip.best'),/cours/);
 assert.equal(h.panel.result({connectionId:'other'},{requestId:forwarded.requestId,status:'confirmed',message:'fake'}),false);
 assert.equal(h.panel.result(h.admin,{requestId:forwarded.requestId,status:'confirmed',message:'Vente confirmée'}),true);
 h.panel.command(h.viewer,command);assert.equal(h.messages.filter(x=>x.ws===h.admin).length,1);
 h.command('animal.fuse',{uid:'a',uids:['a','b','c']});assert.deepEqual(h.messages.findLast(x=>x.ws===h.admin).m.uids,['a','b','c']);
 h.offline();assert.equal(h.panel.state().result.status,'unknown');assert.equal(h.panel.state().pending,null);
});
test('settings and automation are typed requests and do not change saved settings before client confirmation',t=>{
 const h=harness(t);h.command('settings.update',{settingsSessionId:'settings',settingsRevision:1,options:{...options,AutoEggs:false}});
 const forwarded=h.messages.find(x=>x.ws===h.admin).m;assert.equal(forwarded.options.AutoEggs,false);assert.equal(h.saved.options.AutoEggs,true);
 h.panel.result(h.admin,{requestId:forwarded.requestId,status:'confirmed',message:'Paramètres appliqués'});
 h.command('automation.set',{enabled:false});assert.equal(h.messages.findLast(x=>x.ws===h.admin).m.enabled,false);
});
