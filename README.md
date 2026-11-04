# M4GIX-WS / AutoSAE

## Fonctionnalités

- Eggs : cartes Divine, Eternal, Secret et Cosmic, images locales, poids, revenu/s,
  valeur de vente, position, état, mutations et détails complets.
- UID composé construit côté serveur : jobId/eggUid, avec clé interne placeId/jobId/eggUid.
- Sous chaque carte : joueurs de ce serveur ; vert = connexion du client du script,
  gris = joueur observé. Liste repliable avec indice de vitesse du jeu et revenu.
- Notifications des changements ; historique daté affichant uniquement les reçus et réapparitions.
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

Sans SAE_REPORT_TOKEN/SAE_VIEW_TOKEN : mode de test anonyme.
Définir ces variables pour restreindre l'envoi et/ou la lecture.
Clé reporter : shared.__AutoSAEReportingOptions.Token, en mémoire avant le lanceur.
Clé viewer : champ du dashboard. Aucun token dans les logs ou Git.
Le lanceur doit réinjecter le token lors d'un changement de serveur si l'accès est restreint.

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
