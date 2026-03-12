const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- MONGODB ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ [DB] MongoDB Connecté"))
  .catch(err => console.error("❌ [DB] Erreur :", err));

const ClientModel = mongoose.model('Client', new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    brainrots: mongoose.Schema.Types.Mixed, 
    updatedAt: { type: Date, default: Date.now }
}, { strict: false }));

// --- GESTION CLIENTS ---
const activeBots = new Map();     
const activeDashboards = new Set(); 

async function broadcastToDashboard() {
    try {
        const allClients = await ClientModel.find({});
        const onlineBots = Array.from(activeBots.keys());
        const payload = JSON.stringify({ type: 'REFRESH', data: allClients, online: onlineBots });
        activeDashboards.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(payload); });
    } catch (e) { console.error(e); }
}

// --- ROUTES API (TOUT EN GET) ---

// 1. PING : Garder le serveur éveillé
app.get('/ping', (req, res) => res.send("Pong !"));

// 2. GET : Récupérer les données d'un joueur
app.get('/api/get', async (req, res) => {
    const { username } = req.query;
    try {
        const data = await ClientModel.findOne({ name: username });
        res.json(data || { error: "Non trouvé" });
    } catch (e) { res.status(500).send(e.message); }
});

// 3. REMOVE : Supprimer un joueur
app.get('/api/remove', async (req, res) => {
    const { username } = req.query;
    try {
        await ClientModel.deleteOne({ name: username });
        await broadcastToDashboard();
        res.send(`Joueur ${username} supprimé.`);
    } catch (e) { res.status(500).send(e.message); }
});

// 4. CLEAR : Vider la DB
app.get('/api/clear', async (req, res) => {
    try {
        await ClientModel.deleteMany({});
        await broadcastToDashboard();
        res.send("Base de données vidée.");
    } catch (e) { res.status(500).send(e.message); }
});

// 5. SEND TRADE : Envoyer l'ordre de trade (Relais WS)
// Usage: /api/sendtrade?username=NOM_DU_BOT&receiver=NOM_CIBLE
app.get('/api/sendtrade', (req, res) => {
    const { username, receiver } = req.query;
    if (!username || !receiver) return res.send("Erreur: Manque username ou receiver");

    const botWs = activeBots.get(username);
    if (botWs && botWs.readyState === WebSocket.OPEN) {
        botWs.send(JSON.stringify({
            Type: "TradeRequest",
            TargetUser: receiver
        }));
        res.send(`Ordre de trade envoyé de ${username} vers ${receiver}`);
    } else {
        res.send(`Erreur: Bot ${username} non connecté.`);
    }
});

// --- WEBSOCKETS ---
wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username;

    if (username === "dashboard") activeDashboards.add(ws);
    else if (username) activeBots.set(username, ws);

    if (username === "dashboard") await broadcastToDashboard();

    ws.on('message', async (msg) => {
        try {
            const payload = JSON.parse(msg);
            if (payload.Method === "PlayerInfos") {
                await ClientModel.findOneAndUpdate(
                    { userId: payload.Data.UserId },
                    { ...payload.Data, updatedAt: new Date() },
                    { upsert: true }
                );
                await broadcastToDashboard();
            }
        } catch (e) { console.log("WS Error"); }
    });

    ws.on('close', () => {
        if (username === "dashboard") activeDashboards.delete(ws);
        else if (username) activeBots.delete(username);
        broadcastToDashboard();
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 API M4GIX ON PORT ${PORT}`));
