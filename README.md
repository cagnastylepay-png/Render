# M4GIX-WS / AutoSAE

Service d'observations Divine / Eternal / Secret, sans commande distante ni bouton GO actif.

## Démarrer

npm ci
npm test
npm start

Node >=22. PORT fourni par Render, sinon 3000 ; écoute 0.0.0.0.
GET / affiche Eggs. GET /health indique build=eggs-ws-v1 et reporting=ready.
WebSocket : wss://m4gix-ws.onrender.com/sae/ws.

## Tests avec Test.lua

Lancer la dernière version de cagnastylepay-png/Sae/Test.lua dans Delta.
Le client utilise WebSocket.connect, ou syn.websocket.connect si disponible.
Il publie après connexion, après reset et révélation du nouveau cycle, après modification
des œufs et toutes les 60 secondes. Les trois raretés sont envoyées sans minimum de revenu.
Reconnexion avec délai progressif ; un seul socket par session ; arrêt au remplacement du script.
Logs [REPORT] dans la console et AutoSAE_debug.txt : connexion, snapshot et accusé serveur.

## Accès

Par défaut, sans variables de clés, le service est en mode de test anonyme : observation publique
et réception de snapshots non autoritaires. Le protocole ne contient aucune commande d'exécution.
Pour restreindre l'envoi : définir SAE_REPORT_TOKEN dans les variables Render.
Pour restreindre la lecture : définir SAE_VIEW_TOKEN.
Le token reporter se fournit en mémoire avant le lanceur :
shared.__AutoSAEReportingOptions = {Token="VALEUR_PRIVEE"}
Il ne doit pas être committé ni copié dans les logs.
Le token viewer se renseigne dans le champ Clé de lecture du dashboard.
Si la recherche change de serveur, l'option Token en mémoire doit être réinjectée par le lanceur
pour continuer à utiliser un serveur protégé. Aucun secret n'est ajouté au dépôt.

## Stockage et limites

Mémoire volatile, effacée au redémarrage Render. Snapshot complet par serveur/cycle,
révisions séparées par session, UID dédupliqués ; snapshot vide supprime les anciennes lignes.
100 serveurs au maximum, 200 œufs par snapshot, expiration après 10 minutes sans observation.
JSON texte <=256 KiB, 20 messages/10 secondes/connexion, ping/pong et fermeture des clients lents.
Les observations restent identifiées par serveur et cycle ; elles ne prouvent pas la propriété.
GO reste désactivé.
