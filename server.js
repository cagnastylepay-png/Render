const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const url = require('url');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

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
    serverId: String,
    isOnline: { type: Boolean, default: false },
    lastUpdate: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', PlayerSchema);

// --- Serveur HTTP ---
// L'ajout du mot-clé 'async' ici règle ton erreur !
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    if (path === "/brainrots") {
    try {
        const isAll = query.user === "all";
        let brainrotsList = [];

        // 1. Récupération des données
        if (isAll) {
            const players = await Player.find({}, 'displayName brainrots');
            brainrotsList = players.flatMap(p => 
                (p.brainrots || []).map(b => ({ ...b, Player: p.displayName }))
            );
        } else if (query.user) {
            const player = await Player.findOne({ 
                displayName: new RegExp('^' + query.user + '$', 'i') 
            });
            brainrotsList = player ? (player.brainrots || []).map(b => ({ ...b, Player: player.displayName })) : [];
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <link href="https://unpkg.com/gridjs/dist/theme/mermaid.min.css" rel="stylesheet" />
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #121212; color: #e0e0e0; padding: 20px; }
                    .dashboard-header { 
                        background: #1e1e1e; padding: 20px; border-radius: 12px; margin-bottom: 20px;
                        display: flex; justify-content: space-between; align-items: center; border: 1px solid #333;
                    }
                    h1 { margin: 0; color: #00e5ff; font-size: 1.5rem; }
                    .stats { color: #888; font-size: 0.9rem; }
                    .gridjs-container { background: #1e1e1e; border-radius: 12px; padding: 10px; }
                </style>
            </head>
            <body>
                <div class="dashboard-header">
                    <div>
                        <h1>🧠 Brainrots Inventory</h1>
                        <div class="stats">${brainrotsList.length} items totalisés</div>
                    </div>
                </div>

                <div id="table-container"></div>

                <script src="https://unpkg.com/gridjs/dist/gridjs.umd.js"></script>
                <script>
                    // Fonction de formatage K, M, B, T
                    function formatKMBT(value) {
                        if (value >= 1e12) return "$" + (value / 1e12).toFixed(1) + "T/s";
                        if (value >= 1e9)  return "$" + (value / 1e9).toFixed(1) + "B/s";
                        if (value >= 1e6)  return "$" + (value / 1e6).toFixed(1) + "M/s";
                        if (value >= 1e3)  return "$" + (value / 1e3).toFixed(1) + "K/s";
                        return "$" + value.toFixed(1) + "/s";
                    }

                    const data = ${JSON.stringify(brainrotsList)};

                    new gridjs.Grid({
                        columns: [
                            { name: "Player" },
                            { name: "Name" },
                            { name: "Rarity" },
                            { 
                                name: "Generation", 
                                formatter: (cell) => formatKMBT(cell) // Affichage stylé
                            },
                            { name: "Mutation" },
                            { name: "Traits", formatter: (cell) => (cell || []).join(", ") }
                        ],
                        data: data.map(item => [
                            item.Player || "Unknown",
                            item.Name,
                            item.Rarity,
                            item.Generation || 0, // Valeur brute pour le tri
                            item.Mutation,
                            item.Traits
                        ]),
                        sort: true,
                        search: true,
                        pagination: { limit: 25 },
                        style: { 
                            table: { background: '#1e1e1e', color: '#ccc' },
                            th: { background: '#2d2d2d', color: '#fff', border: '1px solid #444' },
                            td: { border: '1px solid #333' }
                        }
                    }).render(document.getElementById("table-container"));
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(err);
        res.writeHead(500);
        return res.end("Erreur serveur.");
    }
}
    else 
    {
        res.end("Erreur de chargement");
    }
});

// --- WebSocket ---
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            const { Method, Data } = payload;

            // 1. Gestion des informations générales du serveur
            if (Method === "ServerInfos") {
                console.log(`🌐 [SERVER] Nouveau player connecté. Nom: ${Data.Player} ServerId: ${Data.ServerId}`);
                await Player.findOneAndUpdate(
                   { displayName: Data.Player },
                   { 
                       serverId: Data.ServerId, 
                       isOnline: true, 
                       lastUpdate: new Date() 
                   },
                   { upsert: true }
               );
            }

            // 2. Gestion de l'ajout ou de la mise à jour d'un joueur
            if (Method === "PlayerAdded") {
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

            // 3. Gestion de la déconnexion
            if (Method === "PlayerRemoving") {
                console.log(`🚪 [OFFLINE] ${Data}`);
                await Player.findOneAndUpdate(
                    { displayName: Data }, 
                    { isOnline: false },
                    { upsert: true }
                );
            }

        } catch (e) {
            console.error("❌ Erreur traitement message:", e);
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Serveur actif sur port ${PORT}`));
