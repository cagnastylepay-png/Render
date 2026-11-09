"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {allowedBiome,biomeIds}=require('../src/store/Biomes');
const {validateSettings}=require('../src/store/ClientSettings');
const {planTeleport}=require('../src/ws/TeleportPlanner');
function options(){const o={};for(const k of ['AutoEggs','AutoTreadmill','AutoSell','AutoFuse','AutoOpen','AutoPlace','AutoPapillon','AutoIndex'])o[k]=true;for(const k of ['AutoEggs','AutoSell','AutoFuse','AutoOpen','AutoPlace']){o[k+'Min']=0;o[k+'Max']=1e33;}return o;}
test('maximum biome defaults to All, validates exact IDs and includes earlier biomes',()=>{
 assert.equal(biomeIds.length,14);assert.equal(validateSettings(options()).AutoEggsMaxBiome,'All');
 assert.equal(validateSettings({...options(),AutoEggsMaxBiome:'Snow'}).AutoEggsMaxBiome,'Snow');
 for(const v of ['unknown',4,null,{},'Aliens'])assert.throws(()=>validateSettings({...options(),AutoEggsMaxBiome:v}));
 assert.ok(allowedBiome({areaId:'Forest'},'Snow'));assert.ok(allowedBiome({areaId:'Snow'},'Snow'));
 assert.equal(allowedBiome({areaId:'Volcano'},'Snow'),false);assert.equal(allowedBiome({},'Snow'),false);
 assert.equal(allowedBiome({areaId:'Alien'},'Prehistoric'),false);assert.ok(allowedBiome({},'All'));
});
test('automatic destination planning applies biome limit to missing and normal eggs',()=>{
 const now=1000,identity={placeId:'p',jobId:'home'},settings={automationActive:true,options:{...options(),AutoEggsMaxBiome:'Forest'},missingCategories:{cat:true}};
 const egg={placeId:'p',jobId:'other',category:'cat',key:'a',areaId:'Alien',incomePerSecond:50,expiresAt:2000};
 const players=[{placeId:'p',jobId:'other',userId:'1',reporterConnected:true,speedPower:1}];
 assert.equal(planTeleport(identity,settings,[egg],now,players),null);
 assert.equal(planTeleport(identity,settings,[{...egg,areaId:'Forest'}],now,players).target.areaId,'Forest');
 settings.options.AutoEggs=false;assert.equal(planTeleport(identity,settings,[egg],now,players),null);
});

