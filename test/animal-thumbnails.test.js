"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{createAnimalThumbnails}=require('../src/assets/AnimalThumbnails');
test('animal thumbnails batch, deduplicate, cache and allow only catalog assets and Roblox CDN URLs',async()=>{
 let calls=0;const service=createAnimalThumbnails({fetchImpl:async url=>{calls++;assert.match(url,/^https:\/\/thumbnails.roblox.com\//);return {ok:true,json:async()=>({data:[{targetId:128470938015055,state:'Completed',imageUrl:'https://tr.rbxcdn.com/dog.png'}]})};}});
 assert.equal(await service.resolve('999999999'),null);assert.equal(calls,0);
 const [a,b]=await Promise.all([service.resolve('128470938015055'),service.resolve('128470938015055')]);assert.equal(a,b);assert.equal(a,'https://tr.rbxcdn.com/dog.png');assert.equal(calls,1);await service.resolve('128470938015055');assert.equal(calls,1);
 const unsafe=createAnimalThumbnails({fetchImpl:async()=>({ok:true,json:async()=>({data:[{targetId:128470938015055,state:'Completed',imageUrl:'https://evil.example/dog.png'}]})})});assert.equal(await unsafe.resolve('128470938015055'),null);
});
