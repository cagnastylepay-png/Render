const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- CONFIGURATION MONGODB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ [DB] MongoDB Connecté"))
  .catch(err => console.error("❌ [DB] Erreur :", err));

// Schéma flexible pour stocker toutes les infos du joueur et ses "Brainrots"
const ClientSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    brainrots: mongoose.Schema.Types.Mixed, 
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const ClientModel = mongoose.model('Client', ClientSchema);

// --- LOGIQUE WEBSOCKET (RECEPTION DES DONNÉES) ---

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);

            // On intercepte uniquement le message envoyé par ton script Roblox
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
                console.log(`[DB] Mise à jour effectuée pour : ${d.Name}`);
            }
        } catch (e) { 
            console.error(`⚠️ Erreur lors du traitement du message :`, e.message); 
        }
    });
});

// --- ROUTES API (NETTOYAGE) ---

// Supprimer un client spécifique par son UserId
app.delete('/api/client/:userId', async (req, res) => {
    try {
        await ClientModel.deleteOne({ userId: req.params.userId });
        console.log(`🧹 Client ${req.params.userId} supprimé.`);
        res.json({ message: "Client supprimé" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Vider toute la collection
app.post('/api/clear-database', async (req, res) => {
    try {
        await ClientModel.deleteMany({});
        console.log("🧹 [DB] Base de données entièrement vidée.");
        res.json({ message: "Database cleared" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Servir les fichiers statiques (pour le futur HTML)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVEUR DE STOCKAGE PRÊT SUR LE PORT ${PORT}`);
});
