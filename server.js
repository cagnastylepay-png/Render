const http = require('http');
const WebSocket = require('ws');
const url = require('url');

// Récupération du port via variable d'environnement (indispensable pour Render)
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // Récupéré depuis Render

// --- Connexion MongoDB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("💾 [DB] Connecté à MongoDB Atlas"))
    .catch(err => console.error("❌ [DB] Erreur connexion :", err));

// Structure des données d'un joueur
const PlayerSchema = new mongoose.Schema({
    displayName: { type: String, unique: true },
    cash: Number,
    rebirths: Number,
    steals: Number,
    brainrots: Array,
    lastUpdate: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', PlayerSchema);

// 1. Création du serveur HTTP
const server = http.createServer((req, res) => {
    console.log(`[HTTP] Requête reçue : ${req.method} ${req.url}`);
    if (req.url === "/view-db") {
        const players = await Player.find().sort({ lastUpdate: -1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(players, null, 2));
    }
    res.end("Serveur Persistant OK. Allez sur /view-db");
});

// 2. Création du serveur WebSocket attaché au serveur HTTP
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Extraction des paramètres de l'URL (ex: ?user=clientusername)
    const parameters = url.parse(req.url, true).query;
    const username = parameters.user || 'Anonyme';

    console.log(`[WS] Nouvelle connexion : ${username} (URL: ${req.url})`);

    ws.on('message', (message) => {
        // Le message arrive souvent sous forme de Buffer
        console.log(`[WS] Message reçu de ${username} : ${message}`);
        try {
            const { Method, Data } = JSON.parse(message);

            if (Method === "PlayerAdded" || Method === "ServerInfos") {
                // On prépare les données à traiter
                const playersToProcess = Method === "PlayerAdded" ? { [Data.DisplayName]: Data } : Data.Player;

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
                console.log(`✅ [DB] Synchro terminée pour ${Method}`);
            }
        } catch (e) {
            console.error("❌ Erreur traitement message:", e);
        }
    });

    ws.on('close', () => {
        console.log(`[WS] Déconnexion de ${username}`);
    });
    
});

// 3. Lancement du serveur
server.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
