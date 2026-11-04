"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
function harness(){
 const roots=new Map();
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this._text="";this.value="";this.srcWrites=0;}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join("");}
  set textContent(value){this._text=String(value);this.replaceChildren();}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  insertBefore(node,before){node.remove();node.parent=this;const index=this.children.indexOf(before);if(index<0)this.children.push(node);else this.children.splice(index,0,node);}
  remove(){if(this.parent){const list=this.parent.children,index=list.indexOf(this);if(index>=0)list.splice(index,1);this.parent=null;}}
  replaceChildren(...nodes){for(const old of this.children)old.parent=null;this.children=[];this.append(...nodes);}
  setAttribute(key,value){this[key]=value;}
  removeAttribute(key){delete this[key];}
  set src(value){this._src=value;this.srcWrites++;}
  get src(){return this._src;}
  insertRow(){const tr=new Element("tr");this.append(tr);return tr;}
  insertCell(){const td=new Element("td");this.append(td);return td;}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(child.tag===selector)result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
 }
 for(const match of html.matchAll(/id="([^"]+)"/g))roots.set(match[1],new Element("div"));
 const document={createElement:tag=>new Element(tag),getElementById(id){if(roots.has(id))return roots.get(id);for(const root of roots.values()){const search=node=>node.id===id?node:node.children.map(search).find(Boolean);const found=search(root);if(found)return found;}return null;}};
 class FakeSocket{constructor(){FakeSocket.current=this;}send(){}close(){}}
 const context=vm.createContext({document,WebSocket:FakeSocket,location:{protocol:"http:",host:"test"},Intl,Date,Map,Set,Math,Number,JSON,String,
  setInterval(){},clearTimeout(){},setTimeout(){},console});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 return {context,document,emit:message=>FakeSocket.current.onmessage({data:JSON.stringify(message)})};
}
test("WebSocket updates retain image nodes, open sections and use game speed",()=>{
 const h=harness(),egg={key:"123/job/egg",uid:"egg",placeId:"123",jobId:"job",name:"Ice Dragon",rarity:"Eternal",imageUrl:"/eggs/ice.webp",
  incomePerSecond:2e9,weightKg:1400,sellValue:8e12,expiresAt:Date.now()+60000};
 const eggs=()=>({type:"eggs.state",serverCount:1,nextResetAt:Date.now()+60000,eggs:[egg]});
 h.emit(eggs());
 const container=h.document.getElementById("cards"),card=container.children[0],image=card.querySelectorAll("img")[0],details=card.querySelectorAll("details");
 details[0].open=true;details[1].open=true;
 assert.equal(image.loading,"eager");
 image.onload();assert.equal(image.hidden,false);
 h.emit({type:"players.state",players:[{placeId:"123",jobId:"job",userId:"1",name:"Alice",displayName:"Alice",reporterConnected:true,walkSpeed:16,speedPower:3e12,incomePerSecond:4e15}]});
 egg.incomePerSecond=5e9;
 h.emit(eggs());h.emit(eggs());
 assert.equal(container.children[0],card);
 assert.equal(card.querySelectorAll("img")[0],image);
 assert.equal(image.srcWrites,1);
 assert.equal(details[0].open,true);assert.equal(details[1].open,true);
 assert.match(card.textContent,/Vitesse 3T/);
 assert.match(card.textContent,/4Qa\/s/);
 assert.doesNotMatch(card.textContent,/Puissance/);
 assert.equal(h.document.getElementById("tab-players"),null);
});
test("game suffixes and receipts-only history",()=>{
 const h=harness();
 for(const [value,expected]of [[1e9,"1B"],[1e12,"1T"],[1e15,"1Qa"],[1e18,"1Qi"],[999999,"1M"]])
  assert.equal(vm.runInContext("formatNumber("+value+")",h.context),expected);
 const egg={name:"Egg",rarity:"Divine",weightKg:1200,incomePerSecond:2e9,globalUid:"job/egg",cycleId:"1"};
 h.emit({type:"history.state",entries:[
  {id:"a",at:"2026-11-04T10:00:00Z",action:"appeared",egg},
  {id:"b",at:"2026-11-04T10:00:01Z",action:"disappeared",egg},
  {id:"c",at:"2026-11-04T10:00:02Z",action:"updated",egg}
 ],storage:"mongodb"});
 const body=h.document.getElementById("history");
 assert.equal(body.children.length,1);
 assert.match(body.textContent,/Reçu/);
 assert.doesNotMatch(body.textContent,/Disparu|Modifié/);
});

