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

// Fonction de Broadcast
async function broadcastToAdmins() {
    try {
        const allClients = await ClientModel.find().sort({ updatedAt: -1 });
        const payload = JSON.stringify({ type: 'REFRESH', data: allClients });
        let adminCount = 0;

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.isAdmin) {
                client.send(payload);
                adminCount++;
            }
        });
        if (adminCount > 0) console.log(`📢 [BROADCAST] Données envoyées à ${adminCount} admin(s)`);
    } catch (e) { console.error("❌ [BROADCAST] Erreur :", e); }
}

async function updateStatus(userName, status) {
    if (!userName || userName === 'Inconnu') return;
    await ClientModel.updateOne({ name: userName }, { isConnected: status });
    console.log(`📡 [STATUT] ${userName} est maintenant ${status ? "EN LIGNE" : "HORS LIGNE"}`);
    broadcastToAdmins();
}

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const role = params.get('role');
    const userName = params.get('user') || 'Inconnu';
    
    ws.isAdmin = (role === 'Admin');
    ws.userName = userName;
    ws.isAlive = true;

    console.log(`\n✨ [NEW_CONN] ${ws.isAdmin ? "🚩 ADMIN" : "👤 CLIENT"} : ${userName}`);

    if (ws.isAdmin) {
        broadcastToAdmins();
    } else {
        updateStatus(userName, true);
    }

    ws.on('message', async (message) => {
        ws.isAlive = true; // Signal de vie reçu

        try {
            const payload = JSON.parse(message);
            if (payload.Method === "ClientInfos") {
                const d = payload.Data;

                // Calcul rapide pour le log
                const totalIncome = d.Animals.reduce((acc, a) => acc + (a.Income || 0), 0);
                
                console.log(`📥 [DATA] Reçu de ${d.Name} | Pets: ${d.Animals.length} | Total: ${totalIncome.toLocaleString()}/s`);

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
        } catch (e) { 
            console.error(`⚠️ [MESSAGE_ERR] Erreur de parsing de ${ws.userName}:`, e.message); 
        }
    });

    ws.on('close', () => {
        console.log(`🔌 [DISCONNECT] ${ws.userName} a fermé la connexion.`);
        if (!ws.isAdmin) {
            updateStatus(ws.userName, false);
        }
    });

    ws.on('error', (err) => {
        console.error(`💥 [SOCKET_ERR] Erreur sur le socket de ${ws.userName}:`, err);
    });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
=========================================
🚀 SERVEUR M4GIX DÉMARRÉ SUR LE PORT ${PORT}
📅 Date : ${new Date().toLocaleString()}
🛡️ Mode : Zéro Filtrage / Surveillance Passive
=========================================
    `);
});
