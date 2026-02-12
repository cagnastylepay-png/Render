const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connecté"))
  .catch(err => console.error("❌ Erreur MongoDB :", err));

// Schema
const BrainrotSchema = new mongoose.Schema({
    uid: { type: String, unique: true },
    ownerName: String,
    ownerDisplayName: String,
    ownerId: Number, 
    userType: String,
    jobId: String,
    name: String,
    income: Number,
    incomeStr: String,
    rarity: String,
    mutation: String,
    traits: Array,
    server: { 
        playerCount: Number, 
        maxPlayers: Number, 
        isPrivate: Boolean 
    },
    updatedAt: { type: Date, default: Date.now }
});

const Brainrot = mongoose.model('Brainrot', BrainrotSchema);

// Envoi aux Dashboards
async function broadcastToAdmins() {
    const allData = await Brainrot.find().sort({ income: -1 });
    const payload = JSON.stringify({ type: 'REFRESH', data: allData });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAdmin) {
            client.send(payload);
        }
    });
}

// Gestion WebSocket
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const isAdmin = (params.get('role') === 'Admin');
    const userName = params.get('user') || 'Inconnu';
    
    ws.isAdmin = isAdmin;

    if (isAdmin) {
        console.log(`🖥️  ADMIN CONNECTÉ : ${userName}`);
        broadcastToAdmins();
    }

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            
            if (payload.Method === "ClientInfos") {
                const d = payload.Data;

                // --- LOGS SPÉCIFIQUES POUR LOCALPLAYER ---
                if (d.UserType === "LocalPlayer") {
                    console.log(`[MY ACCOUNT] 👤 ${d.Name} (@${d.UserId}) | 📈 Revenu Total: ${d.Animals.reduce((acc, curr) => acc + curr.Income, 0)}/s | 📍 Job: ${d.Server.JobId}`);
                }

                for (let a of d.Animals) {
                    const uid = `${d.Name}_${a.Name}_${a.Mutation}_${a.Income}`;

                    await Brainrot.findOneAndUpdate(
                        { uid: uid },
                        {
                            uid,
                            ownerName: d.Name,
                            ownerDisplayName: d.DisplayName,
                            ownerId: d.UserId,
                            userType: d.UserType,
                            jobId: d.Server.JobId,
                            name: a.Name,
                            income: a.Income,
                            incomeStr: a.IncomeStr,
                            rarity: a.Rarity,
                            mutation: a.Mutation,
                            traits: a.Traits,
                            server: {
                                playerCount: d.Server.PlayerCount,
                                maxPlayers: d.Server.MaxPlayers,
                                isPrivate: d.Server.IsPrivate
                            },
                            updatedAt: new Date()
                        },
                        { upsert: true }
                    );
                }
                broadcastToAdmins();
            }
        } catch (e) {
            console.error("❌ Erreur traitement :", e);
        }
    });

    ws.on('close', () => {
        if (!ws.isAdmin) console.log(`🛰️  BOT DÉCONNECTÉ : ${userName}`);
    });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVEUR M4GIX PRÊT (Port ${PORT})`);
});
