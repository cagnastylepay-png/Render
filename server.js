const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// On garde une trace des clients connectés par leur nom
let connectedClients = new Map();

wss.on('connection', (ws, req) => {
    // Récupération du nom du bot via l'URL (?user=NomDuBot)
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const userName = urlParams.get('user') || "Unknown_Bot";

    ws.userName = userName;
    connectedClients.set(userName, ws);

    console.log(`[CONNECTÉ] Bot : ${userName} | Total en ligne : ${connectedClients.size}`);

    ws.on('message', (message) => {
        try {
            const payload = JSON.parse(message);
            const { Method, Data } = payload;

            // Le serveur ne fait que "écouter" et afficher les données reçues
            if (Method === "OnBrainrotSpawn") {
                console.log(`--- [NOUVEAU SPAWN] ---`);
                console.log(`Bot: ${userName}`);
                console.log(`ID: ${Data.Id}`);
                console.log(`Animal: ${Data.Name}`);
                console.log(`Revenu: ${Data.IncomeStr}`);
                console.log(`Rarete: ${Data.Rarity}`);
                console.log(`Serveur: ${Data.JobId}`);
                console.log(`-----------------------`);
            } 
            
            else if (Method === "OnAnimalPurchased") {
                console.log(`[ACHAT] ID ${Data.Id} a été acheté par ${Data.Buyer} (${userName})`);
            } 
            
            else if (Method === "OnBrainrotDespawn") {
                console.log(`[DESPAWN] ID ${Data.Id} n'est plus disponible.`);
            }

        } catch (err) {
            // Optionnel : logger l'erreur si le message n'est pas du JSON valide
            console.error(`[ERREUR JSON] provenant de ${userName}`);
        }
    });

    ws.on('close', () => {
        connectedClients.delete(userName);
        console.log(`[DÉCONNECTÉ] Bot : ${userName} | Restants : ${connectedClients.size}`);
    });
});

server.listen(PORT, () => {
    console.log(`🛰️ Serveur de réception M4GIX démarré sur le port ${PORT}`);
    console.log(`En attente de données en provenance de Roblox...`);
});
