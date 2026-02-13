const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ [DB] MongoDB Connecté"))
  .catch(err => console.error("❌ [DB] Erreur :", err));

const ClientSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    jobId: String,
    server: mongoose.Schema.Types.Mixed, // Contiendra PrivateServerId et PrivateServerOwnerId
    animals: mongoose.Schema.Types.Mixed, 
    isConnected: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const ClientModel = mongoose.model('Client', ClientSchema);

// OPTIMISÉ : Récupère uniquement le nécessaire et utilise .lean() pour économiser la RAM
async function broadcastToAdmins() {
    try {
        const allClients = await ClientModel.find()
            .select('name displayName userId server animals isConnected updatedAt')
            .sort({ updatedAt: -1 })
            .limit(500) // N'affiche que les 50 derniers mis à jour pour protéger la RAM
            .lean(); 

        const payload = JSON.stringify({ type: 'REFRESH', data: allClients });
        
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.isAdmin) {
                client.send(payload);
            }
        });
    } catch (e) { console.error("❌ [BROADCAST] Erreur :", e); }
}

async function updateStatus(userName, status) {
    if (!userName || userName === 'Inconnu') return;
    await ClientModel.updateOne({ name: userName }, { isConnected: status });
    broadcastToAdmins();
}

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const role = params.get('role');
    const userName = params.get('user') || 'Inconnu';
    
    ws.isAdmin = (role === 'Admin');
    ws.userName = userName;

    if (ws.isAdmin) {
        broadcastToAdmins();
    } else {
        updateStatus(userName, true);
    }

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);

            if (payload.Method === "ClientInfos") {
                const d = payload.Data;
                await ClientModel.findOneAndUpdate(
                    { userId: d.UserId },
                    {
                        name: d.Name,
                        displayName: d.DisplayName,
                        accountAge: d.AccountAge,
                        jobId: d.Server.JobId,
                        server: d.Server, // Inclus désormais PrivateServerId et OwnerId
                        animals: d.Animals,
                        isConnected: true,
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
                broadcastToAdmins();
            }

            if (payload.type === "COMMAND") {
                const { target, method, data } = payload;
                wss.clients.forEach(client => {
                    if (!client.isAdmin && client.userName === target && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ Method: method, Data: data }));
                    }
                });
            }
        } catch (e) { console.error(`⚠️ [ERR] de ${ws.userName}:`, e.message); }
    });

    ws.on('close', () => {
        if (!ws.isAdmin) updateStatus(ws.userName, false);
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SERVEUR PRÊT SUR ${PORT}`));
