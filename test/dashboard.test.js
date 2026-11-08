"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const html=fs.readFileSync(path.join(__dirname,"../public/index.html"),"utf8");
test("logs tab renders live text and caps 1000 lines without egg events panel",()=>{
 const h=harness();
 const entries=Array.from({length:1005},(_,i)=>({id:String(i),at:new Date(1700000000000+i*1000).toISOString(),playerName:"MagixSafe",jobId:"job",text:"[Auto_SAE][0001][1.0][FLIGHT_RESULT][-] "+(i===1004?'<b>Vol Reussi</b>':"Echec "+i)}));
 h.emit({type:"logs.state",entries,limit:1000,storage:"mongodb"});
 assert.match(h.document.getElementById("tab-logs").textContent,/1000/);
 assert.match(h.document.getElementById("logs-lines").textContent,/<b>Vol Reussi<\/b>/);
 assert.equal(h.document.getElementById("logs-lines").children.length,0);
 assert.match(h.document.getElementById("logs-lines").textContent.split("\n")[0],/Vol Reussi/);
 assert.equal(h.document.getElementById("logs-lines").textContent.split("\n").length,1000);
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
 const admin=h.document.getElementById("admin-cards");assert.match(admin.textContent,/MagixSafe/);assert.match(admin.textContent,/Mes Œufs/);assert.match(admin.textContent,/Mes Animaux/);assert.match(admin.textContent,/Paramètres/);
 assert.equal(h.document.getElementById("tab-admin").textContent,"Admin");
 assert.doesNotMatch(html,/delivery.configure|class="favorite"|tab-favorites/);
 h.emit({type:"logs.state",limit:1000,storage:"mongodb",entries:[{id:"1",userId:"42",playerName:"MagixSafe",jobId:"home",at,text},{id:"2",playerName:"MagixSafe",at,text:"[Render] diagnostic"},{id:"3",playerName:"Other",at,text}]});
 assert.equal(h.document.getElementById("tab-logs").textContent,"Vols (1)");
 assert.doesNotMatch(h.document.getElementById("logs-lines").textContent,/diagnostic|Other/);
 admin.children[0].querySelectorAll("button").find(b=>b.textContent==="Voir les vols").onclick();assert.equal(h.document.getElementById("panel-logs").hidden,false);
 h.emit({type:"players.state",players:[{placeId:"123",jobId:"home",userId:"42",name:"MagixSafe",displayName:"MagixSafe",reporterConnected:true},{placeId:"123",jobId:"rich",userId:"7",name:"Observer",displayName:"Observer",reporterConnected:true}]});
 h.emit({type:"eggs.state",eggs:[{placeId:"123",jobId:"home",uid:"a",name:"A",rarity:"Common",incomePerSecond:1,expiresAt:Date.now()+60000},{placeId:"123",jobId:"rich",uid:"b",name:"B",rarity:"Common",incomePerSecond:1e12,expiresAt:Date.now()+60000}]});
 const home=vm.runInContext('serverViews.get(JSON.stringify(["123","home"]))',h.context);
 assert.equal(h.document.getElementById("cards").children[0],home.view.node);assert.match(home.view.node.className,/server-admin/);assert.equal(home.title.textContent,"★ Serveur admin de MagixSafe");
 assert.equal(home.view.rosterList.querySelectorAll("button").length,0);
 h.emit({type:"admin.state",username:"MagixSafe",entry:{userId:"42",playerName:"MagixSafe",connected:false},storage:"mongodb"});assert.match(admin.textContent,/Déconnecté/);
});

test("MagixSafe server stays first and gold without an active Admin script; location follows latest connected roster",()=>{
 const h=harness(),at=new Date().toISOString();
 h.emit({type:"admin.state",username:"MagixSafe",entry:{playerName:"MagixSafe",connected:false,userId:null},storage:"memory"});
 h.emit({type:"players.state",players:[{placeId:"123",jobId:"old",userId:"42",name:"MagixSafe",displayName:"M4GIX",reporterConnected:false,receivedAt:"2026-11-08T10:00:00Z"},{placeId:"123",jobId:"home",userId:"42",name:"MagixSafe",displayName:"M4GIX",reporterConnected:true,receivedAt:at},{placeId:"123",jobId:"rich",userId:"7",name:"Observer",displayName:"Observer",reporterConnected:true}]});
 h.emit({type:"eggs.state",eggs:[{placeId:"123",jobId:"rich",uid:"r",name:"Rich",rarity:"Divine",incomePerSecond:100e9,expiresAt:Date.now()+60000}]});
 const home=vm.runInContext('serverViews.get(JSON.stringify(["123","home"]))',h.context),old=vm.runInContext('serverViews.get(JSON.stringify(["123","old"]))',h.context);
 assert.equal(h.document.getElementById("cards").children[0],home.view.node);assert.match(home.view.node.className,/server-admin/);assert.doesNotMatch(old.view.node.className,/server-admin/);
});

test("connected Admin location wins over stale player rosters after teleport",()=>{
 const h=harness();
 h.emit({type:'players.state',players:[{placeId:'123',jobId:'old',userId:'42',name:'MagixSafe',reporterConnected:true,receivedAt:new Date().toISOString()},{placeId:'123',jobId:'new',userId:'7',name:'EggObs_005',reporterConnected:true}]});
 h.emit({type:'admin.state',username:'MagixSafe',entry:{userId:'42',playerName:'MagixSafe',connected:true,placeId:'123',jobId:'new'}});
 const current=vm.runInContext('serverViews.get(JSON.stringify(["123","new"]))',h.context);
 const old=vm.runInContext('serverViews.get(JSON.stringify(["123","old"]))',h.context);
 assert.equal(h.document.getElementById('cards').children[0],current.view.node);
 assert.match(current.view.node.className,/server-admin/);assert.doesNotMatch(old.view.node.className,/server-admin/);
});

test("Admin inventory separates plot/backpack, shows game stats, sends typed actions and preserves parameter edits",()=>{
 const h=harness();h.context.confirm=()=>true;
 const options={AutoEggs:true,AutoIndex:true,AutoTreadmill:true,AutoSell:false,AutoFuse:false,AutoOpen:false,AutoPlace:false,AutoPapillon:false,QueueNearest:false,TeleportInstantMin:50e9};for(const k of ["AutoEggs","AutoSell","AutoFuse","AutoOpen","AutoPlace"]){options[k+"Min"]=0;options[k+"Max"]=1e33;}
 h.emit({type:"admin.state",username:"MagixSafe",entry:{userId:"42",playerName:"MagixSafe",connected:true,settingsRevision:1,settingsSessionId:"s",options},storage:"mongodb"});
 const item=(uid,location,extra={})=>({uid,name:"Cat",category:"Cat",location,...extra});
 const data={type:"admin.inventory.state",connected:true,pending:null,result:null,inventory:{sessionId:"i",revision:1,receivedAt:Date.now(),stats:{speedPower:1e9,money:2e12,incomePerSecond:3e9,offlinePerDay:10.8e12,offlineDurationSeconds:36000,offlineRateMultiplier:.1},eggs:[item("open","plot",{ready:true,remainingSeconds:0}),item("grow","plot",{ready:false,remainingSeconds:60}),item("bag","backpack")],animals:[item("a","backpack"),item("b","backpack"),item("c","backpack"),item("d","plot")]}};
 h.emit(data);const root=h.document.getElementById("admin-cards");
 assert.match(root.textContent,/1B/);assert.match(root.textContent,/2T/);assert.match(root.textContent,/10.8T\/jour/);assert.match(root.textContent,/Plot · placés \(2\)/);assert.match(root.textContent,/Backpack \(1\)/);
 const buttons=()=>root.querySelectorAll("button"),find=name=>buttons().find(b=>b.textContent===name);
 assert.equal(buttons().find(b=>b.textContent==="Ajouter une mutation").disabled,false);
 assert.equal(buttons().filter(b=>b.textContent==="Ouvrir"&&b.disabled).length,1);
 buttons().find(b=>b.textContent==="Ouvrir"&&!b.disabled).onclick();assert.equal(h.sent.at(-1).action,"egg.open");assert.equal(h.sent.at(-1).uid,"open");
 h.emit(data);find("Mes Animaux").onclick();assert.match(root.textContent,/Équiper les meilleurs/);assert.match(root.textContent,/Équipés \(1\)/);find("Backpack (3)").onclick();
 vm.runInContext('selectedAnimals.add("a");selectedAnimals.add("b");selectedAnimals.add("c")',h.context);
 find("Fuse").onclick();assert.equal(h.sent.at(-1).action,"animal.fuse");assert.deepEqual(h.sent.at(-1).uids,["a","b","c"]);
 h.emit(data);find("Paramètres").onclick();const field=root.querySelectorAll("input").find(i=>i.dataset.setting==="AutoEggsMin");field.value="4B";field.oninput();
 h.emit({...data,inventory:{...data.inventory,revision:2}});assert.equal(root.querySelectorAll("input").find(i=>i.dataset.setting==="AutoEggsMin"),field);assert.equal(field.value,"4B");
 find("Enregistrer").onclick();assert.equal(h.sent.at(-1).action,"settings.update");assert.equal(h.sent.at(-1).options.AutoEggsMin,4e9);
 h.emit({...data,connected:false});assert.ok(root.querySelectorAll("input").every(i=>i.disabled));
});

test("Admin uses Servers card art and metrics without server controls; mutations appear above names and hide when absent",()=>{
 const h=harness(),at=Date.now();
 const egg={key:"e",placeId:"123",jobId:"job",uid:"e",name:"Dog",category:"Dog",rarity:"Divine",baseMutation:"Gold",mutations:["Gold","Rainbow"],imageUrl:"/eggs-native/123926130544109.png",expiresAt:at+60000};
 h.emit({type:"eggs.state",eggs:[egg]});const server=vm.runInContext('serverViews.get(JSON.stringify(["123","job"]))',h.context);
 assert.equal(server.view.mutation.textContent,"Gold · Rainbow");assert.equal(server.view.mutation.hidden,false);assert.equal(server.view.name.parent.children.indexOf(server.view.mutation)<server.view.name.parent.children.indexOf(server.view.name),true);
 h.emit({type:"eggs.state",eggs:[{...egg,baseMutation:null,mutations:[]}]});assert.equal(server.view.mutation.hidden,true);
 h.emit({type:"admin.state",username:"MagixSafe",entry:{userId:"42",playerName:"MagixSafe",connected:true}});
 h.emit({type:"admin.inventory.state",connected:true,inventory:{sessionId:"s",revision:1,receivedAt:at,stats:{},animals:[],eggs:[{...egg,location:"plot",ready:true,remainingSeconds:0}]}});
 const root=h.document.getElementById("admin-cards"),images=root.querySelectorAll("img");assert.equal(images.length,1);assert.equal(images[0].src,egg.imageUrl);
 assert.match(root.textContent,/Gold · Rainbow/);assert.match(root.textContent,/Revenu \/ s/);assert.match(root.textContent,/Temps restant/);
 assert.equal(root.querySelectorAll("details").length,0);assert.ok(root.querySelectorAll("button").every(b=>b.textContent!=="GO"));assert.doesNotMatch(root.textContent,/Œufs du serveur|Tous les détails|Joueurs \(/);
});

test('Mutations inventory, one-attempt popup and grouped settings keep draft values across updates',()=>{
 const h=harness(),root=h.document.getElementById('admin-cards'),buttons=()=>root.querySelectorAll('button'),find=n=>buttons().find(b=>b.textContent===n);
 const options={AutoEggs:true,AutoEggsMin:2e9,AutoEggsMax:1e33};
 h.emit({type:'admin.state',username:'MagixSafe',entry:{userId:'42',connected:true,automationEnabled:false,settingsSessionId:'s',settingsRevision:1,options}});
 const state={type:'admin.inventory.state',connected:true,inventory:{sessionId:'i',revision:1,receivedAt:Date.now(),stats:{},animals:[],eggs:[{uid:'e',name:'Cat',category:'Cat',location:'plot',mutations:[]}],mutationConsumables:[{id:'Boss',name:'Fractured',count:3,successPercent:10,multiplier:2.75}]}};
 h.emit(state);find('Mutations').onclick();assert.match(root.textContent,/Disponibles : 3/);assert.match(root.textContent,/10 %/);assert.match(root.textContent,/×2.75/);
 find('Mes Œufs').onclick();find('Ajouter une mutation').onclick();const modal=h.document.getElementById('mutation-modal');assert.equal(modal.hidden,false);
 modal.querySelectorAll('button').find(b=>b.textContent.startsWith('Fractured')).onclick();assert.equal(h.sent.at(-1).action,'egg.mutate');assert.equal(h.sent.at(-1).mutationId,'Boss');assert.equal(modal.hidden,true);
 h.emit(state);find('Paramètres').onclick();find('AutoMutations').onclick();const field=root.querySelectorAll('input').find(i=>i.dataset.setting==='MutationBossMin');field.value='10B';field.oninput();
 find('Fusion').onclick();find('AutoMutations').onclick();h.emit({...state,inventory:{...state.inventory,revision:2}});assert.equal(root.querySelectorAll('input').find(i=>i.dataset.setting==='MutationBossMin'),field);assert.equal(field.value,'10B');
 find('Enregistrer').onclick();assert.equal(h.sent.at(-1).options.MutationBossMin,10e9);assert.equal(h.sent.at(-1).options.AutoMutations,false);
});

test("egg location tabs persist and every Admin inventory group sorts by descending income",()=>{
 const h=harness();const item=(uid,location,rate)=>({uid,name:uid,category:uid,location,incomePerSecond:rate});
 const state={type:"admin.inventory.state",connected:false,inventory:{sessionId:"s",revision:1,receivedAt:Date.now(),stats:{},eggs:[item("low","plot",1),item("high","plot",9),item("bag-low","backpack",2),item("bag-high","backpack",10)],animals:[item("pet-low","plot",3),item("pet-high","plot",30),item("animal-low","backpack",4),item("animal-high","backpack",40)]}};
 h.emit(state);const root=h.document.getElementById("admin-cards"),names=()=>root.querySelectorAll("h2").map(n=>n.textContent),button=label=>root.querySelectorAll("button").find(b=>b.textContent===label);
 assert.ok(names().indexOf("high")<names().indexOf("low"));assert.equal(names().includes("bag-high"),false);
 button("Backpack (2)").onclick();assert.ok(names().indexOf("bag-high")<names().indexOf("bag-low"));assert.equal(names().includes("high"),false);
 h.emit({...state,inventory:{...state.inventory,revision:2}});assert.equal(button("Backpack (2)")["aria-pressed"],"true");assert.equal(names().includes("high"),false);
 button("Mes Animaux").onclick();assert.equal(button("Équipés (2)")["aria-pressed"],"true");assert.ok(names().indexOf("pet-high")<names().indexOf("pet-low"));assert.equal(names().includes("animal-high"),false);
 button("Backpack (2)").onclick();assert.ok(names().indexOf("animal-high")<names().indexOf("animal-low"));assert.equal(names().includes("pet-high"),false);
 h.emit({...state,inventory:{...state.inventory,revision:3}});assert.equal(button("Backpack (2)")["aria-pressed"],"true");assert.equal(names().includes("pet-high"),false);
 button("Équipés (2)").onclick();assert.equal(names().includes("animal-high"),false);
 button("Mes Œufs").onclick();assert.equal(button("Backpack (2)")["aria-pressed"],"true");
 button("Mes Animaux").onclick();assert.equal(button("Équipés (2)")["aria-pressed"],"true");
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
 assert.equal(vm.runInContext("serverViews.size",h.context),3);
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
