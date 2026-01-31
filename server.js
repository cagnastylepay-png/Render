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
                                    body: JSON.stringify({ target: target, method: "GetBrainrots" })
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

    // --- ROUTE : ENVOI DE COMMANDE VIA WEBSOCKET ---
    if (path === "/send-command" && req.method === "POST") {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { target, method } = JSON.parse(body);
                const client = connectedClients[target];

                if (client && client.socket && client.socket.readyState === 1) {
                    // Relais du message vers le client Roblox
                    client.socket.send(JSON.stringify({ Method: method, Data: { TargetPlayer: target } }));
                    res.writeHead(200);
                    res.end("OK");
                } else {
                    res.writeHead(404);
                    res.end("Client Introuvable ou Déconnecté");
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

            // 1. Gestion des informations générales du serveur
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
