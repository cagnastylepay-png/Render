const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ [DB] MongoDB Connecté avec succès"))
  .catch(err => console.error("❌ [DB] Erreur de connexion :", err));

const ClientSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    jobId: String,
    server: mongoose.Schema.Types.Mixed,
    animals: mongoose.Schema.Types.Mixed, 
    isConnected: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const ClientModel = mongoose.model('Client', ClientSchema);

// Fonction de Broadcast (Optimisée avec .lean() pour la RAM)
async function broadcastToAdmins() {
    try {
        const allClients = await ClientModel.find()
            .select('name displayName userId server animals isConnected updatedAt')
            .sort({ updatedAt: -1 })
            .limit(100)
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

    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n[${timestamp}] ✨ NEW_CONN: ${ws.isAdmin ? "🚩 ADMIN" : "👤 CLIENT"} | ${userName}`);

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
                const isPrivate = d.Server.PrivateServerId !== "" && d.Server.PrivateServerId !== "0";

                console.log(`[${new Date().toLocaleTimeString()}] 📥 DATA: ${d.Name} | Private: ${isPrivate}`);

                await ClientModel.findOneAndUpdate(
                    { userId: d.UserId },
                    {
                        name: d.Name,
                        displayName: d.DisplayName,
                        accountAge: d.AccountAge,
                        jobId: d.Server.JobId,
                        server: d.Server,
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
                console.log(`[${new Date().toLocaleTimeString()}] 🕹️ COMMAND: ${method} -> ${target}`);

                let targetFound = false;
                wss.clients.forEach(client => {
                    if (!client.isAdmin && client.userName === target && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ Method: method, Data: data }));
                        targetFound = true;
                    }
                });
                if (!targetFound) console.warn(`   ⚠️ Target ${target} non trouvé.`);
            }
        } catch (e) { 
            console.error(`⚠️ [ERR] de ${ws.userName}:`, e.message); 
        }
    });

    ws.on('close', () => {
        console.log(`[${new Date().toLocaleTimeString()}] 🔌 DISCONNECT: ${ws.userName}`);
        if (!ws.isAdmin) updateStatus(ws.userName, false);
    });

    ws.on('error', (err) => {
        console.error(`💥 [SOCKET_ERR]:`, err.message);
    });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVEUR M4GIX PRÊT SUR LE PORT ${PORT}`);
});
