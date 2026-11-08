"use strict";
const catalog = require("./egg-images.json");
const fs=require("node:fs"),path=require("node:path");
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/egg$/, "");
}
const byName = new Map(Object.entries(catalog).map(([name, url]) => [normalize(name), url]));
function getEggImage(egg) {
  const ids=getGameImageIds(egg);
  if(ids&&fs.existsSync(path.join(__dirname,"../../public/eggs-native",ids.egg+".png")))return "/eggs-native/"+ids.egg+".png";
  for (const name of [egg.category, egg.name, egg.eggName]) {
    const result = byName.get(normalize(name));
    if (result) return result;
  }
  return null;
}

const nativeCatalog=require("./roblox-images.json");
const nativeByName=new Map();
for(const [name,images] of Object.entries(nativeCatalog))for(const alias of [name,images.displayName])if(alias)nativeByName.set(normalize(alias),images);
function getGameImageIds(item){
 for(const name of [item.category,item.name,item.eggName]){
  const row=nativeByName.get(normalize(name));
  if(row)return {egg:row.egg,animal:row.animal};
 }
 return null;
}

function getAnimalImage(item){
 const ids=getGameImageIds(item);
 if(!ids)return null;
 return fs.existsSync(path.join(__dirname,"../../public/eggs-native",ids.animal+".png"))?"/eggs-native/"+ids.animal+".png":"/animals/"+ids.animal+".png";
}
module.exports = { getEggImage, getGameImageIds, getAnimalImage };


