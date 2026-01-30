const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');

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
    lastUpdate: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', PlayerSchema);

// --- Serveur HTTP ---
// L'ajout du mot-clé 'async' ici règle ton erreur !
const server = http.createServer(async (req, res) => {
    if (req.url === "/view-db") {
        try {
            const players = await Player.find().sort({ lastUpdate: -1 });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(players, null, 2));
        } catch (err) {
            res.writeHead(500);
            return res.end("Erreur lors de la lecture de la base de données");
        }
    }
    res.end("Serveur Persistant OK. Allez sur /view-db");
});

// --- WebSocket ---
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    // Ici aussi on utilise 'async' pour pouvoir utiliser 'await' à l'intérieur
    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            const { Method, Data } = payload;

            if (Method === "PlayerAdded" || Method === "ServerInfos") {
                const playersToProcess = Method === "PlayerAdded" ? { [Data.DisplayName]: Data } : Data.Player;

                if (!playersToProcess) return;

                for (const [name, info] of Object.entries(playersToProcess)) {
                    if (!info) continue;
                    
                    await Player.findOneAndUpdate(
                        { displayName: name },
                        { 
                            cash: info.Cash,
                            rebirths: info.Rebirths,
                            steals: info.Steals,
                            brainrots: info.Brainrots,
                            lastUpdate: new Date()
                        },
                        { upsert: true }
                    );
                }
                console.log(`✅ [DB] Mise à jour réussie (${Method})`);
            }
        } catch (e) {
            console.error("❌ Erreur traitement message:", e);
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Serveur actif sur port ${PORT}`));
