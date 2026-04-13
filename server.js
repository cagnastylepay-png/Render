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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

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

app.use(express.static('public'));

server.listen(PORT, () => log(`🚀 Serveur actif sur le port ${PORT}`));
