const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const API_TOKEN = "M4GIX_SECURE_2026"; 

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
                    ws.playerName = msg.From;
                    clients.set(msg.From, ws);
                
                    console.log(`[AUTH] ${msg.From} identifié.`);

                    broadcast({
                        Method: "OnClientConnected",
                        From: "Server",
                        To: "All", // Virgule corrigée ici
                        Data: { Player: msg.From }
                    });
                }
            } 
            else if (msg.To === "All") {
                broadcast(message.toString(), ws);
                console.log(`[Broadcast] Message de ${msg.From} envoyé à tous.`);
            } 
            else {
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
        if (ws.playerName) {
            const name = ws.playerName;
            clients.delete(name);
            
            broadcast({
                Method: "OnClientDisconnected",
                From: "Server",
                To: "All",
                Data: { Player: name }
            });
            console.log(`[QUIT] ${name} a quitté.`);
        }
    });
});

// Helper pour simplifier le code
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
