"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {getGameImageIds,getEggImage}=require("../src/assets/EggImages");
const catalog=require("../src/assets/roblox-images.json");
test("Render serves native PNG images with cache headers and validates the route",async t=>{
 const {once}=require("node:events"),{createServer}=require("../server");
 const server=createServer({history:{uri:null,filePath:null},gateway:{delivery:{uri:null,filePath:null},logs:{uri:null}}});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await server.autoSAE.close();await new Promise(resolve=>server.close(resolve));});
 const base="http://127.0.0.1:"+server.address().port;
 const response=await fetch(base+"/eggs-native/123926130544109.png");assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/image\/png/);assert.match(response.headers.get("cache-control"),/86400/);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,48050);assert.deepEqual([...bytes.subarray(0,4)],[137,80,78,71]);
 assert.equal((await fetch(base+"/eggs-native/unknown.png")).status,404);
 const head=await fetch(base+"/eggs-native/123926130544109.png",{method:"HEAD"});assert.equal((await head.arrayBuffer()).byteLength,0);
});
test("native image catalog separates egg and animal IDs and serves the downloaded eggs",()=>{
 assert.equal(Object.keys(catalog).length,265);
 for(const row of Object.values(catalog)){assert.match(row.egg,/^\d+$/);assert.match(row.animal,/^\d+$/);}
 for(const [name,row]of Object.entries(catalog))assert.equal(getEggImage({category:name}),"/eggs-native/"+row.egg+".png",name);
 assert.deepEqual(getGameImageIds({category:"Dog"}),{egg:"123926130544109",animal:"128470938015055"});
 assert.deepEqual(getGameImageIds({name:"Phoenix"}),getGameImageIds({category:"Ascended Vermilion Phoenix"}));
 assert.deepEqual(getGameImageIds({category:"Abyss Overlord"}),getGameImageIds({category:"Abyssal Overlord"}));
 assert.equal(getGameImageIds({category:"unknown"}),null);
 assert.equal(getEggImage({category:"Dog"}),"/eggs-native/123926130544109.png");
});

