const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- UTILITAIRES DE LOG ---
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// --- MONGODB ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => log("✅ [DB] Connexion établie avec succès"))
  .catch(err => log(`❌ [DB] ERREUR DE CONNEXION : ${err}`));

const ClientSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    brainrots: mongoose.Schema.Types.Mixed, 
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const ClientModel = mongoose.model('Client', ClientSchema);

// --- GESTION CLIENTS ---
const activeBots = new Map();      
const activeDashboards = new Set(); 

async function broadcastToDashboard() {
    log(`📡 Diffusion mise à jour vers ${activeDashboards.size} dashboard(s)...`);
    try {
        const allClients = await ClientModel.find({});
        const onlineBots = Array.from(activeBots.keys());
        const payload = JSON.stringify({ type: 'REFRESH', data: allClients, online: onlineBots });
        activeDashboards.forEach(ws => { 
            if (ws.readyState === WebSocket.OPEN) ws.send(payload); 
        });
    } catch (e) { log(`❌ [BROADCAST] Erreur : ${e.message}`); }
}

// --- ROUTES API ---

// 1. PING
app.get('/ping', (req, res) => {
    log("🔌 [HTTP] Ping reçu (Keep-alive)");
    res.send("Pong !");
});

// 2. GET
app.get('/api/get', async (req, res) => {
    const { username } = req.query;
    log(`🔍 [API] Recherche du joueur : ${username}`);
    try {
        const data = await ClientModel.findOne({ name: username });
        if (!data) log(`⚠️ [API] Joueur ${username} introuvable en DB`);
        res.json(data || { error: "Non trouvé" });
    } catch (e) { 
        log(`❌ [API] Erreur GET : ${e.message}`);
        res.status(500).send(e.message); 
    }
});

// 3. REMOVE
app.get('/api/remove', async (req, res) => {
    const { username } = req.query;
    log(`🗑️ [API] Demande de suppression : ${username}`);
    try {
        const result = await ClientModel.deleteOne({ name: username });
        log(`✅ [API] ${result.deletedCount} document supprimé`);
        await broadcastToDashboard();
        res.send(`Joueur ${username} supprimé.`);
    } catch (e) { 
        log(`❌ [API] Erreur REMOVE : ${e.message}`);
        res.status(500).send(e.message); 
    }
});

// 4. CLEAR
app.get('/api/clear', async (req, res) => {
    log("🧹 [API] Vidage complet de la base de données...");
    try {
        const result = await ClientModel.deleteMany({});
        log(`✅ [API] Base vidée (${result.deletedCount} entrées)`);
        await broadcastToDashboard();
        res.send("Base de données vidée.");
    } catch (e) { 
        log(`❌ [API] Erreur CLEAR : ${e.message}`);
        res.status(500).send(e.message); 
    }
});

// 5. SEND TRADE
app.get('/api/sendtrade', (req, res) => {
    const { username, receiver } = req.query;
    log(`📤 [TRADE] Tentative d'envoi : ${username} -> ${receiver}`);

    if (!username || !receiver) {
        log("❌ [TRADE] Paramètres manquants");
        return res.send("Erreur: Manque username ou receiver");
    }

    const botWs = activeBots.get(username);
    if (botWs && botWs.readyState === WebSocket.OPEN) {
        botWs.send(JSON.stringify({
            Type: "TradeRequest",
            TargetUser: receiver
        }));
        log(`🚀 [TRADE] Ordre envoyé avec succès au bot ${username}`);
        res.send(`Ordre de trade envoyé de ${username} vers ${receiver}`);
    } else {
        log(`❌ [TRADE] Bot ${username} non connecté ou déconnecté`);
        res.send(`Erreur: Bot ${username} non connecté.`);
    }
});

// --- WEBSOCKETS ---
wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username || "Unknown";

    if (username === "dashboard") {
        activeDashboards.add(ws);
        log(`🖥️ [WS] Dashboard connecté (${activeDashboards.size} actifs)`);
    } else {
        activeBots.set(username, ws);
        log(`🤖 [WS] Bot connecté : ${username} (Total bots: ${activeBots.size})`);
    }

    // Mise à jour immédiate au dashboard
    await broadcastToDashboard();

    ws.on('message', async (msg) => {
        try {
            const payload = JSON.parse(msg);
            
            if (payload.Type === "Ping") {
                // Log de ping silencieux ou discret pour éviter de polluer
                return; 
            }

            if (payload.Method === "PlayerInfos") {
                log(`💾 [WS] Données reçues pour : ${payload.Data.DisplayName} (@${payload.Data.Name})`);
                await ClientModel.findOneAndUpdate(
                    { userId: payload.Data.UserId },
                    { ...payload.Data, updatedAt: new Date() },
                    { upsert: true, new: true }
                );
                await broadcastToDashboard();
            } else {
                log(`✉️ [WS] Message inconnu de ${username}: ${msg}`);
            }
        } catch (e) { 
            log(`⚠️ [WS] Erreur de parsing message de ${username}: ${e.message}`); 
        }
    });

    ws.on('close', () => {
        if (username === "dashboard") {
            activeDashboards.delete(ws);
            log(`🖥️ [WS] Dashboard déconnecté`);
        } else {
            activeBots.delete(username);
            log(`🤖 [WS] Bot déconnecté : ${username}`);
        }
        broadcastToDashboard();
    });

    ws.on('error', (err) => {
        log(`❌ [WS] Erreur sur la socket ${username}: ${err.message}`);
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("------------------------------------------");
    console.log(`🚀 SERVEUR M4GIX DÉMARRÉ SUR LE PORT ${PORT}`);
    console.log(`📡 WebSocket URL: wss://votre-url.render.com/`);
    console.log("------------------------------------------");
});
