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

        if (isAll) {
            const players = await Player.find({ isOnline: true }, 'displayName brainrots');
            brainrotsList = players.flatMap(p => p.brainrots.map(b => ({ ...b, Owner: p.displayName })));
        } else if (query.user) {
            const player = await Player.findOne({ displayName: new RegExp('^' + query.user + '$', 'i') });
            brainrotsList = player ? player.brainrots : [];
        }

        // Si l'utilisateur demande du JSON (pour un script)
        if (query.format === "json") {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(brainrotsList));
        }

        // Sinon, on envoie la page HTML avec le Grid
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <link href="https://unpkg.com/gridjs/dist/theme/mermaid.min.css" rel="stylesheet" />
                <style>
                    body { font-family: sans-serif; background: #1a1a1a; color: white; padding: 20px; }
                    .container { max-width: 1200px; margin: auto; background: #2d2d2d; padding: 20px; border-radius: 10px; }
                    h1 { color: #00e5ff; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🧠 Inventaire Brainrots - ${query.user}</h1>
                    <div id="wrapper"></div>
                </div>

                <script src="https://unpkg.com/gridjs/dist/gridjs.umd.js"></script>
                <script>
                    const data = ${JSON.stringify(brainrotsList)};
                    
                    new gridjs.Grid({
                        columns: [
                            { name: "Owner", hidden: ${!isAll} },
                            "Name", 
                            "Rarity", 
                            { name: "Generation", formatter: (cell) => "$" + cell.toLocaleString() + "/s" },
                            "Mutation", 
                            "Traits"
                        ],
                        data: data.map(item => [
                            item.Owner || "",
                            item.Name,
                            item.Rarity,
                            item.Generation,
                            item.Mutation,
                            item.Traits.join(", ")
                        ]),
                        sort: true,
                        search: true,
                        pagination: { limit: 10 },
                        style: { 
                            table: { background: '#333', color: '#ccc' },
                            th: { background: '#444', color: '#fff' }
                        }
                    }).render(document.getElementById("wrapper"));
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        res.end("Erreur de chargement");
    }
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
