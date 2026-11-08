"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
test("logs tab renders live text, filters and caps 1000 lines without egg events panel",()=>{
 const h=harness();
 const entries=Array.from({length:1005},(_,i)=>({id:String(i),at:new Date(1700000000000+i*1000).toISOString(),playerName:"MagixSafe",jobId:"job",text:"[Auto_SAE][0001][1.0][FLIGHT_RESULT][-] "+(i===1004?'<b>Vol Reussi</b>':"Echec "+i)}));
 h.emit({type:"logs.state",entries,limit:1000,storage:"mongodb"});
 assert.match(h.document.getElementById("tab-logs").textContent,/1000/);
 assert.match(h.document.getElementById("logs-lines").textContent,/<b>Vol Reussi<\/b>/);
 assert.equal(h.document.getElementById("logs-lines").children.length,0);
 assert.match(h.document.getElementById("logs-lines").textContent.split("\n")[0],/Vol Reussi/);
 h.document.getElementById("logs-filter").value="Reussi";h.document.getElementById("logs-filter").oninput();
 assert.equal(h.document.getElementById("logs-lines").textContent.split("\n").length,1);
 h.emit({type:"logs.append",entries:[entries.at(-1)]});assert.match(h.document.getElementById("tab-logs").textContent,/1000/);
 h.document.getElementById("tab-logs").onclick();assert.equal(h.document.getElementById("panel-logs").hidden,false);
 h.document.getElementById("logs-clear").onclick();assert.equal(h.sent.at(-1).type,"logs.clear");
 h.emit({type:"logs.state",entries:[],limit:1000,storage:"mongodb"});assert.equal(h.document.getElementById("tab-logs").textContent,"Vols (0)");
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

test("Admin replaces favorites with one configured account and hides diagnostics and other players",()=>{
 const h=harness(),at=new Date().toISOString(),text="[Auto_SAE][0001][1.0][FLIGHT_RESULT][-] Vol Reussi";
 h.emit({type:"admin.state",username:"MagixSafe",storage:"mongodb",entry:{userId:"42",playerName:"MagixSafe",connected:true,placeId:"123",jobId:"home",options:{AutoEggs:true,AutoEggsMin:2e9,AutoEggsMax:1e33}}});
 const admin=h.document.getElementById("admin-cards");assert.equal(admin.children.length,1);assert.match(admin.textContent,/MagixSafe/);assert.match(admin.textContent,/2B\/s/);
 assert.equal(h.document.getElementById("tab-admin").textContent,"Admin");
 assert.doesNotMatch(html,/delivery.configure|class="favorite"|tab-favorites/);
 h.emit({type:"logs.state",limit:1000,storage:"mongodb",entries:[{id:"1",userId:"42",playerName:"MagixSafe",jobId:"home",at,text},{id:"2",playerName:"MagixSafe",at,text:"[Render] diagnostic"},{id:"3",playerName:"Other",at,text}]});
 assert.equal(h.document.getElementById("tab-logs").textContent,"Vols (1)");
 assert.doesNotMatch(h.document.getElementById("logs-lines").textContent,/diagnostic|Other/);
 admin.children[0].querySelectorAll("button")[0].onclick();assert.equal(h.document.getElementById("panel-logs").hidden,false);
 h.emit({type:"players.state",players:[{placeId:"123",jobId:"home",userId:"42",name:"MagixSafe",displayName:"MagixSafe",reporterConnected:true},{placeId:"123",jobId:"rich",userId:"7",name:"Observer",displayName:"Observer",reporterConnected:true}]});
 h.emit({type:"eggs.state",eggs:[{placeId:"123",jobId:"home",uid:"a",name:"A",rarity:"Common",incomePerSecond:1,expiresAt:Date.now()+60000},{placeId:"123",jobId:"rich",uid:"b",name:"B",rarity:"Common",incomePerSecond:1e12,expiresAt:Date.now()+60000}]});
 const home=vm.runInContext('serverViews.get(JSON.stringify(["123","home"]))',h.context);
 assert.equal(h.document.getElementById("cards").children[0],home.view.node);assert.match(home.view.node.className,/server-admin/);assert.equal(home.title.textContent,"★ Serveur admin de MagixSafe");
 assert.equal(home.view.rosterList.querySelectorAll("button").length,0);
 h.emit({type:"admin.state",username:"MagixSafe",entry:{userId:"42",playerName:"MagixSafe",connected:false},storage:"mongodb"});assert.match(admin.textContent,/Déconnecté/);
});
test("Servers counts server cards and omits History",()=>{
 const h=harness();
 assert.equal(h.document.getElementById("tab-history"),null);
 assert.equal(h.document.getElementById("panel-history"),null);
 assert.equal(h.document.getElementById("tab-servers").textContent,"Servers (0)");
 const base={placeId:"123",name:"Egg",rarity:"Common",expiresAt:Date.now()+60000};
 h.emit({type:"eggs.state",serverCount:2,eggs:[{...base,key:"a/1",jobId:"a",uid:"1"},{...base,key:"a/2",jobId:"a",uid:"2"},{...base,key:"b/3",jobId:"b",uid:"3"}]});
 assert.equal(h.document.getElementById("tab-servers").textContent,"Servers (2)");
 assert.equal(h.document.getElementById("cards").children.length,2);
 h.document.getElementById("tab-logs").onclick();
 h.document.getElementById("tab-servers").onclick();
 assert.equal(h.document.getElementById("panel-servers").hidden,false);
 h.emit({type:"history.state",entries:[]});
 h.emit({type:"history.append",entries:[]});
 assert.equal(h.document.getElementById("tab-servers").textContent,"Servers (2)");
});
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
test("game number suffixes remain available",()=>{
 const h=harness();
 for(const [value,expected]of [[1e9,"1B"],[1e12,"1T"],[1e15,"1Qa"],[1e18,"1Qi"],[999999,"1M"]])
  assert.equal(vm.runInContext("formatNumber("+value+")",h.context),expected);
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
 const go=a.view.node.querySelectorAll("button").find(button=>button.textContent==="GO");
 assert.ok(go);go.onclick();
 assert.deepEqual(JSON.parse(JSON.stringify(h.sent.at(-1))),{version:1,type:"teleport.manual",placeId:"123",jobId:"server-a"});
 assert.equal(a.list.children.flatMap(card=>card.querySelectorAll("button")).filter(button=>button.textContent==="GO").length,0);
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



test("remote execution panel is removed",()=>{assert.doesNotMatch(html,/id="tab-test"|execution-code|execute.request/);});


test("server headings name connected script players and retain names after disconnection",()=>{
 const h=harness();
 h.emit({type:"logs.state",entries:[],limit:1000,storage:"memory"});
 assert.equal(h.document.getElementById("tab-logs").textContent,"Vols (0)");
 h.emit({type:"eggs.state",eggs:[{placeId:"123",jobId:"ba4b2270",uid:"egg",name:"Egg",rarity:"Common",expiresAt:Date.now()+60000}]});
 const server=vm.runInContext('serverViews.get(JSON.stringify(["123","ba4b2270"]))',h.context);
 assert.equal(server.title.textContent,"Serveur observé");
 h.emit({type:"players.state",players:[
  {placeId:"123",jobId:"ba4b2270",userId:"2",name:"ScriptPlayer2",displayName:"Second",reporterConnected:true},
  {placeId:"123",jobId:"ba4b2270",userId:"1",name:"ScriptPlayer1",displayName:"First",reporterConnected:true},
  {placeId:"123",jobId:"ba4b2270",userId:"3",name:"OrdinaryPlayer",reporterConnected:false}
 ]});
 assert.equal(server.title.textContent,"Serveur de ScriptPlayer1, ScriptPlayer2");
 assert.equal(server.title.title,"ba4b2270");
 h.emit({type:"players.state",players:[{placeId:"123",jobId:"ba4b2270",userId:"2",name:"ScriptPlayer2",reporterConnected:true}]});
 assert.equal(server.title.textContent,"Serveur de ScriptPlayer2");
 h.emit({type:"players.state",players:[]});
 assert.equal(server.title.textContent,"Serveur de ScriptPlayer2");
 assert.equal(server.connection.textContent,"Observations conservées");
});
