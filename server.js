const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const API_TOKEN = "M4GIX_SECURE_2026"; // TA CLÉ

const clients = new Map();

const server = http.createServer((req, res) => {
    res.end("Relais M4GIX Operationnel");
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token !== API_TOKEN) {
        ws.terminate();
        return;
    }

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);

            if (msg.To === "Server") {
                if (msg.Method === "Identify") {
                    ws.clientName = msg.From;
                    clients.set(msg.From, ws);
                
                    // On informe ton PC qu'un client s'est connecté
                    broadcast({
                        Method: "OnClientConnected",
                        From: "Server",
                        To: "All",
                        Data: { Client: msg.From }
                    });
                }
                else if (msg.Method === "GetServerClients") {
                    const currentClients = Array.from(clients.keys());
                    ws.send(JSON.stringify({
                        Method: "OnServerClientsReceived",
                        From: "Server",
                        To: msg.From,
                        Data: { Clients: currentClients }
                    }));
                    console.log(`[INFO] Liste des clients envoyée à ${msg.From}`);
                }
            } 
            else if (msg.To === "All") {
                // On envoie à tous les clients connectés sauf celui qui parle
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(message.toString());
                    }
                });
                console.log(`[Broadcast] Message de ${msg.From} envoyé à tout le monde.`);
            } 
            else {
                // Envoi ciblé (Private Message)
                const targetWs = clients.get(msg.To);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(message.toString());
                }
            }
        } 
        catch (e) {
            console.error("Erreur parsing JSON:", e);
        }
    });

    ws.on('close', () => {
        if (ws.clientName) {
            const name = ws.clientName;
            clients.delete(name);
            
            // On informe ton PC qu'un client est parti
            broadcast({
                Method: "OnClientDisconnected",
                From: "Server",
                To: "All",
                Data: { Client: name }
            });
        }
    });
});

function broadcast(data, skipWs) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== skipWs && client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}
server.listen(PORT, () => {
    console.log(`🚀 Relais actif sur le port ${PORT}`);
});
