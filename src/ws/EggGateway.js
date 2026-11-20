"use strict";
const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID, timingSafeEqual } = require("node:crypto");
const { planTeleport } = require("./TeleportPlanner");
const { planObserverSpread } = require("./ObserverSpread");
const { createObserverServers } = require("./ObserverServers");
const { createClientSettings } = require("../store/ClientSettings");
const { createClientLogs } = require("../store/ClientLogs");
const { createAdminPanel } = require("./AdminPanel");
const { attachLJRPC, path: ljrpcPath } = require("./LJRPCGateway");
const flightResult = text => typeof text === "string" && /^\[Auto_SAE\]\[\d+\]\[[^\]]+\]\[FLIGHT_RESULT\]\[/.test(text);
function sameToken(provided, expected) {
  if (!expected) return true;
  const a = Buffer.from(typeof provided === "string" ? provided : ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function attachEggGateway(server, store, players, history, {
  reportToken = process.env.SAE_REPORT_TOKEN || "", viewerToken = process.env.SAE_VIEW_TOKEN || "", dashboardAuth = null, notifications = null,
  adminUsername = process.env.ADMIN_USERNAME ?? "MagixSafe", logs: logOptions = {}, settings: settingsOptions = {}
} = {}) {
  const username = String(adminUsername).trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw Error("ADMIN_USERNAME must be a Roblox username");
  const matchesUsername = name => typeof name === "string" && name.toLowerCase() === username.toLowerCase();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1048576, perMessageDeflate: false });
  const logs = createClientLogs(logOptions), settings = createClientSettings(settingsOptions);
  let closed = false, broadcastTimer;
  // Reporter identity is client-declared, not proof of Roblox account ownership.
  const isAdmin = ws => ws.role === "reporter" && ws.clientKind === "admin" && !ws.observerOnly && matchesUsername(ws.reporterIdentity?.name);
  const adminSocket = () => [...wss.clients].filter(ws => ws.readyState === WebSocket.OPEN && isAdmin(ws)).at(-1);
  const panel = createAdminPanel({send,viewers:()=>[...wss.clients].filter(ws=>ws.role==='viewer'),adminSocket,settings,onChange:()=>broadcast()});
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.role === "viewer" && dashboardAuth && !dashboardAuth.authenticated(ws.dashboardRequest)) { ws.close(1008, "Dashboard login required"); return; }
    if (ws.bufferedAmount > 8388608) { ws.close(1013, "Slow client"); return; }
    ws.send(JSON.stringify(message));
  }
  function reporterPolicy(ws) {
    const admin = isAdmin(ws);
    send(ws, { version: 1, type: "reporting.policy", admin, sendLogs: admin, sendSettings: admin, sendTeleport: admin, sendEggs: true, sendPlayers: true });
  }
  function adminState() {
    const socket = adminSocket(), identity = socket?.reporterIdentity;
    const saved = identity ? settings.get(identity.userId) : settings.findByUsername(username);
    return { version: 1, type: "admin.state", username, storage: settings.storage(), entry: {
      username, userId: identity?.userId || saved?.userId || null, playerName: identity?.name || username,
      connected: Boolean(socket), clientKind: "admin", jobId: identity?.jobId || saved?.jobId || null,
      placeId: identity?.placeId || saved?.placeId || null, at: saved?.at || null,
      automationActive: Boolean(socket && saved?.sessionId === socket.settingsSessionId && saved?.automationActive),
      automationEnabled:Boolean(socket&&saved?.sessionId===socket.settingsSessionId&&(saved?.automationEnabled??saved?.automationActive)),
      options: saved?.options || null
      ,settingsRevision:saved?.revision||null,settingsSessionId:saved?.sessionId||null
    } };
  }
  function sendAdminState(ws, state = adminState()) {
    const signature = JSON.stringify(state);
    if (ws.adminSignature === signature) return;
    ws.adminSignature = signature; send(ws, state);
  }
  function broadcastAdmin() { const state = adminState(); for (const ws of wss.clients) if (ws.role === "viewer") sendAdminState(ws, state); }
  function logsState() { const state = logs.state(); return { ...state, entries: state.entries.filter(row => matchesUsername(row.playerName) && flightResult(row.text)) }; }
  function deliverTargets() {
    const ws = adminSocket(); if (!ws) return;
    const identity = ws.reporterIdentity, saved = settings.get(identity.userId);
    const minimumIncomePerSecond = saved?.options?.AutoEggsMin ?? 2e9;
    const eggs = store.state().eggs.filter(egg => egg.placeId === identity.placeId && egg.jobId !== identity.jobId &&
      typeof egg.incomePerSecond === "number" && egg.incomePerSecond >= minimumIncomePerSecond && egg.expiresAt > Date.now());
    const signature = JSON.stringify([minimumIncomePerSecond, eggs]);
    if (signature === ws.deliverySignature) return;
    ws.deliverySignature = signature;
    send(ws, { version: 1, type: "eggs.targets", enabled: true, minimumIncomePerSecond, serverTime: Date.now(), eggs });
  }
  function deliverTeleport() {
    const ws = adminSocket(); if (!ws || ws.manualTeleportUntil > Date.now()) return;
    const saved = settings.get(ws.reporterIdentity.userId);
    const plan = saved?.sessionId === ws.settingsSessionId ? planTeleport(ws.reporterIdentity, saved, store.state().eggs, Date.now(), players.state().players) : null;
    const signature = JSON.stringify(plan ? [plan.target.key, plan.target.cycleId, plan.target.incomePerSecond, plan.target.expiresAt, plan.immediate] : null);
    if (signature === ws.teleportSignature || (!plan && !ws.teleportSignature)) return;
    ws.teleportSignature = signature;
    send(ws, { version: 1, type: "teleport.request", requestId: randomUUID(), serverTime: Date.now(), target: plan?.target || null, immediate: plan?.immediate || false });
  }
  const observerServers=createObserverServers();
  function onAdminServer(identity) {
    const admin = adminSocket()?.reporterIdentity;
    return Boolean(identity && admin && identity.placeId === admin.placeId && identity.jobId === admin.jobId);
  }
  let groupReservation;
  function cancelGroupReservation() {
    if (!groupReservation) return;
    send(groupReservation.observer, { version: 1, type: groupReservation.type, target: null });
    groupReservation = undefined;
  }
  let groupHome;
  function resolveAdminDestination(admin, clients, placeId) {
    const identity = admin?.reporterIdentity;
    if (identity) return identity;
    const now = Date.now();
    return players.state().players.filter(player => matchesUsername(player.name) &&
      (!placeId || player.placeId === placeId) && now - Date.parse(player.receivedAt) <= 25000 &&
      clients.some(client => !client.superseded && client.reporterIdentity?.placeId === player.placeId &&
        client.reporterIdentity.jobId === player.jobId))
      .sort((a,b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0];
  }
  function chooseGroupHome(admin, saved, clients) {
    const observers = clients.filter(client => client.observerOnly && !client.superseded && client.reporterIdentity);
    const destination = resolveAdminDestination(admin, clients, saved?.placeId);
    if (destination) return { placeId: destination.placeId, jobId: destination.jobId };

    if (groupHome && observers.some(client => client.reporterIdentity.placeId === groupHome.placeId &&
      client.reporterIdentity.jobId === groupHome.jobId)) return groupHome;
    const samePlace = observers.filter(client => !saved?.placeId || client.reporterIdentity.placeId === saved.placeId);
    const groups = new Map();
    for (const client of samePlace) {
      const { placeId, jobId } = client.reporterIdentity;
      const group = groups.get(jobId) || { placeId, jobId, count: 0 };
      group.count++;
      groups.set(jobId, group);
    }
    return groups.get(saved?.jobId) || [...groups.values()].sort((a,b) => b.count - a.count)[0];
  }
  async function fillGroupServer(destination, clients, now) {
    let capacity = clients.filter(client => !client.superseded &&
      client.reporterIdentity?.placeId === destination.placeId &&
      client.reporterIdentity.jobId === destination.jobId && client.groupCapacity)
      .map(client => client.groupCapacity).sort((a,b) => b.at - a.at)[0];
    if (groupReservation) {
      const { jobId, userId, until } = groupReservation;
      if (jobId !== destination.jobId || groupReservation.placeId !== destination.placeId) cancelGroupReservation();
      else if (capacity?.userIds.has(userId) || clients.some(client => !client.superseded &&
        client.reporterIdentity?.userId === userId && client.reporterIdentity.placeId === destination.placeId &&
        client.reporterIdentity.jobId === destination.jobId)) {
        if (!capacity || now - capacity.at > 25000) observerServers.invalidate(destination.placeId);
        groupReservation = undefined;
      }
      else if (now < until) return;
      else cancelGroupReservation();
    }
    if (!capacity || now - capacity.at > 25000) {
      const available = await observerServers.hasFreeSlot(destination).catch(() => false);
      if (closed || groupHome !== destination) return;
      // A short public listing can omit this server. Roblox still enforces capacity on the join.
      if (!available && !clients.some(client => client.readyState === WebSocket.OPEN && !client.superseded &&
        client.reporterIdentity?.placeId === destination.placeId && client.reporterIdentity.jobId === destination.jobId)) return;
      const admin = adminSocket();
      const saved = (admin && settings.get(admin.reporterIdentity.userId)) || settings.findByUsername(username);
      if (saved?.options?.GroupMode === false) return;
      const current = resolveAdminDestination(admin, clients, saved?.placeId);
      if (current && (current.placeId !== destination.placeId || current.jobId !== destination.jobId)) return;
      capacity = { userIds: new Set() };
      now = Date.now();
    } else if (capacity.userIds.size >= capacity.maxPlayers) return;
    if (clients.some(client => client.manualObserverHopUntil > now)) return;
    const candidates = clients.filter(client => client.readyState === WebSocket.OPEN && client.role === "reporter" && client.observerOnly && !client.superseded &&
      client.reporterIdentity?.placeId === destination.placeId && client.reporterIdentity.jobId !== destination.jobId &&
      !capacity.userIds.has(client.reporterIdentity.userId) && (client.groupRetryAt || 0) <= now);
    candidates.sort((a,b) => (a.groupLastAttempt || 0) - (b.groupLastAttempt || 0));
    const observer = candidates[0];
    if (!observer) return;
    const source = observer.reporterIdentity;
    observer.groupLastAttempt = now;
    observer.groupRetryAt = now + 125000;
    const type = observer.groupCapacity ? "observer.group" : "observer.go-to-admin";
    groupReservation = { observer, type, userId: source.userId, placeId: destination.placeId, jobId: destination.jobId, until: now + 125000 };
    send(observer, { version: 1, type, target: {
      placeId: source.placeId, jobId: source.jobId, destinationJobId: destination.jobId, delaySeconds: 0
    } });
  }
  let spreading=false;
  async function distributeObservers(){
    if(spreading||closed)return;
    spreading=true;
    try{
      const clients=[...wss.clients].filter(ws=>ws.readyState===WebSocket.OPEN);
      const admin = adminSocket();
      const saved = (admin && settings.get(admin.reporterIdentity.userId)) || settings.findByUsername(username);
      if (saved?.options?.GroupMode !== false) {
        for (const client of clients) {
          if (!client.observerOnly || client.spreadSignature === "null") continue;
          client.spreadSignature = "null";
          send(client, { version: 1, type: "observer.spread", target: null });
        }
        groupHome = chooseGroupHome(admin, saved, clients);
        if (groupHome) await fillGroupServer(groupHome, clients, Date.now());
        else cancelGroupReservation();
        return;
      }
      groupHome = undefined;
      cancelGroupReservation();
      const plans=planObserverSpread(clients);
      for(const [ws,group]of plans){
        if(ws.manualObserverHopUntil>Date.now())continue;
        let target=null;
        if(group&&!onAdminServer(ws.reporterIdentity)){
          const identity=ws.reporterIdentity;
          let destination=ws.spreadDestination;
          if(!destination||destination.until<=Date.now()||destination.fromJobId!==group.jobId){
            if(Date.now()>=(ws.spreadNextSearchAt||0)){
              ws.spreadNextSearchAt=Date.now()+30000;
              const occupied=new Set(clients.filter(c=>c.clientKind==="observer"&&c.reporterIdentity?.placeId===identity.placeId).map(c=>c.reporterIdentity.jobId));
              try{
                destination=await observerServers.choose(identity,occupied);
                ws.spreadDestination=destination?{...destination,fromJobId:group.jobId}:null;
              }catch{destination=null;}
            }else destination=null;
          }
          if(destination&&destination.until>Date.now()){
            const occupied=[...wss.clients].some(c=>c.readyState===WebSocket.OPEN&&c.clientKind==="observer"&&c.reporterIdentity?.placeId===group.placeId&&c.reporterIdentity.jobId===destination.jobId);
            if(!occupied)target={...group,destinationJobId:destination.jobId};
          }
        }else ws.spreadDestination=null;
        if(closed||ws.readyState!==WebSocket.OPEN||ws.superseded)continue;
        if(onAdminServer(ws.reporterIdentity))target=null;
        const signature=JSON.stringify(target);
        if(ws.spreadSignature===signature)continue;
        ws.spreadSignature=signature;
        send(ws,{version:1,type:"observer.spread",target});
      }
    }finally{spreading=false;}
  }
  function broadcast() {
    if (broadcastTimer || closed) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = undefined;
      const eggs = store.state(), presence = players.state();
      for (const ws of wss.clients) if (ws.role === "viewer") { send(ws, eggs); send(ws, presence); }
      broadcastAdmin(); deliverTargets(); deliverTeleport(); distributeObservers();
    }, 200);
    broadcastTimer.unref();
  }
  const unsubscribeSettings = settings.onReady(broadcastAdmin);
  const unsubscribeLogs = logs.onReady(() => { for (const ws of wss.clients) if (ws.role === "viewer") send(ws, logsState()); });
  const ljrpc = attachLJRPC(server);
  function upgrade(req, socket, head) {
    if (req.url === ljrpcPath) return;
    if ((req.url || "").split("?")[0] !== "/sae/ws" || wss.clients.size >= 200) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  }
  server.on("upgrade", upgrade);
  wss.on("connection", (ws, req) => {
    ws.dashboardRequest = req; ws.connectionId = randomUUID(); ws.alive = true;
    ws.on("pong", () => { ws.alive = true; }); ws.on("error", () => {});
    const handshake = setTimeout(() => ws.close(1008, "Hello required"), 10000); handshake.unref();
    ws.on("close", () => { clearTimeout(handshake); players.remove(ws.connectionId); panel.changed(); broadcast(); });
    let windowAt = Date.now(), messages = 0;
    ws.on("message", (raw, binary) => {
      try {
        if (binary) throw Error("JSON text required");
        if (Date.now() - windowAt > 10000) { windowAt = Date.now(); messages = 0; }
        if (++messages > 20) { ws.close(1008, "Rate limit"); return; }
        const message = JSON.parse(raw.toString());
        if(ws.superseded)return;
        if (ws.role === "viewer" && dashboardAuth && !dashboardAuth.authenticated(req)) { ws.close(1008, "Dashboard login required"); return; }
        if (!ws.role) {
          if (message?.version !== 1 || message.type !== "hello" || !["reporter", "viewer"].includes(message.role)) throw Error("Invalid hello");
          if (message.role === "viewer" && dashboardAuth && (!dashboardAuth.authenticated(req) || !dashboardAuth.sameOrigin(req))) { ws.close(1008, "Dashboard login required"); return; }
          if (!sameToken(message.token, message.role === "reporter" ? reportToken : viewerToken)) { ws.close(1008, "Authentication failed"); return; }
          ws.role = message.role; ws.observerOnly = message.observerOnly === true;
          ws.clientKind = ws.observerOnly ? "observer" : message.clientKind === "admin" ? "admin" : "hub";
          ws.claimedReporterUserId = typeof message.reporterUserId === "string" ? message.reporterUserId : null;
          clearTimeout(handshake); send(ws, { version: 1, type: "hello.ack", role: ws.role });
          if (ws.role === "reporter") reporterPolicy(ws);
          else { send(ws, store.state()); send(ws, players.state()); send(ws, logsState()); sendAdminState(ws); send(ws,panel.state()); }
          return;
        }
        if (message.type === "ping") { send(ws, { version: 1, type: "pong" }); return; }
        if(message.type==='admin.command'){
          if(ws.role!=='viewer')throw Error('Only dashboard viewers may control Admin');panel.command(ws,message);return;
        }
        if (message.type === "delivery.configure") throw Error("Favorite management removed; ADMIN_USERNAME configures the admin");
        if (message.type === "egg.steal") {
          if (ws.role !== "viewer") throw Error("Only dashboard viewers may request an egg");
          if ([message.placeId, message.jobId, message.uid].some(value => typeof value !== "string" || !value || value.length > 128)) throw Error("Invalid egg destination");
          const now = Date.now();
          const egg = store.state().eggs.find(row => row.placeId === message.placeId && row.jobId === message.jobId &&
            row.uid === message.uid && row.expiresAt > now && !row.observationOnly && !row.carrierUserId &&
            (row.state === "Slot" || row.state === "Dropped"));
          const client = adminSocket();
          if (!egg || !client || client.reporterIdentity.placeId !== message.placeId) {
            send(ws, { version: 1, type: "egg.steal.ack", count: 0, reason: !egg ? "Œuf indisponible ou expiré." : "Admin indisponible." });
            return;
          }
          if (egg.jobId !== client.reporterIdentity.jobId && settings.get(client.reporterIdentity.userId)?.options?.GroupMode !== false) {
            send(ws, { version: 1, type: "egg.steal.ack", count: 0, reason: "Group Mode actif. STEAL est limité au serveur d’Admin." });
            return;
          }
          client.manualTeleportUntil = Math.min(egg.expiresAt, now + 60000);
          send(client, { version: 1, type: "teleport.request", requestId: randomUUID(), serverTime: now,
            target: { ...egg, expiresAt: client.manualTeleportUntil }, immediate: true, force: true, manualSteal: true });
          send(ws, { version: 1, type: "egg.steal.ack", count: 1, name: egg.name });
          return;
        }
        if (message.type === "observer.go-to-admin") {
          if (ws.role !== "viewer") throw Error("Only dashboard viewers may direct an observer");
          if (![message.placeId,message.jobId].every(value=>typeof value==="string"&&value.length>0&&value.length<=128)) throw Error("Serveur source invalide");
          const ack=message=>send(ws,{version:1,type:"observer.go-to-admin.ack",message});
          const destination=resolveAdminDestination(adminSocket(), [...wss.clients].filter(client=>client.readyState===WebSocket.OPEN), message.placeId);
          if (!destination||destination.placeId!==message.placeId) { ack("Admin indisponible dans ce jeu.");return; }
          if (groupHome?.placeId === message.placeId && groupHome.jobId === message.jobId &&
            settings.findByUsername(username)?.options?.GroupMode !== false) { ack("Group Mode actif : cet observer reste avec le groupe.");return; }
          if (destination.jobId===message.jobId) { ack("L’observer est déjà sur le serveur d’Admin.");return; }
          const now=Date.now();
          const observer=[...wss.clients].find(client=>client.readyState===WebSocket.OPEN&&client.role==="reporter"&&
            client.clientKind==="observer"&&client.observerOnly&&!client.superseded&&
            client.reporterIdentity?.placeId===message.placeId&&client.reporterIdentity.jobId===message.jobId);
          if (!observer) { ack("Aucun observer connecté sur ce serveur.");return; }
          if (groupReservation?.jobId === destination.jobId) { ack("Un observer est déjà attendu sur le serveur d’Admin.");return; }
          if (observer.manualObserverHopUntil>now) { ack("Une demande est déjà en cours pour cet observer.");return; }
          observer.manualObserverHopUntil=now+30000;
          observer.spreadSignature=undefined;
          send(observer,{version:1,type:"observer.go-to-admin",target:{
            placeId:message.placeId,jobId:message.jobId,destinationJobId:destination.jobId,delaySeconds:0
          }});
          ack("Demande transmise à "+observer.reporterIdentity.name+".");
          return;
        }
        if (message.type === "teleport.manual") {
          if (ws.role !== "viewer") throw Error("Only dashboard viewers may force a teleport");
          if (typeof message.placeId !== "string" || typeof message.jobId !== "string" || !message.jobId || message.jobId.length > 128) throw Error("Invalid destination");
          const now = Date.now(), eggs = store.state().eggs.filter(e => e.placeId === message.placeId && e.jobId === message.jobId && e.expiresAt > now);
          const roster = players.state().players.filter(p => p.placeId === message.placeId && p.jobId === message.jobId);
          if (!eggs.length && !roster.length) throw Error("Destination inconnue ou expiree");
          const client = adminSocket(), identity = client?.reporterIdentity;
          const eligible = identity && identity.placeId === message.placeId && identity.jobId !== message.jobId;
          if (eligible) {
            const best = eggs.sort((a,b) => (b.incomePerSecond || 0) - (a.incomePerSecond || 0))[0];
            client.manualTeleportUntil = now + 30000;
            send(client, { version: 1, type: "teleport.request", requestId: randomUUID(), serverTime: now,
              target: { ...best, placeId: message.placeId, jobId: message.jobId, expiresAt: now + 30000, incomePerSecond: best?.incomePerSecond || 0, name: best?.name || "Serveur choisi manuellement" }, immediate: true, force: true });
          }
          send(ws, { version: 1, type: "teleport.manual.ack", count: eligible ? 1 : 0, jobId: message.jobId }); return;
        }
        if (message.type === "logs.clear") {
          if (ws.role !== "viewer") throw Error("Only dashboard viewers may clear logs");
          // The dashboard button remains explicit; no migration deletes existing records.
          void logs.clear().then(() => { for (const viewer of wss.clients) if (viewer.role === "viewer") send(viewer, logsState()); }).catch(error => send(ws, { version: 1, type: "error", message: error.message }));
          return;
        }
        if (ws.role !== "reporter") throw Error("Viewer is read-only");
        if(message.type==='admin.trajectory.progress'){
          if(!isAdmin(ws)||message.version!==1||raw.length>32000||!Array.isArray(message.events)||!Array.isArray(message.sample?.p))return;
          for(const viewer of wss.clients)if(viewer.role==='viewer')send(viewer,message);
          return;
        }
        if(message.type==='admin.inventory.snapshot'||message.type==='admin.command.result'){
          if(!isAdmin(ws))throw Error('Only configured Admin.lua may report admin data');
          if(message.type==='admin.command.result'){panel.result(ws,message);return;}
          const accepted=panel.accept(ws,message);send(ws,{version:1,type:'admin.inventory.ack',revision:message.revision,sessionId:message.sessionId,accepted});return;
        }
        if (message.type === "settings.snapshot") {
          if (!ws.reporterIdentity) throw Error("Player identity required before settings");
          const accepted = isAdmin(ws) ? settings.accept(ws.reporterIdentity, message) : false;
          send(ws, { version: 1, type: "settings.ack", sessionId: message.sessionId, revision: message.revision, accepted });
          if (accepted) { ws.settingsSessionId = message.sessionId; broadcastAdmin(); broadcast(); } return;
        }
        if(message.type==="events.snapshot"){
          if(!isAdmin(ws)||message.version!==1)return;
          const now=Date.now()/1000;
          for(const type of ["butterflies","skyfall","cosmic","slickRick"]){
            const event=message.events?.[type];
            if(!Number.isFinite(event?.until)||event.until<=now||event.until>now+86400)continue;
            const id=String(event.id??Math.round(event.until/5));
            void notifications?.emit(type,ws.reporterIdentity.jobId+":"+id,"Événement détecté dans le serveur de "+ws.reporterIdentity.name+".");
          }
          return;
        }
        if (message.type === "logs.append") {
          if (!ws.reporterIdentity) throw Error("Player identity required before logs");
          if (message.version !== 1 || typeof message.sessionId !== "string" || message.sessionId.length > 100 || !Array.isArray(message.lines) || message.lines.length > 100 || message.lines.some(line => !Number.isSafeInteger(line.sequence) || line.sequence < 1 || typeof line.text !== "string" || !line.text.length || line.text.length > 4096)) throw Error("Invalid logs batch");
          const accepted = isAdmin(ws), lines = accepted ? message.lines.filter(line => flightResult(line.text)) : [];
          const entries = lines.length ? logs.append(ws.reporterIdentity, { ...message, lines }) : [];
          send(ws, { version: 1, type: "logs.ack", sessionId: message.sessionId, sequence: Math.max(0, ...message.lines.map(line => line.sequence)), accepted });
          for(const row of entries){
            const body=row.text.replace(/^\[Auto_SAE\]\[\d+\]\[[^\]]+\]\[FLIGHT_RESULT\]\[[^\]]*\]\s*/,"");
            const result=body.match(/ (Reussi|Echouee|Echoue)(?:, \{| \|)/);
            if(result)void notifications?.emit(result[1]==="Reussi"?"flightSuccess":"flightFailure",row.id,body.slice(0,220));
          }
          if (entries.length) for (const viewer of wss.clients) if (viewer.role === "viewer") send(viewer, { version: 1, type: "logs.append", entries });
          return;
        }
        if (message.type === "players.snapshot") {
          const reporter = Array.isArray(message.players) && message.players.find(p => p.userId === message.reporterUserId);
          if ((ws.claimedReporterUserId && message.reporterUserId !== ws.claimedReporterUserId) || (ws.reporterIdentity && (message.reporterUserId !== ws.reporterIdentity.userId || reporter?.name?.toLowerCase() !== ws.reporterIdentity.name.toLowerCase()))) throw Error("Reporter identity changed");
          const accepted = players.accept(ws.connectionId, message, { observerOnly: ws.observerOnly });
          send(ws, { version: 1, type: "players.ack", revision: message.revision, accepted });
          if (accepted) {
            ws.reporterIdentity = { name: reporter.name, displayName: reporter.displayName, userId: reporter.userId, placeId: message.placeId, jobId: message.jobId };
            if (isAdmin(ws) || ws.observerOnly) {
              const maxPlayers = message.maxPlayers;
              ws.groupCapacity = Number.isSafeInteger(maxPlayers) && maxPlayers > 0 && maxPlayers <= 500
                ? { maxPlayers, userIds: new Set(message.players.map(row => row.userId)), at: Date.now() } : null;
            }
            for(const previous of wss.clients){
              if(previous!==ws&&previous.role==='reporter'&&previous.reporterIdentity?.userId===reporter.userId&&previous.reporterIdentity.jobId!==message.jobId){
                previous.superseded=true;previous.reporterIdentity=null;players.remove(previous.connectionId);previous.close(1000,'Reporter moved to another server');
              }
            }
            reporterPolicy(ws); broadcast();
          }
          return;
        }
        const accepted = store.accept(message);
        send(ws, { version: 1, type: "eggs.ack", sessionId: message.sessionId, cycleId: message.cycleId, revision: message.revision, accepted });
        if (accepted) broadcast();
      } catch (error) { send(ws, { version: 1, type: "error", message: String(error.message).slice(0,160) }); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
    distributeObservers();
    if (store.prune() || players.prune()) broadcast();
  },15000); heartbeat.unref();
  return {
    info: () => ({ executionConfigured: false, adminUsername: username, clients: wss.clients.size, reportAuthentication: Boolean(reportToken), viewerAuthentication: Boolean(viewerToken || dashboardAuth?.configured), logsStorage: logs.state().storage, logsLimit: logs.state().limit }),
    async close() {
      if (closed) return; closed = true; panel.close(); unsubscribeSettings(); unsubscribeLogs(); clearInterval(heartbeat); clearTimeout(broadcastTimer);
      server.removeListener("upgrade",upgrade); for (const ws of wss.clients) ws.terminate(); wss.close(); await Promise.all([logs.close(),settings.close(),ljrpc.close()]);
    }
  };
}
module.exports = { attachEggGateway, sameToken };
