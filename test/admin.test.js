"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const {WebSocket}=require('ws'),{createServer}=require('../server');
async function wait(fn){const until=Date.now()+4000;while(Date.now()<until){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');}
async function fixture(t,adminUsername='MagixSafe',logs={uri:null}){
 const server=createServer({dashboardAuth:false,history:{uri:null,filePath:null},gateway:{adminUsername,logs,settings:{uri:null}}}),peers=[];
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{for(const p of peers)p.ws.terminate();await server.autoSAE.close();await new Promise(r=>server.close(r));});
 async function peer(role='reporter',clientKind='hub',observerOnly=false){
  const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/sae/ws'),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');
  const p={ws,messages,send:m=>ws.send(JSON.stringify(m)),last:type=>messages.findLast(m=>m.type===type)};peers.push(p);
  p.send({version:1,type:'hello',role,clientKind,observerOnly});await wait(()=>p.last('hello.ack'));return p;
 }
 return {server,peer};
}
function presence(id,name,job='home',revision=1,displayName=name){return {version:1,type:'players.snapshot',moduleId:'PlayerReporter',sessionId:'s'+id,revision,placeId:'123',jobId:job,reporterUserId:id,players:[{userId:id,name,displayName,speedPower:1}]};}
function eggs(revision=1,list=[{uid:'e',category:'Cat',name:'Cat',rarity:'Divine',incomePerSecond:3e9}]){return {version:1,type:'eggs.snapshot',moduleId:'EggReporter',sessionId:'source',revision,placeId:'123',jobId:'remote',cycleId:'1',observedAt:new Date().toISOString(),cycleEndsAt:Date.now()/1000+120,eggs:list};}
const options={AutoEggs:true,AutoIndex:false,AutoTreadmill:false,AutoSell:false,AutoFuse:false,AutoOpen:false,AutoPlace:false,AutoPapillon:false};
for(const key of ['AutoEggs','AutoSell','AutoFuse','AutoOpen','AutoPlace']){options[key+'Min']=2e9;options[key+'Max']=1e33;}
const settings=(revision=1,automationActive=true)=>({version:1,type:'settings.snapshot',sessionId:'admin-session',revision,automationActive,options});
const flight=(sequence,result='Reussi')=>({sequence,text:'[Auto_SAE][0001][12.0][FLIGHT_RESULT][-] Vol '+result});

test('admin requires its raw username AND Admin client; observers and Hub never gain privileges',async t=>{
 const {peer}=await fixture(t),viewer=await peer('viewer');
 assert.equal(viewer.last('admin.state').username,'MagixSafe');assert.equal(viewer.last('admin.state').entry.connected,false);
 for(const [id,name,kind,observer,display]of [['1','MagixSafe','hub',false],['2','Someone','admin',false,'MagixSafe'],['3','MagixSafe','admin',true]]){
  const p=await peer('reporter',kind,observer);p.send(presence(id,name,'home',1,display));await wait(()=>p.last('players.ack'));
  assert.equal(p.last('reporting.policy').admin,false);assert.equal(p.last('reporting.policy').sendLogs,false);
  p.send(settings());await wait(()=>p.last('settings.ack'));assert.equal(p.last('settings.ack').accepted,false);
  p.send({version:1,type:'logs.append',sessionId:id,lines:[flight(1)]});await wait(()=>p.last('logs.ack'));assert.equal(p.last('logs.ack').accepted,false);
  assert.equal(p.messages.some(m=>['teleport.request','eggs.targets','observer.relocate'].includes(m.type)),false);
 }
 viewer.send({type:'delivery.configure',favoriteUserIds:['1']});await wait(()=>viewer.last('error'));assert.match(viewer.last('error').message,/removed/);
 const admin=await peer('reporter','admin');admin.send(presence('42','mAgIxSaFe'));await wait(()=>admin.last('reporting.policy')?.admin);
 await wait(()=>viewer.last('admin.state').entry.connected);assert.equal(viewer.last('admin.state').entry.userId,'42');
 admin.send(presence('42','Changed','home',2));await wait(()=>admin.last('error'));assert.match(admin.last('error').message,/identity changed/);
});

test('only admin FLIGHT_RESULT success/failure logs are stored, replayed, deduplicated and clearable',async t=>{
 const {peer}=await fixture(t),admin=await peer('reporter','admin'),viewer=await peer('viewer');
 admin.send(presence('42','MagixSafe'));await wait(()=>admin.last('players.ack'));
 const batch={version:1,type:'logs.append',sessionId:'logs',lines:[{sequence:1,text:'[Render] diagnostic'},flight(2),flight(3,'Echoue')]};
 admin.send(batch);await wait(()=>viewer.last('logs.append'));assert.equal(viewer.last('logs.append').entries.length,2);assert.equal(admin.last('logs.ack').sequence,3);
 admin.send(batch);await wait(()=>admin.messages.filter(m=>m.type==='logs.ack').length===2);
 const next=await peer('viewer');assert.equal(next.last('logs.state').entries.length,2);assert.ok(next.last('logs.state').entries.every(e=>e.playerName==='MagixSafe'&&e.text.includes('[FLIGHT_RESULT]')));
 admin.send({type:'logs.clear'});await wait(()=>admin.last('error'));assert.match(admin.last('error').message,/viewers/);
 viewer.send({type:'logs.clear'});await wait(()=>next.last('logs.state').entries.length===0);
});

test('admin settings persist offline; auto targets cancel and GO targets only Admin even with automation off',async t=>{
 const {peer}=await fixture(t),viewer=await peer('viewer'),admin=await peer('reporter','admin'),observer=await peer('reporter','observer',true);
 admin.send(presence('42','MagixSafe'));observer.send(presence('7','Observer','remote'));
 await wait(()=>admin.last('players.ack'));await wait(()=>observer.last('players.ack'));
 observer.send(eggs());await wait(()=>observer.last('eggs.ack'));
 await wait(()=>admin.last('eggs.targets')?.eggs.length===1);assert.equal(admin.messages.some(m=>m.type==='teleport.request'),false);
 admin.send(settings());await wait(()=>admin.last('teleport.request')?.target?.jobId==='remote');
 await wait(()=>viewer.last('admin.state').entry.options);assert.equal(viewer.last('admin.state').entry.options.AutoEggsMin,2e9);
 observer.send(eggs(2,[]));await wait(()=>admin.last('teleport.request')?.target===null);
 admin.send(settings(2,false));await wait(()=>admin.last('settings.ack')?.revision===2);
 viewer.send({type:'teleport.manual',placeId:'123',jobId:'remote'});await wait(()=>viewer.last('teleport.manual.ack'));assert.equal(viewer.last('teleport.manual.ack').count,1);
 assert.equal(admin.last('teleport.request').force,true);assert.equal(observer.messages.some(m=>['teleport.request','observer.relocate'].includes(m.type)),false);
 admin.ws.close();await wait(()=>viewer.last('admin.state').entry.connected===false);assert.equal(viewer.last('admin.state').entry.options.AutoEggsMin,2e9);
 const next=await peer('viewer');assert.equal(next.last('admin.state').entry.connected,false);assert.equal(next.last('admin.state').entry.userId,'42');
});

test('ADMIN_USERNAME override selects one configured account and filters archived diagnostics on replay',async t=>{
 const entries=[{id:'1',playerName:'OtherAdmin',at:new Date().toISOString(),text:flight(1).text},{id:'2',playerName:'OtherAdmin',at:new Date().toISOString(),text:'[Render] old'},{id:'3',playerName:'MagixSafe',at:new Date().toISOString(),text:flight(2).text}];
 const collection={async createIndex(){},find(){return {sort(){return this},limit(){return this},async toArray(){return entries;}};}};
 const clientFactory=()=>({async connect(){},async close(){},db(){return {collection(){return collection;}};}});
 const {peer}=await fixture(t,'OtherAdmin',{uri:'fake',clientFactory}),viewer=await peer('viewer');
 await wait(()=>viewer.last('logs.state')?.storage==='mongodb');assert.equal(viewer.last('logs.state').entries.length,1);assert.equal(viewer.last('logs.state').entries[0].id,'1');
 assert.equal(viewer.last('admin.state').username,'OtherAdmin');
});
