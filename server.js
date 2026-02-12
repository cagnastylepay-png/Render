const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connecté"))
  .catch(err => console.error("❌ Erreur MongoDB :", err));

const BrainrotSchema = new mongoose.Schema({
    uid: { type: String, unique: true },
    ownerName: String,
    ownerDisplayName: String,
    ownerId: Number, // Stockage du UserId numérique
    userType: String,
    jobId: String,
    name: String,
    income: Number,
    incomeStr: String,
    rarity: String,
    mutation: String,
    traits: Array,
    server: { playerCount: Number, maxPlayers: Number, isPrivate: Boolean },
    updatedAt: { type: Date, default: Date.now }
});
const Brainrot = mongoose.model('Brainrot', BrainrotSchema);

async function broadcastToAdmins() {
    const allData = await Brainrot.find().sort({ income: -1 });
    const payload = JSON.stringify({ type: 'REFRESH', data: allData });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAdmin) client.send(payload);
    });
}

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    ws.isAdmin = (params.get('role') === 'Admin');
    if (ws.isAdmin) broadcastToAdmins();

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            if (payload.Method === "ClientInfos") {
                const d = payload.Data;
                console.log(`📥 Update: ${d.Name} (${d.UserId}) | ${d.Animals.length} pets`);

                for (let a of d.Animals) {
                    const uid = `${d.Name}_${a.Name}_${a.Mutation}_${a.Income}`;
                    await Brainrot.findOneAndUpdate(
                        { uid },
                        {
                            uid, ownerName: d.Name, ownerDisplayName: d.DisplayName,
                            ownerId: d.UserId, userType: d.UserType, jobId: d.Server.JobId,
                            name: a.Name, income: a.Income, incomeStr: a.IncomeStr,
                            rarity: a.Rarity, mutation: a.Mutation, traits: a.Traits,
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
        } catch (e) { console.error("Erreur réception:", e); }
    });
});


app.use(express.static('public'));
server.listen(process.env.PORT || 3000);
