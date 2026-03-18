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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // Ta variable Render

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

mongoose.connect(MONGO_URI)
  .then(() => log("✅ [DB] Connexion établie"))
  .catch(err => log(`❌ [DB] ERREUR : ${err}`));

// --- MODÈLES ---
const scriptSchema = new mongoose.Schema({
    title: String,
    image: String,
    description: String,
    code: String,
    verified: { type: Boolean, default: false },
    views: { type: Number, default: 0 }
});
const Script = mongoose.model('Script', scriptSchema);

const logSchema = new mongoose.Schema({
    username: String,      // Nom du bot
    type: String,          // Info, Error, Success, Trade
    message: String,       // Le contenu du log
    timestamp: { type: Date, default: Date.now } // Date automatique
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

// --- ROUTES API SCRIPTS ---
// Route simple pour vérifier le token depuis le front
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

// Admin : Effacer tous les logs
app.get('/api/logs/clear', authAdmin, async (req, res) => {
    try {
        await BotLog.deleteMany({});
        res.send("🗑️ Tous les logs ont été effacés.");
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/scripts', async (req, res) => {
    try {
        const scripts = await Script.find();
        res.json(scripts);
    } catch (e) { res.status(500).send(e.message); }
});

// Public : Incrémenter les vues
app.get('/api/script/view', async (req, res) => {
    const { id } = req.query;
    if (id) await Script.findByIdAndUpdate(id, { $inc: { views: 1 } });
    res.sendStatus(200);
});

// Admin : Ajouter
app.get('/api/script/add', authAdmin, async (req, res) => {
    const { title, image, description, code, verified } = req.query;
    try {
        const newScript = new Script({ 
            title, image, description, code, 
            verified: verified === 'true' 
        });
        await newScript.save();
        res.send("✅ Script ajouté !");
    } catch (e) { res.status(500).send(e.message); }
});

// Admin : Supprimer
app.get('/api/script/remove', authAdmin, async (req, res) => {
    try {
        await Script.findByIdAndDelete(req.query.id);
        res.send("🗑️ Script supprimé !");
    } catch (e) { res.status(500).send(e.message); }
});

// Admin : Modifier
app.get('/api/script/modify', authAdmin, async (req, res) => {
    const { id, title, image, description, code, verified } = req.query;
    try {
        await Script.findByIdAndUpdate(id, { 
            title, image, description, code, 
            verified: verified === 'true' 
        });
        res.send("🔄 Script mis à jour !");
    } catch (e) { res.status(500).send(e.message); }
});

// --- GESTION DES BOTS (EXISTANT) ---

app.get('/ping', (req, res) => res.send("Pong !"));

app.get('/api/sendtrade', (req, res) => {
    const { receiver, target } = req.query;
    const botWs = activeBots.get(receiver);
    if (botWs && botWs.readyState === WebSocket.OPEN) {
        botWs.send(JSON.stringify({ Type: "TradeRequest", TargetUser: target }));
        res.send(`Ordre envoyé à ${receiver}`);
        log(`Ordre envoyé à ${receiver}`);
    } else {
        res.send(`Bot ${receiver} hors ligne.`);
    }
});

wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username || "Unknown";
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
                log(`[LOG DE BOT] ${username}: ${payload.Message}`);
            }
        } catch (e) { log(`⚠️ Erreur WS: ${e.message}`); }
    });

    ws.on('close', () => {
        activeBots.delete(username);
        log(`💀 Bot déconnecté : ${username}`);
    });
});

// --- LANCEMENT ---
app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
