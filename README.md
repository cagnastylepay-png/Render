# M4GIX-WS / AutoSAE

## Fonctionnalités

- Servers : cartes des serveurs et de leurs œufs, images locales, poids, revenu/s,
  valeur de vente, position, état, mutations et détails complets.
- UID composé construit côté serveur : jobId/eggUid, avec clé interne placeId/jobId/eggUid.
- Sous chaque carte : joueurs de ce serveur ; vert = connexion du client du script,
  gris = joueur observé. Liste repliable avec indice de vitesse du jeu et revenu.
- Synchronisation des changements d'œufs et de joueurs. L'onglet Historique et ses messages WebSocket sont retirés ; les données archivées ne sont pas effacées.
- Timer global sur le prochain créneau de 5 minutes ; expiration individuelle issue
  de l'horaire du jeu quand fourni, sinon prochain créneau. Expiration retire les observations actives.
- GO sur une carte serveur demande la téléportation de l’admin connecté.

## Démarrage

npm ci
npm test
npm start

Node >=22. PORT est fourni par Render, sinon 3000 ; écoute sur 0.0.0.0.
GET /, /eggs : dashboard privé. GET /health : état minimal public du service.
WebSocket : wss://m4gix-ws.onrender.com/sae/ws.

## Archive interne MongoDB Atlas

Cette archive n'est plus affichée ni transmise au tableau de bord Servers / Vols / Admin.

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

Relancer la dernière version de Sae/Test.lua : Build reporting-v3.
Une connexion partagée en lecture/envoi d'observations uniquement, reconnexion automatique.
Synchronisation complète après connexion et révélation de chaque cycle de cinq minutes.
Œufs aux apparitions, modifications et disparitions ; joueurs aux arrivées/départs et changements
répliqués de vitesse/attributs/roster. Envois regroupés et dédupliqués, aucun heartbeat de données.
Le worker de connexion assure seulement les délais, reconnexions et envois déjà déclenchés.
Le revenu joueur est la somme MoneyPerSecond du roster répliqué ; non disponible = ?.
La vitesse utilise SpeedPowerProjection pour le joueur local ; les autres indices sont affichés
seulement s'ils sont répliqués. Aucune conversion depuis WalkSpeed.
Cartes et images conservées entre messages WebSocket ; nombres abrégés K, M, B, T, Qa, Qi, etc.
Une couleur verte représente une connexion WebSocket active, pas une preuve d'identité Roblox.

## Accès et limites

Définir `SECRET_MDP` exclusivement dans les variables privées du service Render.
La page demande ce mot de passe via un formulaire ; aucune valeur réelle ne doit être ajoutée à Git.
La connexion crée un cookie signé HttpOnly, SameSite=Strict et Secure sur HTTPS, valable 12 heures.
Les connexions WebSocket viewer exigent cette session et une origine identique à celle du service.
Les sessions expirées sont refusées et changer SECRET_MDP invalide les sessions précédentes.
En l'absence de SECRET_MDP, le dashboard reste fermé (503), sans arrêter les observateurs ni /health.
Les tentatives de connexion sont limitées à dix par minute et par adresse.

L'authentification de la page est distincte de celle des scripts : les reporters existants continuent
de transmettre leurs observations. SAE_REPORT_TOKEN reste une restriction optionnelle séparée.
SAE_VIEW_TOKEN est une restriction protocolaire additionnelle pour les intégrations existantes ;
elle ne remplace pas la session du dashboard. Ne jamais distribuer SECRET_MDP aux scripts clients.
L'option JavaScript `dashboardAuth:false` sert uniquement aux tests du protocole historique ;
elle n'est pas configurable depuis HTTP ou une variable d'environnement.

100 serveurs, 500 œufs par snapshot, 200 sessions, payload JSON texte <=1 MiB,
20 messages/10 secondes/connexion. Présence conservée tant que le socket reste actif ; fermeture et ping/pong détectent les déconnexions.
Les données clientes sont des observations non autoritaires.

## Images

114 illustrations WebP enregistrées dans public/eggs/ et servies localement avec cache.
Correspondances dans src/assets/egg-images.json ; provenance dans docs/egg-images-sources.json.
Source : https://eggipedia.com/fr/oeufs ; image de remplacement si aucune correspondance.

## Admin unique

ADMIN_USERNAME définit le seul compte géré (MagixSafe par défaut). Admin.lua reste un squelette TODO, sans fonctions en jeu pour le moment.
Servers affiche les œufs et les joueurs de tous les reporters. Admin affiche le compte configuré, son état et ses derniers paramètres.
Vols accepte et rejoue seulement ses lignes FLIGHT_RESULT : les diagnostics Render et les autres comptes sont exclus, y compris dans les anciennes données MongoDB.
Les étoiles et delivery.configure sont supprimés. Les anciennes données de favoris restent archivées et ne sont plus utilisées.
Le hello reporter doit annoncer clientKind=admin et le players.snapshot doit déclarer le username configuré. Les paramètres sont dédupliqués et sauvegardés dans client_settings.
Seul cet Admin reçoit eggs.targets et teleport.request ; GO envoie une destination immédiate même si AUTO est OFF. Les observateurs restent passifs.
La carte du serveur du username configuré est prioritaire et dorée, même sans script Admin actif. Aucun code Lua arbitraire n’est envoyé par Render.
Le username et le rôle sont déclarés par le client et ne prouvent pas la propriété d’un compte Roblox. Conserver SAE_REPORT_TOKEN si une restriction des reporters est nécessaire. SECRET_MDP protège séparément le dashboard.
