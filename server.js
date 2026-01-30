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
    if (path === "/brainrots") {
        try {
            res.writeHead(200, { 'Content-Type': 'application/json' });

            if (query.user === "all") {
                // Récupère tous les joueurs
                const allPlayers = await Player.find({}, 'brainrots');
                
                // Fusionne tous les tableaux de brainrots en un seul
                // .flatMap permet de transformer [[1,2], [3,4]] en [1,2,3,4]
                const allBrainrots = allPlayers.flatMap(p => p.brainrots || []);
                
                return res.end(JSON.stringify(allBrainrots, null, 2));
            } 
            
            else if (query.user) {
                const player = await Player.findOne({ 
                    displayName: new RegExp('^' + query.user + '$', 'i') 
                }, 'brainrots');
                
                // Retourne soit le tableau du joueur, soit un tableau vide si non trouvé
                const list = player ? player.brainrots : [];
                return res.end(JSON.stringify(list, null, 2));
            } else {
                res.writeHead(400);
                return res.end(JSON.stringify({ error: "Paramètre ?user manquant (all ou username)" }));
            }
        } catch (err) {
            res.writeHead(500);
            return res.end(JSON.stringify([]));
        }
    }
    res.end("Serveur Persistant OK. Allez sur /brainrots");
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
