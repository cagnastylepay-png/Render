"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{once}=require("node:events");
const {WebSocket}=require("ws"),{createServer}=require("../server"),{createClientLogs}=require("../src/store/ClientLogs");
async function waitFor(fn){const until=Date.now()+4000;while(Date.now()<until){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error("Timeout");}
async function peer(url,role){const ws=new WebSocket(url),messages=[];ws.on("message",data=>messages.push(JSON.parse(data)));await once(ws,"open");ws.send(JSON.stringify({version:1,type:"hello",role}));await waitFor(()=>messages.find(m=>m.type==="hello.ack"));return {ws,messages,send:message=>ws.send(JSON.stringify(message))};}

const {createClientSettings}=require("../src/store/ClientSettings");
const {validateSettings}=require("../src/store/ClientSettings");
const options={AutoEggs:true,AutoTreadmill:true,AutoSell:false,AutoFuse:true,AutoOpen:true,AutoPlace:true,AutoPapillon:false,AutoIndex:true};
for(const key of ["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"]){options[key+"Min"]=2e9;options[key+"Max"]=1e33;}

test('AutoMutations defaults off and accepts independent minimums and bounded integer attempt limits',()=>{
 assert.equal(validateSettings(options).AutoMutations,false);
 const custom={...options,AutoMutations:true,MutationBossEnabled:true,MutationBossMin:8e9,MutationBossAttempts:12};
 const v=validateSettings(custom);assert.equal(v.MutationBossMin,8e9);assert.equal(v.MutationBossAttempts,12);assert.equal(v.MutationNitroEnabled,false);
 for(const value of [0,101,1.5,NaN,'3'])assert.throws(()=>validateSettings({...custom,MutationBossAttempts:value}));
 assert.throws(()=>validateSettings({...custom,MutationBossMin:-1}));
});

test('animal auto sale has an independent disabled default and validates its income range',()=>{
 assert.equal(validateSettings(options).AutoSellAnimals,false);
 const v=validateSettings({...options,AutoSellAnimals:true,AutoSellAnimalsMin:10e9,AutoSellAnimalsMax:20e9});
 assert.equal(v.AutoSellAnimals,true);assert.equal(v.AutoSellAnimalsMin,10e9);assert.equal(v.AutoSellAnimalsMax,20e9);
 for(const patch of [{AutoSellAnimals:'on'},{AutoSellAnimalsMin:NaN},{AutoSellAnimalsMin:-1},{AutoSellAnimalsMax:-1},{AutoSellAnimalsMin:30e9,AutoSellAnimalsMax:20e9}])assert.throws(()=>validateSettings({...options,...patch}));
});

test("settings persist latest values in Mongo and reject invalid snapshots atomically",async()=>{
 let saved=[];const factory=()=>({async connect(){},async close(){},db(){return {collection(){return {async createIndex(){},find(){return {async toArray(){return saved;}}},async bulkWrite(ops){for(const op of ops){const row=op.updateOne.update.$set;saved=saved.filter(old=>old.userId!==row.userId);saved.push(row);}}};}}}});
 const identity={userId:"42",name:"Alice",jobId:"job",placeId:"123"};
 const store=createClientSettings({uri:"fake",clientFactory:factory});await new Promise(r=>setTimeout(r,0));
 const snapshot={version:1,sessionId:"s",revision:1,options};assert.equal(store.accept(identity,snapshot),true);assert.equal(store.accept(identity,snapshot),false);
 assert.throws(()=>store.accept(identity,{...snapshot,revision:2,options:{...options,AutoEggsMin:-1}}));assert.equal(store.get("42").revision,1);
 store.accept(identity,{...snapshot,revision:2,options:{...options,AutoEggs:false}});await store.close();assert.equal(saved.length,1);
 const restored=createClientSettings({uri:"fake",clientFactory:factory});await new Promise(r=>setTimeout(r,0));assert.equal(restored.storage(),"mongodb");assert.equal(restored.get("42").options.AutoEggs,false);await restored.close();
});



test('help favorites are separate, bounded, normalized and disabled by default',()=>{
 const base=validateSettings(options);assert.equal(base.AutoHelp,false);assert.equal(base.AutoHelpMin,2e9);assert.equal(base.HelpFavorites,'');
 const value=validateSettings({...options,AutoHelp:true,AutoHelpMin:3e9,HelpFavorites:'Caylus298878, other_alt; CAYLUS298878'});assert.equal(value.HelpFavorites,'Caylus298878, other_alt');assert.equal(value.AutoHelpMin,3e9);
 for(const bad of [{AutoHelp:'yes'},{AutoHelpMin:-1},{AutoHelpMin:Infinity},{HelpFavorites:['alt']},{HelpFavorites:'bad-name'},{HelpFavorites:'ab'}])assert.throws(()=>validateSettings({...options,...bad}));
});

test('cash upgrade toggles default off and accept only booleans',()=>{
 const defaults=validateSettings(options);assert.equal(defaults.AutoPlotUpgrade,false);assert.equal(defaults.AutoTreadmillUpgrade,false);
 const updated=validateSettings({...options,AutoPlotUpgrade:true,AutoTreadmillUpgrade:true});assert.equal(updated.AutoPlotUpgrade,true);assert.equal(updated.AutoTreadmillUpgrade,true);
 for(const key of ['AutoPlotUpgrade','AutoTreadmillUpgrade'])assert.throws(()=>validateSettings({...options,[key]:'on'}));
});

