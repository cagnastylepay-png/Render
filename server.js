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

    wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const role = params.get('role');
    const userName = params.get('user') || 'Inconnu';
    
    ws.isAdmin = (role === 'Admin');
    ws.userName = userName;

    // Log de connexion initiale
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n[${timestamp}] ✨ NEW_CONNECTION: ${ws.isAdmin ? "🚩 ADMIN" : "👤 CLIENT"} | User: ${userName}`);

    if (ws.isAdmin) {
        broadcastToAdmins();
    } else {
        updateStatus(userName, true);
    }

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);

            // --- LOGIQUE : RÉCEPTION DES DONNÉES DU BOT ---
            if (payload.Method === "ClientInfos") {
                const d = payload.Data;
                
                // Calcul rapide pour le log
                const animalCount = d.Animals ? d.Animals.length : 0;
                const isPrivate = d.Server.PrivateServerId !== "" && d.Server.PrivateServerId !== "0";

                console.log(`[${new Date().toLocaleTimeString()}] 📥 DATA from ${d.Name} | Pets: ${animalCount} | Type: ${isPrivate ? 'PRIVATE' : 'PUBLIC'}`);

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

            // --- LOGIQUE : RELAIS DES COMMANDES ---
            if (payload.type === "COMMAND") {
                const { target, method, data } = payload;
                console.log(`[${new Date().toLocaleTimeString()}] 🕹️ COMMAND RELAY: ${method} -> ${target}`);

                let targetFound = false;
                wss.clients.forEach(client => {
                    if (!client.isAdmin && client.userName === target && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ Method: method, Data: data }));
                        targetFound = true;
                    }
                });

                if (targetFound) {
                    console.log(`   ✅ Success: Message sent to ${target}`);
                } else {
                    console.warn(`   ⚠️ Warning: Target ${target} not found or socket closed.`);
                }
            }

        } catch (e) { 
            console.error(`[${new Date().toLocaleTimeString()}] ❌ MESSAGE_ERR from ${ws.userName}:`, e.message); 
        }
    });

    ws.on('close', () => {
        console.log(`[${new Date().toLocaleTimeString()}] 🔌 DISCONNECTED: ${ws.userName}`);
        if (!ws.isAdmin) updateStatus(ws.userName, false);
    });

    ws.on('error', (err) => {
        console.error(`[${new Date().toLocaleTimeString()}] 💥 SOCKET_ERR (${ws.userName}):`, err.message);
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SERVEUR PRÊT SUR ${PORT}`));
