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
  if(ids?.egg)return "/animals/"+ids.egg+".png";
  for (const name of [egg.category, egg.name, egg.eggName]) {
    const result = byName.get(normalize(name));
    if (result) return result;
  }
  return null;
}

const mutationCatalog=require("./mutation-images.json");
function getMutationImage(id){const asset=mutationCatalog[id]?.icon;if(!asset)return null;return fs.existsSync(path.join(__dirname,"../../public/eggs-native",asset+".png"))?"/eggs-native/"+asset+".png":"/animals/"+asset+".png";}
const nativeCatalog=require("./roblox-images.json");
const nativeByName=new Map();
const dynamicByName=new Map(),allowedIds=new Set(Object.values(nativeCatalog).flatMap(row=>[row.egg,row.animal]).filter(Boolean));
function registerGameImageIds(item){
 for(const key of ['eggImageAssetId','animalImageAssetId'])if(item[key]!=null&&(typeof item[key]!=='string'||!(/^[1-9]\d{0,19}$/).test(item[key])))throw Error('Invalid Roblox image asset ID');
 const old=getGameImageIds(item)||{},egg=item.eggImageAssetId||old.egg,animal=item.animalImageAssetId||old.animal;
 if(!egg&&!animal)return;
 const row={egg,animal};for(const id of [egg,animal])if(id)allowedIds.add(id);
 for(const name of [item.category,item.name])if(name)dynamicByName.set(normalize(name),row);
}
for(const row of Object.values(mutationCatalog))allowedIds.add(row.icon);
function isAllowedGameImage(id){return allowedIds.has(id);}
for(const [name,images] of Object.entries(nativeCatalog))for(const alias of [name,images.displayName])if(alias)nativeByName.set(normalize(alias),images);
function getGameImageIds(item){
 for(const name of [item.category,item.name,item.eggName]){
  const row=dynamicByName.get(normalize(name))||nativeByName.get(normalize(name));
  if(row)return {egg:row.egg,animal:row.animal};
 }
 return null;
}

function getAnimalImage(item){
 const ids=getGameImageIds(item);
 if(!ids?.animal)return null;
 return fs.existsSync(path.join(__dirname,"../../public/eggs-native",ids.animal+".png"))?"/eggs-native/"+ids.animal+".png":"/animals/"+ids.animal+".png";
}
module.exports = { getMutationImage, getEggImage, getGameImageIds, getAnimalImage, registerGameImageIds,isAllowedGameImage };


