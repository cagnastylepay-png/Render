# M4GIX-WS / AutoSAE

Nouvelle base Node, remplaçant l'ancienne application. L'historique Git permet de retrouver l'ancien code.
Étape actuelle : architecture et fichiers, sans collecte WebSocket active.

## Démarrage

npm start
PORT fourni par Render, sinon 3000. Écoute sur 0.0.0.0.
GET /health renvoie le statut du serveur. GET / affiche l'ébauche Eggs.
Le bouton GO est désactivé ; aucune commande distante n'est enregistrée.

## Structure

- server.js : entrée HTTP et fichiers publics.
- src/index.js : point de montage futur de l'extension.
- src/ws/EggGateway.js : futur /sae/ws, validation, connexion des modules.
- src/store/EggStore.js : stockage des observations par serveur/cycle/session.
- public/index.html : futur onglet Eggs.
- protocol/eggs.snapshot.example.json : exemple fictif.
- docs/Integration.md : étapes suivantes.

Client Roblox : https://github.com/cagnastylepay-png/Sae/tree/main/modular
Hôte fourni : https://m4gix-ws.onrender.com
Futur WebSocket : wss://m4gix-ws.onrender.com/sae/ws (pas encore disponible).

Sans dépendance externe à cette étape. /sae/ws et les contrôles d'accès seront implémentés
avant activation du reporting. Aucun secret dans le dépôt public.
