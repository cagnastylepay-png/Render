const http = require('http');
const WebSocket = require('ws');
const url = require('url');

// Récupération du port via variable d'environnement (indispensable pour Render)
const PORT = process.env.PORT || 3000;

// 1. Création du serveur HTTP
const server = http.createServer((req, res) => {
    console.log(`[HTTP] Requête reçue : ${req.method} ${req.url}`);
    
    // Réponse toujours OK
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});

// 2. Création du serveur WebSocket attaché au serveur HTTP
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Extraction des paramètres de l'URL (ex: ?user=clientusername)
    const parameters = url.parse(req.url, true).query;
    const username = parameters.user || 'Anonyme';

    console.log(`[WS] Nouvelle connexion : ${username} (URL: ${req.url})`);

    ws.on('message', (message) => {
        // Le message arrive souvent sous forme de Buffer
        console.log(`[WS] Message reçu de ${username} : ${message}`);
    });

    ws.on('close', () => {
        console.log(`[WS] Déconnexion de ${username}`);
    });
    
});

// 3. Lancement du serveur
server.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});
