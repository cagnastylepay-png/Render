"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),catalog=require('../src/assets/roblox-images.json');
const mutationCatalog=require('../src/assets/mutation-images.json'),mutations=new Set(Object.values(mutationCatalog).map(r=>r.icon));
const eggs=new Set(Object.values(catalog).map(r=>r.egg)),animals=new Set(Object.values(catalog).map(r=>r.animal)),ids=new Set([...eggs,...animals,...mutations]);
const output=path.join(root,'public','eggs-native'),downloads=path.join(process.env.USERPROFILE,'Downloads');
const imported=[];
for(const name of fs.readdirSync(downloads)){
 const m=name.match(/(\d{10,})(?: \(\d+\))?\.png$/i);if(!m||!ids.has(m[1]))continue;
 const data=fs.readFileSync(path.join(downloads,name));
 if(data.length<24||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))continue;
 const target=path.join(output,m[1]+'.png');if(fs.existsSync(target))continue;
 fs.writeFileSync(target,data);imported.push(m[1]);
}
const images=[],pendingEggs=[],pendingAnimals=[],pendingMutations=[];
for(const id of [...ids].sort()){
 const target=path.join(output,id+'.png');if(!fs.existsSync(target)){if(eggs.has(id))pendingEggs.push(id);if(animals.has(id))pendingAnimals.push(id);if(mutations.has(id))pendingMutations.push(id);continue;}
 const data=fs.readFileSync(target);
 if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG '+id);
 images.push({id,roles:[...(eggs.has(id)?['egg']:[]),...(animals.has(id)?['animal']:[]),...(mutations.has(id)?['mutation']:[])],bytes:data.length,width:data.readUInt32BE(16),height:data.readUInt32BE(20),sha256:crypto.createHash('sha256').update(data).digest('hex')});
}
const manifest={source:'https://rbxdl.johnmarctumulak.com/',method:'Normal free web interface; individual downloads with countdown respected',updatedAt:new Date().toISOString(),catalogEntries:Object.keys(catalog).length,eggTotal:eggs.size,animalTotal:animals.size,images,pendingEggs,pendingAnimals,pendingMutations,mutationTotal:mutations.size};
fs.writeFileSync(path.join(root,'docs','native-images-download-progress.json'),JSON.stringify(manifest,null,2)+'\n');
const failuresPath=path.join(root,'docs','native-image-failures.json');
const attempts=fs.existsSync(failuresPath)?JSON.parse(fs.readFileSync(failuresPath,'utf8')).attempts:[];
const csv=[['Type','Nom','Asset ID','Tentatives','Dernier resultat']];
for(const [kind,pending]of [['egg',pendingEggs],['animal',pendingAnimals],['mutation',pendingMutations]])for(const id of pending){
 const names=kind==='mutation'?Object.values(mutationCatalog).filter(r=>r.icon===id).map(r=>r.name):[...new Set(Object.values(catalog).filter(r=>r[kind]===id).map(r=>r.displayName))];
 const history=attempts.filter(r=>r.id===id&&r.kind===kind);
 csv.push([kind==='egg'?'Oeuf':kind==='mutation'?'Mutation':'Animal',names.join(' / '),id,Math.max(0,...history.map(r=>r.attempt||0)),history.at(-1)?.result||'Pas encore tente']);
}
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
fs.writeFileSync(path.join(root,'docs','images-a-recuperer.csv'),'\uFEFF'+csv.map(row=>row.map(quote).join(';')).join('\n')+'\n');
console.log(JSON.stringify({imported,eggs:eggs.size-pendingEggs.length,eggTotal:eggs.size,animals:animals.size-pendingAnimals.length,animalTotal:animals.size,pendingEggs:pendingEggs.length,pendingAnimals:pendingAnimals.length}));
