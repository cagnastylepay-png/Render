"use strict";

const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID, timingSafeEqual } = require("node:crypto");
const {createExecutionBridge}=require("./ExecutionBridge");
const {planTeleport}=require("./TeleportPlanner");
const {createClientSettings}=require("../store/ClientSettings");
const {createClientLogs}=require("../store/ClientLogs");
const {hourlyHistory}=require("../store/EggHistory");
const { createDeliveryPolicy } = require("../store/DeliveryPolicy");
function sameToken(provided, expected) {
  if (!expected) return true; // Explicit anonymous test mode when no token is configured.
  const a = Buffer.from(typeof provided === "string" ? provided : "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function attachEggGateway(server, store, players, history, { reportToken = process.env.SAE_REPORT_TOKEN || "", viewerToken = process.env.SAE_VIEW_TOKEN || "", delivery = {}, logs:logOptions = {}, settings:settingsOptions = {}, executionToken=process.env.SAE_EXEC_TOKEN||"" } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1048576, perMessageDeflate: false });
  let closed = false;
  const policy=createDeliveryPolicy(delivery);
  const logs=createClientLogs(logOptions);
  const settings=createClientSettings(settingsOptions);
  const isFavorite=userId=>policy.state().favoriteUserIds.includes(String(userId||""));
  const execution=createExecutionBridge({clients:wss.clients,send,isFavorite,token:executionToken,sameToken});
  function sendReporterPolicy(ws){
    const favorite=isFavorite(ws.reporterIdentity?.userId||ws.claimedReporterUserId);
    send(ws,{version:1,type:"reporting.policy",favorite,executionAllowed:execution.ready(ws),sendLogs:favorite,sendSettings:favorite,sendTeleport:favorite,sendEggs:true,sendPlayers:true});
  }
  function favoritesState(){
    return {version:1,type:"favorites.state",storage:settings.storage(),entries:policy.state().favoriteUserIds.map(userId=>{
      const saved=settings.get(userId),connections=[...wss.clients].filter(ws=>ws.readyState===WebSocket.OPEN&&ws.role==="reporter"&&ws.reporterIdentity?.userId===userId);
      const identity=connections.at(-1)?.reporterIdentity;
      return {userId,playerName:identity?.name||saved?.playerName||userId,connected:connections.length>0,jobId:identity?.jobId||saved?.jobId||null,placeId:identity?.placeId||saved?.placeId||null,at:saved?.at||null,automationActive:saved?.automationActive===true,options:saved?.options||null};
    })};
  }
  function broadcastFavorites(){const state=favoritesState();for(const ws of wss.clients)if(ws.role==="viewer")send(ws,state);}
  const unsubscribeSettings=settings.onReady(broadcastFavorites);
  function logsState(){const state=logs.state();return {...state,entries:state.entries.filter(row=>isFavorite(row.userId))};}
  function historyState(){
    const state=history.state(),all=(history.all?.()||state.entries).filter(row=>isFavorite(row.reporterUserId));
    return {...state,total:all.length,entries:all.slice().sort((a,b)=>b.at.localeCompare(a.at)).slice(0,2000),hourly:hourlyHistory(all),favoritesOnly:true};
  }
  function recordFavoriteSnapshot(ws,message){
    const identity=ws.reporterIdentity;
    if(!identity||!isFavorite(identity.userId)||identity.jobId!==message.jobId||identity.placeId!==message.placeId)return;
    const ids=new Set(message.eggs.map(egg=>egg.uid));
    const eggs=store.state().eggs.filter(egg=>egg.jobId===message.jobId&&egg.placeId===message.placeId&&ids.has(egg.uid));
    const entries=history.append(eggs.map(egg=>({action:"appeared",reason:"favorite-observation",egg,reporterUserId:identity.userId,reporterName:identity.name})));
    if(entries.length){const state=historyState();for(const viewer of wss.clients)if(viewer.role==="viewer")send(viewer,{version:1,type:"history.append",entries,hourly:state.hourly,hourlyTimeZone:state.hourlyTimeZone});}
  }
  const unsubscribeLogs=logs.onReady(()=>{for(const ws of wss.clients)if(ws.role==="viewer")send(ws,logsState());});
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 8388608) { ws.close(1013, "Slow client"); return; }
    ws.send(JSON.stringify(message));
  }
  function deliverTargets(){
    const config=policy.state(),favorites=new Set(config.favoriteUserIds),state=store.state();
    for(const ws of wss.clients){
      if(ws.role!=="reporter"||!ws.reporterIdentity)continue;
      const identity=ws.reporterIdentity,enabled=favorites.has(identity.userId);
      if(!enabled&&!ws.deliveryEnabled)continue;
      const eggs=enabled?state.eggs.filter(egg=>egg.placeId===identity.placeId&&egg.jobId!==identity.jobId&&
        typeof egg.incomePerSecond==="number"&&egg.incomePerSecond>=config.minimumIncomePerSecond&&egg.expiresAt>Date.now()):[];
      const signature=JSON.stringify([enabled,config.minimumIncomePerSecond,eggs]);
      if(ws.deliverySignature===signature)continue;
      ws.deliverySignature=signature;ws.deliveryEnabled=enabled;
      send(ws,{version:1,type:"eggs.targets",enabled,minimumIncomePerSecond:config.minimumIncomePerSecond,serverTime:Date.now(),eggs});
    }
  }
  function deliverTeleportRequests(){
    const eggs=store.state().eggs,presence=players.state().players;
    for(const ws of wss.clients){
      if(ws.role!=="reporter"||!ws.reporterIdentity)continue;
      const saved=ws.settingsSessionId?settings.get(ws.reporterIdentity.userId):null;
      const enabled=isFavorite(ws.reporterIdentity.userId)&&saved?.sessionId===ws.settingsSessionId;
      const plan=enabled?planTeleport(ws.reporterIdentity,saved,eggs,Date.now(),presence):null;
      if(!plan&&!ws.teleportSignature)continue;
      const signature=JSON.stringify(plan?[plan.target.key,plan.target.cycleId,plan.target.incomePerSecond,plan.target.expiresAt,plan.immediate]:null);
      if(signature===ws.teleportSignature)continue;
      ws.teleportSignature=signature;
      send(ws,{version:1,type:"teleport.request",requestId:randomUUID(),serverTime:Date.now(),target:plan?.target||null,immediate:plan?.immediate||false});
    }
  }
  const unsubscribePolicy=policy.onChange(config=>{
    for(const ws of wss.clients)if(ws.role==="viewer"){send(ws,config);send(ws,historyState());send(ws,logsState());send(ws,favoritesState());}
    for(const ws of wss.clients)if(ws.role==="reporter")sendReporterPolicy(ws);
    execution.changed();
    broadcast();
  });
  let broadcastTimer;
  function broadcast() {
    if (broadcastTimer || closed) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = undefined;
      const state = store.state(), presence = players.state();
      for (const ws of wss.clients) if (ws.role === "viewer") { send(ws, state); send(ws, presence); }
      broadcastFavorites();
      deliverTargets();
      deliverTeleportRequests();
    }, 200);
    broadcastTimer.unref();
  }
  const unsubscribeEvents = store.onEvents(events => {
    for (const ws of wss.clients) if (ws.role === "viewer") {
      send(ws, { version: 1, type: "eggs.events", serverTime: Date.now(), events });
    }
  });
  const unsubscribeHistory = history.onReady?.(() => {
    for (const ws of wss.clients) if (ws.role === "viewer") send(ws, historyState());
  }) || (() => {});
  function upgrade(req, socket, head) {
    if ((req.url || "").split("?")[0] !== "/sae/ws") { socket.destroy(); return; }
    if (wss.clients.size >= 200) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  }
  server.on("upgrade", upgrade);
  wss.on("connection", ws => {
    ws.connectionId = randomUUID();
    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });
    ws.on("error", () => {}); // Socket closure drives client retries.
    const handshake = setTimeout(() => ws.close(1008, "Hello required"), 10000);
    handshake.unref();
    ws.on("close", () => { clearTimeout(handshake); players.remove(ws.connectionId); execution.disconnect(ws); broadcast(); });
    let windowAt = Date.now(), messages = 0;
    ws.on("message", async (raw, binary) => {
      try {
        if (binary) throw new Error("JSON text required");
        if (Date.now() - windowAt > 10000) { windowAt = Date.now(); messages = 0; }
        if (++messages > 20) { ws.close(1008, "Rate limit"); return; }
        const message = JSON.parse(raw.toString());
        if (!ws.role) {
          if (!message || message.version !== 1 || message.type !== "hello" || !["reporter", "viewer"].includes(message.role))
            throw new Error("Invalid hello");
          if (!sameToken(message.token, message.role === "reporter" ? reportToken : viewerToken)) {
            ws.close(1008, "Authentication failed"); return;
          }
          ws.role = message.role;
          if(ws.role==="reporter")execution.register(ws,message);
          if(ws.role==="reporter"&&typeof message.reporterUserId==="string"&&/^\d{1,20}$/.test(message.reporterUserId))ws.claimedReporterUserId=message.reporterUserId;
          clearTimeout(handshake);
          send(ws, { version: 1, type: "hello.ack", role: ws.role });
          if(ws.role==="reporter"){await policy.ready;sendReporterPolicy(ws);}
          if (ws.role === "viewer") { send(ws, store.state()); send(ws, players.state()); send(ws, historyState()); send(ws,policy.state()); send(ws,logsState()); send(ws,favoritesState()); send(ws,execution.policy(ws)); }
          return;
        }
        if(execution.handle(ws,message))return;
        if (message.type === "ping") { send(ws, { version: 1, type: "pong" }); return; }
        if(message.type==="logs.clear"){
          if(ws.role!=="viewer")throw Error("Only dashboard viewers may clear logs");
          await logs.clear();
          for(const viewer of wss.clients)if(viewer.role==="viewer")send(viewer,logsState());
          return;
        }
        if(message.type==="history.clear"){
          if(ws.role!=="viewer")throw Error("Only dashboard viewers may clear history");
          await history.clear();
          for(const viewer of wss.clients)if(viewer.role==="viewer")send(viewer,historyState());
          return;
        }
        if(message.type==="delivery.configure"){
          if(ws.role!=="viewer")throw new Error("Only dashboard viewers may edit delivery settings");
          try{send(ws,await policy.configure(message));}
          catch(error){send(ws,policy.state());throw error;}
          return;
        }
        if (ws.role !== "reporter") throw new Error("Viewer is read-only");
        await policy.ready;
        if(message.type==="settings.snapshot"){
          if(!ws.reporterIdentity)throw Error("Player identity required before settings");
          const accepted=isFavorite(ws.reporterIdentity.userId)?settings.accept(ws.reporterIdentity,message):false;
          send(ws,{version:1,type:"settings.ack",sessionId:message.sessionId,revision:message.revision,accepted});
          if(accepted){ws.settingsSessionId=message.sessionId;broadcastFavorites();broadcast();}
          return;
        }
        if(message.type==="logs.append"){
          if(!ws.reporterIdentity)throw Error("Player identity required before logs");
          if(!isFavorite(ws.reporterIdentity.userId)){
            if(!Array.isArray(message.lines)||message.lines.length>100||!message.lines.every(line=>Number.isSafeInteger(line.sequence)&&line.sequence>0))throw Error("Invalid logs batch");
            send(ws,{version:1,type:"logs.ack",sessionId:message.sessionId,sequence:Math.max(0,...message.lines.map(line=>line.sequence)),accepted:false});return;
          }
          const entries=logs.append(ws.reporterIdentity,message);
          send(ws,{version:1,type:"logs.ack",sessionId:message.sessionId,sequence:Math.max(0,...message.lines.map(line=>line.sequence))});
          for(const viewer of wss.clients)if(viewer.role==="viewer"&&entries.length)send(viewer,{version:1,type:"logs.append",entries});
          return;
        }
        if (message.type === "players.snapshot") {
          const accepted = players.accept(ws.connectionId, message);
          send(ws, { version: 1, type: "players.ack", revision: message.revision, accepted });
          if (accepted) {
            const reporter=message.players.find(player=>player.userId===message.reporterUserId);
            ws.reporterIdentity={name:reporter.displayName||reporter.name,userId:reporter.userId,placeId:message.placeId,jobId:message.jobId};
            sendReporterPolicy(ws);
            execution.changed();
            broadcast();
          }
          return;
        }
        const accepted = store.accept(message);
        send(ws, { version: 1, type: "eggs.ack", sessionId: message.sessionId, cycleId: message.cycleId,
          revision: message.revision, accepted });
        if (accepted) {recordFavoriteSnapshot(ws,message);broadcast();}
      } catch (error) {
        send(ws, { version: 1, type: "error", message: String(error.message).slice(0, 160) });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
    if (store.prune() || players.prune()) broadcast();
  }, 15000);
  heartbeat.unref();
  return {
    info: () => ({ executionConfigured:execution.configured, teleportSelection:"free-slot-lowest-top-speed", serverPlayerLimit:7, clients: wss.clients.size, reportAuthentication: !!reportToken, viewerAuthentication: !!viewerToken, deliveryStorage:policy.state().storage, favoriteClients:policy.state().favoriteUserIds.length, logsStorage:logs.state().storage, logsLimit:logs.state().limit }),
    close() {
      if (closed) return;
      closed = true;
      unsubscribeEvents();
      unsubscribeHistory();
      unsubscribePolicy();
      unsubscribeLogs();
      unsubscribeSettings();
      execution.close();
      clearInterval(heartbeat); clearTimeout(broadcastTimer);
      server.removeListener("upgrade", upgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return Promise.all([policy.close(),logs.close(),settings.close()]);
    }
  };
}
module.exports = { attachEggGateway, sameToken };
