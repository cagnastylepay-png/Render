const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/brainrot")
  .then(() => console.log("✅ [DB] MongoDB Connecté"))
  .catch(err => console.error("❌ [DB] Erreur MongoDB :", err));

// --- SCHEMAS ---

// Clients (Bots)
const ClientSchema = new mongoose.Schema({
    userId: { type: Number, unique: true },
    name: String,
    displayName: String,
    accountAge: Number,
    jobId: String,
    parameters: mongoose.Schema.Types.Mixed,
    isConnected: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

// Servers (Scanning global)
const ServerSchema = new mongoose.Schema({
    jobId: { type: String, unique: true },
    privateServerId: String,       // Ajouté
    privateServerOwnerId: Number, // Ajouté
    scriptUser: String,
    playerCount: Number,
    maxPlayers: Number,
    brainrots: Array,
    updatedAt: { type: Date, default: Date.now }
});

const ClientModel = mongoose.model('Client', ClientSchema);
const ServerModel = mongoose.model('Server', ServerSchema);

// --- LOGIQUE DE NETTOYAGE ---

// Supprime les serveurs qui n'ont pas été mis à jour depuis 30 minutes
async function autoCleanServers() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const result = await ServerModel.deleteMany({ updatedAt: { $lt: thirtyMinutesAgo } });
    if (result.deletedCount > 0) {
        console.log(`🧹 [CLEAN] ${result.deletedCount} serveurs inactifs supprimés.`);
        broadcastToAdmins();
    }
}
setInterval(autoCleanServers, 5 * 60 * 1000); // Check toutes les 5 min

// --- COMMUNICATION ---

async function broadcastToAdmins() {
    try {
        const [clients, activeServers] = await Promise.all([
            ClientModel.find().lean(),
            ServerModel.find().sort({ updatedAt: -1 }).limit(20).lean()
        ]);

        const payload = JSON.stringify({ 
            type: 'REFRESH', 
            data: { clients, servers: activeServers } 
        });
        
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.isAdmin) {
                client.send(payload);
            }
        });
    } catch (e) { console.error("❌ [BROADCAST] Erreur :", e); }
}

async function updateClientStatus(userName, status) {
    if (!userName || userName === 'Inconnu') return;
    await ClientModel.updateOne({ name: userName }, { isConnected: status, updatedAt: new Date() });
    broadcastToAdmins();
}

// --- WEBSOCKET ENGINE ---

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const role = params.get('role');
    const userName = params.get('user') || 'Inconnu';
    
    ws.isAdmin = (role === 'Admin');
    ws.userName = userName;

    console.log(`✨ [CONN]: ${ws.isAdmin ? "🚩 ADMIN" : "👤 BOT"} | ${userName}`);

    if (!ws.isAdmin) updateClientStatus(userName, true);

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);

            // 1. Réception des infos du BOT
            if (payload.Method === "ClientInfos") {
                const d = payload.Data;
                await ClientModel.findOneAndUpdate(
                    { userId: d.UserId },
                    {
                        name: d.Name,
                        displayName: d.DisplayName,
                        accountAge: d.AccountAge,
                        parameters: d.Parameters,
                        isConnected: true,
                        updatedAt: new Date()
                    },
                    { upsert: true }
                );
                broadcastToAdmins();
            }

            // 2. Réception des infos du SERVEUR (Animaux riches)
            if (payload.Method === "ServerInfos") {
              const s = payload.Data;
              await ServerModel.findOneAndUpdate(
                  { jobId: s.JobId },
                  {
                      privateServerId: s.PrivateServerId,
                      privateServerOwnerId: s.PrivateServerOwnerId,
                      scriptUser: s.ScriptUser,
                      playerCount: s.PlayerCount,
                      maxPlayers: s.MaxPlayers,
                      brainrots: s.Brainrots,
                      updatedAt: new Date()
                  },
                  { upsert: true }
              );
              broadcastToAdmins();
          }

            // 3. Commandes Administrateur
            if (payload.type === "COMMAND") {
                const { target, method, data } = payload;
                wss.clients.forEach(client => {
                    if (client.userName === target && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ Method: method, Data: data }));
                    }
                });
            }
        } catch (e) { console.error(`⚠️ [ERR] de ${ws.userName}:`, e.message); }
    });

    ws.on('close', () => {
        console.log(`🔌 [DISCONNECT]: ${ws.userName}`);
        if (!ws.isAdmin) updateClientStatus(ws.userName, false);
    });
});

// --- ROUTES API ---

app.use(express.static('public'));

app.post('/api/clear-database', async (req, res) => {
    await Promise.all([ClientModel.deleteMany({}), ServerModel.deleteMany({})]);
    broadcastToAdmins();
    res.json({ message: "Database cleared" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 M4GIX API ON PORT ${PORT}`));
