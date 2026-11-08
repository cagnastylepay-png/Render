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
- GO sur une carte serveur demande la téléportation des favoris connectés.

## Démarrage

npm ci
npm test
npm start

Node >=22. PORT est fourni par Render, sinon 3000 ; écoute sur 0.0.0.0.
GET /, /eggs : dashboard privé. GET /health : état minimal public du service.
WebSocket : wss://m4gix-ws.onrender.com/sae/ws.

## Archive interne MongoDB Atlas

Cette archive n'est plus affichée ni transmise au tableau de bord Servers / Logs / Favoris.

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

## Favoris et envoi ciblé

Les joueurs de chaque carte serveur sont triés par SpeedPower décroissant (valeurs inconnues en dernier).
L'étoile sauvegarde le UserId Roblox comme favori, indépendamment du serveur actuel ou du nom affiché.
Le revenu minimum d'envoi se règle sur le dashboard (exemples : 500M/s, 2B/s, 1T/s).
Ces réglages sont partagés entre les pages connectées ; une révision empêche un ancien onglet d'écraser une modification récente.

Favoris et seuil : collection MongoDB `delivery_policy`, document `default`, avec MONGODB_URI/MONGODB_DB existants.
Sans MongoDB : fichier `data/delivery-policy.json` (ou SAE_DATA_DIR) ; sans stockage disponible, mémoire seulement.
L'interface affiche le stockage actif. Le seuil initial est 2B/s et la liste des favoris est vide.

Après son players.snapshot accepté, un socket reporter est associé exclusivement à son reporterUserId.
Seuls les reporters favoris reçoivent `eggs.targets` : œufs des autres serveurs du même PlaceId,
revenu >= seuil, observations non expirées et tri par revenu du store. Leur propre serveur n'est pas renvoyé.
Les messages sont dédupliqués, réévalués aux changements d'œufs/présence/réglages et vidés lors du retrait du favori.
Les viewers continuent à recevoir toutes les observations pour afficher le dashboard.

Protocole dashboard :
```json
{"type":"delivery.configure","expectedRevision":0,"favoriteUserIds":["123"],"minimumIncomePerSecond":2000000000}
```
Réponse/broadcast : `delivery.policy` avec revision, favoriteUserIds, minimumIncomePerSecond et storage.
Seuls les viewers autorisés par la clé du dashboard peuvent modifier ces réglages ; les reporters ne le peuvent pas.
Comme pour le reporting existant, un reporterUserId est une déclaration cliente et non une authentification Roblox.

Protocole du futur script parallèle :
```json
{"version":1,"type":"eggs.targets","enabled":true,"minimumIncomePerSecond":2000000000,"serverTime":0,"eggs":[]}
```
Chaque message remplace la liste précédente. enabled=false ou eggs=[] la vide.
Aucune commande Lua, collecte ou téléportation n'est exécutée par ce protocole.
Test.lua et OVORA n'ont pas été modifiés : ils ignorent ce nouveau type de message en attendant le script parallèle.

