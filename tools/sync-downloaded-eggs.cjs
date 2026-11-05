"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),catalog=require("../src/assets/roblox-images.json");
const ids=new Set(Object.values(catalog).map(row=>row.egg));
const downloads=path.join(process.env.USERPROFILE,"Downloads"),output=path.join(root,"public","eggs-native");
fs.mkdirSync(output,{recursive:true});
for(const name of fs.readdirSync(downloads)){
 const match=name.match(/(\d{10,})(?: \(\d+\))?\.png$/i);if(!match||!ids.has(match[1]))continue;
 const source=path.join(downloads,name),data=fs.readFileSync(source);
 if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))continue;
 fs.copyFileSync(source,path.join(output,match[1]+".png"));
}
const images=[],pending=[];
for(const id of [...ids].sort()){
 const filename=path.join(output,id+".png");if(!fs.existsSync(filename)){pending.push(id);continue;}
 const data=fs.readFileSync(filename);
 images.push({id,path:"/eggs-native/"+id+".png",bytes:data.length,width:data.readUInt32BE(16),height:data.readUInt32BE(20),sha256:crypto.createHash("sha256").update(data).digest("hex")});
}
fs.writeFileSync(path.join(root,"docs","native-eggs-download-progress.json"),JSON.stringify({source:"https://rbxdl.johnmarctumulak.com/",method:"Individual download through the normal free interface",updatedAt:new Date().toISOString(),total:ids.size,images,pending},null,2)+"\n");
console.log(JSON.stringify({downloaded:images.length,total:ids.size,remaining:pending.length}));

