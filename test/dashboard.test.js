"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
test("logs tab renders live text, filters and caps 1000 lines without egg events panel",()=>{
 const h=harness();
 const entries=Array.from({length:1005},(_,i)=>({id:String(i),at:new Date(1700000000000+i*1000).toISOString(),playerName:"Alice",jobId:"job",text:i===1004?'<b>Vol Reussi</b>':"Vente "+i}));
 h.emit({type:"logs.state",entries,limit:1000,storage:"mongodb"});
 assert.match(h.document.getElementById("tab-logs").textContent,/1000/);
 assert.match(h.document.getElementById("logs-lines").textContent,/<b>Vol Reussi<\/b>/);
 assert.equal(h.document.getElementById("logs-lines").children.length,0);
 h.document.getElementById("logs-filter").value="Vol";h.document.getElementById("logs-filter").oninput();
 assert.equal(h.document.getElementById("logs-lines").textContent.split("\n").length,1);
 h.emit({type:"logs.append",entries:[entries.at(-1)]});assert.match(h.document.getElementById("tab-logs").textContent,/1000/);
 h.document.getElementById("tab-logs").onclick();assert.equal(h.document.getElementById("panel-logs").hidden,false);
 assert.doesNotMatch(html,/Apparitions et disparitions/);
});
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
 class FakeSocket{static OPEN=1;constructor(){FakeSocket.current=this;this.readyState=1;this.sent=[];}send(data){this.sent.push(JSON.parse(data));}close(){}}
 const context=vm.createContext({document,WebSocket:FakeSocket,location:{protocol:"http:",host:"test"},Intl,Date,Map,Set,Math,Number,JSON,String,
  setInterval(){},clearTimeout(){},setTimeout(){},console});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 return {context,document,sent:FakeSocket.current.sent,emit:message=>FakeSocket.current.onmessage({data:JSON.stringify(message)})};
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


test("server cards select the best egg, expand all eggs and keep expansion across updates",()=>{
 const h=harness(),now=Date.now(),base={placeId:"123",rarity:"Cosmic",imageUrl:"/eggs/a.webp",expiresAt:now+60000};
 const eggs=[{...base,uid:"same-id",jobId:"server-a",name:"Low",incomePerSecond:1e9},
  {...base,uid:"best",jobId:"server-a",name:"Best",incomePerSecond:5e9},
  {...base,uid:"same-id",jobId:"server-b",name:"Other",incomePerSecond:3e9}];
 const emit=()=>h.emit({type:"eggs.state",serverCount:2,nextResetAt:now+60000,eggs});
 emit();
 const container=h.document.getElementById("cards");
 assert.equal(container.children.length,2);
 const first=container.children[0];
 assert.match(first.textContent,/Best/);
 const a=vm.runInContext('serverViews.get(JSON.stringify(["123","server-a"]))',h.context);
 assert.equal(a.view.name.textContent,"Best");
 assert.equal(a.list.children.length,2);
 a.expand.open=true;
 const nested=a.list.children[0],image=nested.querySelectorAll("img")[0];
 emit();
 assert.equal(a.expand.open,true);
 assert.equal(a.list.children[0],nested);
 assert.equal(image.srcWrites,1);
 eggs[0].incomePerSecond=8e9;emit();
 assert.equal(a.view.name.textContent,"Low");
 assert.equal(a.expand.open,true);
 eggs.splice(0,1);emit();
 assert.equal(a.view.name.textContent,"Best");
 assert.equal(a.list.children.length,1);
 h.emit({type:"players.state",players:[{placeId:"123",jobId:"empty-server",userId:"9",name:"Bob",displayName:"Bob",reporterConnected:true}]});
 assert.equal(container.children.length,3);
 const empty=vm.runInContext('serverViews.get(JSON.stringify(["123","empty-server"]))',h.context);
 assert.equal(empty.view.name.textContent,"Aucun œuf signalé");
 assert.equal(empty.expand.hidden,true);
 assert.match(empty.connection.textContent,/Connecté/);
 h.document.getElementById("rarity").value="Divine";
 vm.runInContext("renderCards()",h.context);
 assert.equal(vm.runInContext("serverViews.size",h.context),0);
});

test("rosters sort by game speed and favorites send the selected income policy",()=>{
 const h=harness();
 h.emit({type:"eggs.state",eggs:[{placeId:"123",jobId:"job",uid:"egg",name:"Egg",rarity:"Divine",expiresAt:Date.now()+60000}]});
 h.emit({type:"players.state",players:[
  {placeId:"123",jobId:"job",userId:"1",name:"Slow",displayName:"Slow",speedPower:1e9,reporterConnected:true},
  {placeId:"123",jobId:"job",userId:"2",name:"Fast",displayName:"Fast",speedPower:3e12},
  {placeId:"123",jobId:"job",userId:"3",name:"Unknown",displayName:"Unknown",speedPower:null}
 ]});
 h.emit({type:"delivery.policy",revision:0,favoriteUserIds:[],minimumIncomePerSecond:2e9,storage:"mongodb"});
 const server=vm.runInContext('serverViews.get(JSON.stringify(["123","job"]))',h.context),roster=server.view.rosterList;
 assert.match(roster.children[0].textContent,/Fast/);
 assert.match(roster.children[1].textContent,/Slow/);
 assert.match(roster.children[2].textContent,/Unknown/);
 const star=roster.children[0].querySelectorAll("button")[0];star.onclick();
 assert.deepEqual(h.sent.at(-1).favoriteUserIds,["2"]);
 assert.equal(h.sent.at(-1).minimumIncomePerSecond,2e9);
 h.emit({type:"delivery.policy",revision:1,favoriteUserIds:["2"],minimumIncomePerSecond:2e9,storage:"mongodb"});
 assert.match(roster.children[0].textContent,/★/);
 h.document.getElementById("delivery-minimum").value="2.5Qa/s";
 h.document.getElementById("delivery-apply").onclick();
 assert.equal(h.sent.at(-1).minimumIncomePerSecond,2.5e15);
 assert.equal(h.sent.at(-1).expectedRevision,1);
});

