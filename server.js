const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- CONFIGURATION MONGODB ---
// Remplace par ton URI si tu n'utilises pas de variables d'environnement
const MONGO_URI = process.env.MONGO_URI || "TON_LIEN_MONGODB_ICI";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ [DB] MongoDB Connecté"))
  .catch(err => console.error("❌ [DB] Erreur Connexion :", err));

// Schéma de la collection
const ClientSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    brainrots: mongoose.Schema.Types.Mixed, 
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const ClientModel = mongoose.model('Client', ClientSchema);

// --- FONCTION BROADCAST ---
// Cette fonction récupère tout dans la DB et l'envoie aux pages HTML
async function broadcastToAdmins() {
    try {
        const allClients = await ClientModel.find({});
        const payload = JSON.stringify({ type: 'REFRESH', data: allClients });
        
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    } catch (e) {
        console.error("❌ [BROADCAST] Erreur :", e);
    }
}

// --- GESTION WEBSOCKET ---
wss.on('connection', async (ws) => {
    console.log("🔌 Nouvelle connexion WebSocket");

    // Envoi initial des données dès qu'on ouvre le Dashboard
    await broadcastToAdmins();

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);

            // Réception des données du script Roblox
            if (payload.Method === "PlayerInfos") {
                const d = payload.Data;

                await ClientModel.findOneAndUpdate(
                    { userId: d.UserId },
                    {
                        name: d.Name,
                        displayName: d.DisplayName,
                        accountAge: d.AccountAge,
                        brainrots: d.Brainrots,
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
                
                console.log(`[DB] Mise à jour : ${d.Name}`);
                
                // On prévient tout de suite le HTML que les données ont changé
                await broadcastToAdmins();
            }
        } catch (e) {
            console.error("⚠️ Erreur message entrant :", e.message);
        }
    });

    ws.on('close', () => console.log("❌ Connexion fermée"));
});

// --- ROUTES API (NETTOYAGE) ---

// Supprimer un joueur spécifique
app.delete('/api/client/:userId', async (req, res) => {
    try {
        await ClientModel.deleteOne({ userId: req.params.userId });
        console.log(`🧹 Suppression : ${req.params.userId}`);
        await broadcastToAdmins();
        res.json({ message: "Supprimé" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Vider toute la collection
app.post('/api/clear-database', async (req, res) => {
    try {
        await ClientModel.deleteMany({});
        console.log("🧹 [DB] Collection vidée");
        await broadcastToAdmins();
        res.json({ message: "Base vidée" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Servir le dossier public (où se trouve ton index.html)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    🚀 ==========================================
    🌍 SERVEUR M4GIX PRÊT SUR LE PORT ${PORT}
    📂 Mode : Stockage Collection Personnel
    💾 DB : MongoDB Atlas
    =============================================
    `);
});
