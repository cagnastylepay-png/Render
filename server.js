const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const url = require('url');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const connectedClients = {};

// --- Connexion MongoDB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("💾 [DB] Connecté à MongoDB Atlas"))
    .catch(err => console.error("❌ [DB] Erreur connexion :", err));

const PlayerSchema = new mongoose.Schema({
    displayName: { type: String, unique: true },
    cash: Number,
    rebirths: Number,
    steals: Number,
    brainrots: Array,
    lastUpdate: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', PlayerSchema);

// --- Serveur HTTP ---
// L'ajout du mot-clé 'async' ici règle ton erreur !
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const query = parsedUrl.query;

    // --- ROUTE : INVENTAIRE ET DASHBOARD ---
    if (path === "/brainrots") {
        try {
            const onlinePlayers = Object.keys(connectedClients);
            const isAll = query.user === "all";
            let brainrotsList = [];

            if (isAll) {
                const players = await Player.find({}, 'displayName brainrots');
                brainrotsList = players.flatMap(p => 
                    (p.brainrots || []).map(b => ({ ...b, Player: p.displayName }))
                );
            } else if (query.user) {
                const player = await Player.findOne({ displayName: new RegExp('^' + query.user + '$', 'i') });
                brainrotsList = player ? (player.brainrots || []).map(b => ({ ...b, Player: player.displayName })) : [];
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`
                <!DOCTYPE html>
                <html lang="fr">
                <head>
                    <meta charset="UTF-8">
                    <link href="https://unpkg.com/gridjs/dist/theme/mermaid.min.css" rel="stylesheet" />
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #ffffff; padding: 20px; }
                        .dashboard-header { 
                            background: #161616; padding: 20px; border-radius: 10px; margin-bottom: 20px;
                            border: 1px solid #333; display: flex; justify-content: space-between; align-items: center;
                        }
                        h1 { margin: 0; color: #00e5ff; text-transform: uppercase; letter-spacing: 1px; font-size: 24px; }
                        
                        /* CONTROLES UPDATE */
                        .controls { display: flex; gap: 12px; align-items: center; background: #222; padding: 10px; border-radius: 8px; border: 1px solid #444; }
                        select { 
                            background: #121212; color: white; border: 1px solid #555; 
                            padding: 10px; border-radius: 5px; outline: none; min-width: 180px;
                        }
                        .btn-update { 
                            background: #00e5ff; color: black; border: none; padding: 10px 20px; 
                            border-radius: 5px; cursor: pointer; font-weight: bold; transition: 0.2s;
                        }
                        .btn-update:hover { background: #00b8d4; transform: scale(1.02); }
                        .btn-update:disabled { background: #555; cursor: not-allowed; }

                        /* GRIDJS CUSTOM DARK THEME */
                        .gridjs-container { color: #ffffff !important; }
                        .gridjs-td { color: #ffffff !important; background-color: #161616 !important; border: 1px solid #2a2a2a !important; }
                        .gridjs-th { background-color: #252525 !important; color: #00e5ff !important; text-transform: uppercase; font-weight: bold; }
                        .gridjs-tr:hover .gridjs-td { background-color: #1f1f1f !important; }
                        .gridjs-search-input { background: #161616 !important; color: white !important; border: 1px solid #444 !important; }
                        .gridjs-footer { background-color: #161616 !important; border: 1px solid #2a2a2a !important; color: white !important; }
                        .gridjs-pagination .gridjs-pages button { color: white !important; background: #252525 !important; border: 1px solid #444; }
                        .gridjs-pagination .gridjs-pages button:hover { background: #00e5ff !important; color: black !important; }
                    </style>
                </head>
                <body>
                    <div class="dashboard-header">
                        <div>
                            <h1>🧠 Inventaire Brainrots</h1>
                            <div style="color: #888;">${brainrotsList.length} items détectés</div>
                        </div>

                        <div class="controls">
                            <select id="clientSelect">
                                <option value="">-- Sélectionner Serveur --</option>
                                ${onlinePlayers.map(name => `<option value="${name}">${name}</option>`).join('')}
                            </select>
                            <button class="btn-update" id="updateBtn" onclick="sendUpdateCommand()">🔄 Update</button>
                        </div>
                    </div>

                    <div id="table-container"></div>

                    <script src="https://unpkg.com/gridjs/dist/gridjs.umd.js"></script>
                    <script>
                        // --- FONCTION ENVOI COMMANDE ---
                        async function sendUpdateCommand() {
                            const target = document.getElementById('clientSelect').value;
                            const btn = document.getElementById('updateBtn');
                            if (!target) return alert("Veuillez sélectionner un serveur actif.");

                            btn.innerText = "⏳ Envoi...";
                            btn.disabled = true;

                            try {
                                const response = await fetch('/send-command', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ target: target, method: "UpdateDatabase" })
                                });
                                
                                if(response.ok) {
                                    alert("✅ Signal envoyé ! L'inventaire sera mis à jour dans quelques secondes.");
                                } else {
                                    alert("❌ Échec : Le serveur est peut-être déconnecté.");
                                }
                            } catch (e) {
                                alert("❌ Erreur réseau lors de l'envoi.");
                            } finally {
                                btn.innerText = "🔄 Update";
                                btn.disabled = false;
                            }
                        }

                        // --- RENDER GRIDJS ---
                        const rawData = ${JSON.stringify(brainrotsList)};

                        new gridjs.Grid({
                            columns: [
                                { name: "Base", width: "150px" },
                                { name: "Nom", width: "200px" },
                                { name: "Rareté" },
                                { name: "Revenu (s)", sort: { compare: (a, b) => a - b } },
                                { name: "Mutation" },
                                { name: "Traits", formatter: (cell) => (cell && cell.length > 0) ? cell.join(", ") : "Aucun" }
                            ],
                            data: rawData.map(item => [
                                item.Player || "Inconnu",
                                item.Name,
                                item.Rarity,
                                item.Generation || 0,
                                item.Mutation,
                                item.Traits
                            ]),
                            sort: true,
                            search: true,
                            pagination: { limit: 20 },
                            style: { table: { 'white-space': 'nowrap' } },
                            language: { 'search': { 'placeholder': 'Rechercher un animal...' } }
                        }).render(document.getElementById("table-container"));
                    </script>
                </body>
                </html>
            `);
        } catch (err) {
            res.writeHead(500);
            return res.end("Erreur Interne du Serveur.");
        }
    }

    if (path === "/cmd") {
        const onlinePlayers = Object.keys(connectedClients);
        const options = onlinePlayers.map(name => `<option value="${name}">${name}</option>`).join('');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #ffffff; padding: 40px; display: flex; flex-direction: column; align-items: center; }
                    .panel { background: #161616; padding: 30px; border-radius: 15px; border: 1px solid #333; width: 100%; max-width: 600px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                    h1 { color: #00e5ff; text-transform: uppercase; text-align: center; margin-bottom: 30px; }
                    .command-row { display: flex; flex-direction: column; gap: 15px; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #2a2a2a; }
                    label { font-weight: bold; color: #888; font-size: 12px; letter-spacing: 1px; }
                    .flex-group { display: flex; gap: 10px; align-items: center; }
                    select, button, input { padding: 12px; border-radius: 8px; border: 1px solid #444; outline: none; }
                    select, input { background: #121212; color: white; flex-grow: 1; }
                    button { background: #00e5ff; color: black; font-weight: bold; cursor: pointer; border: none; transition: 0.3s; min-width: 100px; }
                    button:hover { background: #00b8d4; transform: translateY(-2px); }
                    .btn-stop { background: #ff4d4d; color: white; }
                    .btn-stop:hover { background: #ff3333; }
                    .status { text-align: center; font-size: 14px; margin-top: 10px; min-height: 20px; color: #00e5ff; }
                </style>
            </head>
            <body>
                <div class="panel">
                    <h1>🛠️ Console de Commandes</h1>

                    <div class="command-row" style="border: 1px solid #00e5ff; padding: 20px; border-radius: 10px;">
                        <label>🤖 GESTION AUTO-BUY</label>
                        <div class="flex-group" style="margin-bottom: 10px;">
                            <select id="autoBuyTarget">
                                <option value="all">🌐 TOUS LES CLIENTS</option>
                                ${onlinePlayers.map(name => `<option value="${name}">${name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="flex-group">
                            <input type="text" id="minGen" placeholder="Seuil (ex: 1M, 500k)" value="1M">
                            <button onclick="controlAutoBuy('start')">START</button>
                            <button onclick="controlAutoBuy('stop')" class="btn-stop">STOP</button>
                        </div>
                    </div>

                    <div class="command-row">
                        <label>MISE À JOUR BASE DE DONNÉES</label>
                        <div class="flex-group">
                            <select id="updateSelect">
                                <option value="">-- Sélectionner Client --</option>
                                ${options}
                            </select>
                            <button onclick="sendCommand('updateSelect', 'UpdateDatabase')">EXÉCUTER</button>
                        </div>
                    </div>

                    <div class="command-row" style="border: 1px solid #ff00ff; padding: 20px; border-radius: 10px; background: rgba(255, 0, 255, 0.02);">
                        <label style="color: #ff00ff;">🌌 RITUEL : LA VACCA SATURNO SATURNITA</label>
                        <div class="flex-group" style="flex-wrap: wrap; margin-top: 10px;">
                            <select id="ritual1"><option value="">P1</option>${options}</select>
                            <select id="ritual2"><option value="">P2</option>${options}</select>
                            <select id="ritual3"><option value="">P3</option>${options}</select>
                            <button onclick="ExecuteRitual('La Vacca Saturno Saturnita')" style="background: #ff00ff; color: white;">INCANTER</button>
                        </div>
                    </div>

                    <div id="msgStatus" class="status"></div>
                </div>

                <script>
                    async function execPost(data) {
                        const status = document.getElementById('msgStatus');
                        status.innerText = "⏳ Envoi...";
                        try {
                            const res = await fetch('/send-command', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(data)
                            });
                            status.innerText = res.ok ? "✅ Commande envoyée !" : "❌ Échec de l'envoi.";
                            setTimeout(() => status.innerText = "", 3000);
                        } catch(e) { status.innerText = "❌ Erreur réseau."; }
                    }

                    function parseMoney(str) {
                        if (!str) return 1000000;
                        const clean = str.toLowerCase().replace(/[^0-9.kmbt]/g, '');
                        const val = parseFloat(clean);
                        if (clean.includes('k')) return val * 1000;
                        if (clean.includes('m')) return val * 1000000;
                        if (clean.includes('b')) return val * 1000000000;
                        if (clean.includes('t')) return val * 1000000000000;
                        return val || 0;
                    }
                
                    function controlAutoBuy(type) {
                        const target = document.getElementById('autoBuyTarget').value; // Récupère "all" ou le nom du bot
                        const inputVal = document.getElementById('minGen').value;
                        const numericValue = parseMoney(inputVal); 
                    
                        execPost({ 
                            target: target, 
                            method: type === 'start' ? "StartAutoBuy" : "StopAutoBuy",
                            data: { minGeneration: numericValue }
                        });
                    }

                    async function ExecuteRitual(name) {
                        const p1 = document.getElementById('ritual1').value;
                        const p2 = document.getElementById('ritual2').value;
                        const p3 = document.getElementById('ritual3').value;
                        if (!p1 || !p2 || !p3) return alert("3 participants requis !");
                        execPost({ target: p1, method: "ExecuteRitual", data: { ritualName: name, players: [p1, p2, p3] } });
                    }

                    function sendCommand(id, method) {
                        const target = document.getElementById(id).value;
                        if (!target) return alert("Sélectionnez un client.");
                        execPost({ target, method });
                    }
                </script>
            </body>
            </html>
        `);
    }
    // --- ROUTE : ENVOI DE COMMANDE VIA WEBSOCKET ---
    if (path === "/send-command" && req.method === "POST") {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { target, method, data } = JSON.parse(body);

                if (method === "StartAutoBuy" || method === "StopAutoBuy") {
                    const payload = { 
                        Method: method, 
                        Param: { MinGeneration: data.minGeneration } 
                    };
                
                    if (target === "all") {
                        // Envoie à tout le monde
                        Object.values(connectedClients).forEach(client => {
                            if (client.socket.readyState === 1) client.socket.send(JSON.stringify(payload));
                        });
                        console.log(`📢 [BROADCAST] ${method} envoyé à tous.`);
                    } else {
                        // Envoie à un bot spécifique
                        const client = connectedClients[target];
                        if (client && client.socket.readyState === 1) {
                            client.socket.send(JSON.stringify(payload));
                            console.log(`📧 [DIRECT] ${method} envoyé à ${target}.`);
                        }
                    }
                    res.writeHead(200); return res.end("Signal transmis.");
                }
                if(method === "UpdateDatabase") {
                    const client = connectedClients[target];
                    if (client && client.socket && client.socket.readyState === 1) {
                        client.socket.send(JSON.stringify({ Method: method, Data: { } }));
                        res.writeHead(200);
                        res.end("OK");
                    } else {
                        res.writeHead(404);
                        res.end("Client Introuvable ou Déconnecté");
                    }
                    return;
                }
                if (method === "ExecuteRitual") {
                    const { ritualName, players } = data; // players est ["Name1", "Name2", "Name3"]
                    const client = connectedClients[players[0]];
                
                    if (client && client.socket.readyState === 1) {
                        client.socket.send(JSON.stringify({
                            Method: "ExecuteRitual",
                            Param: { 
                                RitualName: ritualName, 
                                ClientNumber: 0, // On commence à 0
                                Clients: players 
                            }
                        }));
                        res.writeHead(200);
                        res.end("Chaîne de rituel amorcée.");
                    } else {
                        res.writeHead(404);
                        res.end("Premier participant introuvable.");
                    }
                    return;
                }
            } catch (e) {
                res.writeHead(400);
                res.end("Format JSON invalide");
            }
        });
        return;
    }

    // --- FALLBACK ---
    res.writeHead(404);
    res.end("Page introuvable");
});

// --- WebSocket ---
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {

    ws.on('close', () => {
        // On cherche quel joueur était lié à cette socket pour le supprimer
        for (let name in connectedClients) {
            if (connectedClients[name].socket === ws) {
                console.log(`🔌 [SERVER] Client déconnecté : ${name}`);
                delete connectedClients[name];
                break;
            }
        }
    });

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            const { Method, Data } = payload;

            if (Method === "ExecuteRitualNextClient") {
                const { RitualName, ClientNumber, Clients } = Data;
                const nextPlayerName = Clients[ClientNumber]; // Le numéro est déjà incrémenté par Lua
                const client = connectedClients[nextPlayerName];
            
                if (client && client.socket.readyState === 1) {
                    console.log(`➡️ Relais du rituel passé à : ${nextPlayerName} (Index: ${ClientNumber})`);
                    client.socket.send(JSON.stringify({
                        Method: "ExecuteRitual",
                        Param: { 
                            RitualName: RitualName, 
                            ClientNumber: ClientNumber, 
                            Clients: Clients 
                        }
                    }));
                } else {
                    console.error(`❌ Client ${nextPlayerName} introuvable pour la suite du rituel.`);
                }
            }

            if (Method === "ClientInfos") {
                const playerName = Data.Player;
                const serverId = Data.ServerId;
                connectedClients[playerName] = {
                    socket: ws,
                    serverId: serverId,
                    connectedAt: new Date()
                };
                console.log(`🌐 [SERVER] Client enregistré : ${playerName} sur le serveur ${serverId}`);
            }

            // 2. Gestion de l'ajout ou de la mise à jour d'un joueur
            if (Method === "UpdateDatabase") {
                if (!Data || !Data.DisplayName) return;

                await Player.findOneAndUpdate(
                    { displayName: Data.DisplayName },
                    { 
                        cash: Data.Cash,
                        rebirths: Data.Rebirths,
                        steals: Data.Steals,
                        brainrots: Data.Brainrots,
                        serverId: Data.ServerId, // On enregistre l'ID du serveur
                        isOnline: true, // Optionnel : pour savoir s'il est en ligne
                        lastUpdate: new Date()
                    },
                    { upsert: true }
                );
                console.log(`✅ [DB] Mise à jour : ${Data.DisplayName} (${Data.Brainrots.length} brainrots)`);
            }

        } catch (e) {
            console.error("❌ Erreur traitement message:", e);
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Serveur actif sur port ${PORT}`));
