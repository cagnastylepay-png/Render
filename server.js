const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connecté avec succès"))
  .catch(err => console.error("❌ Erreur de connexion MongoDB :", err));

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
    updatedAt: { type: Date, default: Date.now }
});
const Brainrot = mongoose.model('Brainrot', BrainrotSchema);

const serverOccupancy = new Map(); // jobId -> nombre de LocalPlayers
const socketToJob = new Map();    // socket -> jobId

// Fonction de diffusion sélective (Admin uniquement)
async function broadcastToAdmins() {
    const allData = await Brainrot.find().sort({ income: -1 });
    const payload = JSON.stringify({ type: 'REFRESH', data: allData });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAdmin === true) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const role = params.get('role');
    
    // Sécurité : on marque le socket s'il s'agit d'un admin
    ws.isAdmin = (role === 'Admin');

    console.log(`📡 Nouvelle connexion: ${role || 'Inconnu'}`);

    // Si c'est un Admin, on lui envoie les données directes à la connexion
    if (ws.isAdmin) {
        broadcastToAdmins();
    }

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            if (payload.Method === "ClientInfos") {
                const d = payload.Data;
                const jobId = d.Server.JobId;

                // Enregistrement du JobId pour ce socket
                if (!socketToJob.has(ws)) {
                    socketToJob.set(ws, jobId);
                    serverOccupancy.set(jobId, (serverOccupancy.get(jobId) || 0) + 1);
                }

                // Upsert unitaire pour chaque animal
                for (let a of d.Animals) {
                    const traitsKey = a.Traits ? a.Traits.join('-') : 'none';
                    // UID Renforcé pour éviter toute collision
                    const uid = `${d.Name}_${a.Name}_${a.Mutation}_${a.Income}_${traitsKey}`;

                    await Brainrot.findOneAndUpdate(
                        { uid },
                        {
                            uid,
                            ownerName: d.Name,
                            ownerDisplayName: d.DisplayName,
                            userType: d.UserType,
                            jobId: jobId,
                            name: a.Name,
                            income: a.Income,
                            incomeStr: a.IncomeStr,
                            rarity: a.Rarity,
                            mutation: a.Mutation,
                            traits: a.Traits,
                            accountAge: d.AccountAge,
                            updatedAt: new Date()
                        },
                        { upsert: true }
                    );
                }
                broadcastToAdmins();
            }
        } catch (e) {
            console.error("Erreur traitement message:", e);
        }
    });

    ws.on('close', async () => {
        const jobId = socketToJob.get(ws);
        if (jobId) {
            const count = (serverOccupancy.get(jobId) || 1) - 1;
            if (count <= 0) {
                // Plus aucun LocalPlayer sur ce JobId -> on nettoie
                await Brainrot.deleteMany({ jobId: jobId });
                serverOccupancy.delete(jobId);
                console.log(`🧹 Serveur ${jobId} vidé.`);
            } else {
                serverOccupancy.set(jobId, count);
            }
            socketToJob.delete(ws);
            broadcastToAdmins();
        }
    });
});

app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur M4GIX actif sur le port ${PORT}`));
