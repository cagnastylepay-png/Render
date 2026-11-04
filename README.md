# M4GIX-WS / AutoSAE

## Fonctionnalités

- Eggs : cartes Divine, Eternal, Secret et Cosmic, images locales, poids, revenu/s,
  valeur de vente, position, état, mutations et détails complets.
- UID composé construit côté serveur : jobId/eggUid, avec clé interne placeId/jobId/eggUid.
- Sous chaque carte : joueurs de ce serveur ; vert = connexion du client du script,
  gris = joueur observé. L'onglet Players récapitule vitesse, puissance et revenu.
- Notifications et historique daté des apparitions, disparitions et changements.
- Timer global sur le prochain créneau de 5 minutes ; expiration individuelle issue
  de l'horaire du jeu quand fourni, sinon prochain créneau. Expiration retire les observations actives.
- GO reste désactivé. Aucune commande distante n'est implémentée.

## Démarrage

npm ci
npm test
npm start

Node >=22. PORT est fourni par Render, sinon 3000 ; écoute sur 0.0.0.0.
GET /, /eggs : dashboard. GET /health : build eggs-players-v2.
WebSocket : wss://m4gix-ws.onrender.com/sae/ws.

## Historique MongoDB Atlas

Dans les variables Render, définir MONGODB_URI avec la chaîne complète privée et MONGODB_DB=autosae.
Aucun identifiant n'est enregistré dans ce dépôt. Autoriser les connexions du service Render dans
les règles réseau Atlas. Le serveur ouvre la collection egg_history et recharge les dernières entrées.
Les écritures sont dédupliquées par ID ; les pannes reconnectent en conservant une file mémoire.
L'interface indique MongoDB actif ou en attente. Historique borné à 10 000 entrées ; 2 000 affichées.

Sans URI, repli sur data/egg-history.json ou SAE_DATA_DIR/egg-history.json.
Sur Render sans disque persistant, les fichiers locaux ne survivent pas aux redéploiements :
MongoDB est donc le stockage durable prévu. Le branchement Atlas réel nécessite la variable privée ;
les tests utilisent un adaptateur simulé, pas un identifiant réel.

## Clients Roblox

Relancer la dernière version de Sae/Test.lua : Build reporting-v2.
Une connexion partagée en lecture/envoi d'observations uniquement, reconnexion automatique.
Œufs après connexion/reset, changements regroupés et rafraîchissement périodique.
Players aux arrivées/départs, changements de vitesse/attributs/roster et heartbeat de 15 s.
Le revenu joueur est la somme MoneyPerSecond du roster répliqué ; non disponible = ?.
La puissance SpeedPower des autres joueurs n'est affichée que si elle est répliquée.
Une couleur verte représente une connexion WebSocket active, pas une preuve d'identité Roblox.

## Accès et limites

Sans SAE_REPORT_TOKEN/SAE_VIEW_TOKEN : mode de test anonyme.
Définir ces variables pour restreindre l'envoi et/ou la lecture.
Clé reporter : shared.__AutoSAEReportingOptions.Token, en mémoire avant le lanceur.
Clé viewer : champ du dashboard. Aucun token dans les logs ou Git.
Le lanceur doit réinjecter le token lors d'un changement de serveur si l'accès est restreint.

100 serveurs, 500 œufs par snapshot, 200 sessions, payload JSON texte <=1 MiB,
20 messages/10 secondes/connexion. Présence expirée après 45 secondes sans heartbeat.
Les données clientes sont des observations non autoritaires.

## Images

114 illustrations WebP enregistrées dans public/eggs/ et servies localement avec cache.
Correspondances dans src/assets/egg-images.json ; provenance dans docs/egg-images-sources.json.
Source : https://eggipedia.com/fr/oeufs ; image de remplacement si aucune correspondance.
