"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {getGameImageIds,getEggImage}=require("../src/assets/EggImages");
const catalog=require("../src/assets/roblox-images.json");
test("Render serves native PNG images with cache headers and validates the route",async t=>{
 const {once}=require("node:events"),{createServer}=require("../server");
 const server=createServer({dashboardAuth:false,history:{uri:null,filePath:null},gateway:{delivery:{uri:null,filePath:null},logs:{uri:null}}});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await server.autoSAE.close();await new Promise(resolve=>server.close(resolve));});
 const base="http://127.0.0.1:"+server.address().port;
 const response=await fetch(base+"/eggs-native/123926130544109.png");assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/image\/png/);assert.match(response.headers.get("cache-control"),/86400/);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,48050);assert.deepEqual([...bytes.subarray(0,4)],[137,80,78,71]);
 assert.equal((await fetch(base+"/eggs-native/unknown.png")).status,404);
 const head=await fetch(base+"/eggs-native/123926130544109.png",{method:"HEAD"});assert.equal((await head.arrayBuffer()).byteLength,0);
});
test("native image catalog separates egg and animal IDs and serves the downloaded eggs",()=>{
 assert.equal(Object.keys(catalog).length,302);
 for(const row of Object.values(catalog)){assert.match(row.egg,/^\d+$/);assert.match(row.animal,/^\d+$/);}
 const fs=require('node:fs'),path=require('node:path');
 for(const [name,row]of Object.entries(catalog))assert.equal(getEggImage({category:name}),(fs.existsSync(path.join(__dirname,'../public/eggs-native',row.egg+'.png'))?'/eggs-native/':'/animals/')+row.egg+'.png',name);
 for(const [category,egg,animal]of [
  ['Centaur','94996357404675','136114731886336'],
  ['Dark Gargoyle','119732629571247','99077940722686'],
  ['Pegasus','79544542526316','112830316982322'],
  ['Moth','104832997526909','114029210145538'],
  ['Skeleton Horse','136184113799222','78230812200224'],
  ['Viridian Prowler','118206409822370','70369321977430']
 ])assert.deepEqual(getGameImageIds({category}),{egg,animal},category);
 assert.deepEqual(getGameImageIds({category:"Dog"}),{egg:"123926130544109",animal:"128470938015055"});
 assert.deepEqual(getGameImageIds({name:"Phoenix"}),getGameImageIds({category:"Ascended Vermilion Phoenix"}));
 assert.deepEqual(getGameImageIds({category:"Abyss Overlord"}),getGameImageIds({category:"Abyssal Overlord"}));
 assert.equal(getGameImageIds({category:"unknown"}),null);
 assert.equal(getEggImage({category:"Dog"}),"/eggs-native/123926130544109.png");
});


