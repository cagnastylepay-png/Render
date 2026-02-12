const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connecté"))
  .catch(err => console.error("❌ Erreur MongoDB :", err));

const BrainrotSchema = new mongoose.Schema({
    uid: { type: String, unique: true },
    ownerName: String,
    ownerDisplayName: String,
    userType: String,
    jobId: String,
    name: String,
    income: Number,
    incomeStr: String,
    rarity: String,
    mutation: String,
    traits: Array,
    accountAge: Number,
    server: {
        playerCount: Number,
        maxPlayers: Number,
        isPrivate: Boolean
    },
    updatedAt: { type: Date, default: Date.now }
});
const Brainrot = mongoose.model('Brainrot', BrainrotSchema);

const serverOccupancy = new Map();
const socketToJob = new Map();

async function broadcastToAdmins() {
    try {
        const allData = await Brainrot.find().sort({ income: -1 });
        const payload = JSON.stringify({ type: 'REFRESH', data: allData });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.isAdmin) client.send(payload);
        });
    } catch (e) { console.error(e); }
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
                const jobId = d.Server.JobId; // Lecture directe du JobId envoyé par Lua

                if (!socketToJob.has(ws)) {
                    socketToJob.set(ws, jobId);
                    serverOccupancy.set(jobId, (serverOccupancy.get(jobId) || 0) + 1);
                }

                for (let a of d.Animals) {
                    const traitsKey = a.Traits ? a.Traits.sort().join('-') : 'none';
                    const uid = `${d.Name}_${a.Name}_${a.Mutation}_${a.Income}_${traitsKey}`;

                    await Brainrot.findOneAndUpdate(
                        { uid },
                        {
                            uid, ownerName: d.Name, ownerDisplayName: d.DisplayName,
                            userType: d.UserType, jobId: jobId, name: a.Name,
                            income: a.Income, incomeStr: a.IncomeStr, rarity: a.Rarity,
                            mutation: a.Mutation, traits: a.Traits, accountAge: d.AccountAge,
                            server: {
                                playerCount: d.Server.PlayerCount, // Mapping vers Lua
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
        } catch (e) { console.error("Erreur message:", e); }
    });

    ws.on('close', async () => {
        const jobId = socketToJob.get(ws);
        if (jobId) {
            const count = (serverOccupancy.get(jobId) || 1) - 1;
            if (count <= 0) {
                await Brainrot.deleteMany({ jobId: jobId });
                serverOccupancy.delete(jobId);
            } else { serverOccupancy.set(jobId, count); }
            socketToJob.delete(ws);
            broadcastToAdmins();
        }
    });
});

app.use(express.static('public'));
server.listen(process.env.PORT || 3000);
