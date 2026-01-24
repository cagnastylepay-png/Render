const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const API_TOKEN = "M4GIX_SECURE_2026"; // TA CLÉ

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
        const data = message.toString();
        // Relais : on renvoie à tout le monde sauf à l'expéditeur
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Relais actif sur le port ${PORT}`);
});
