# Plan d'intégration

1. Valider le contrat documenté dans Sae/modular/docs/Protocol.md.
2. Migrer les fonctions de Test.lua dans NotreLib sans changer les règles du jeu.
3. Relier EggObserver -> EggReporter -> transport partagé ; publier après réception du nouveau cycle.
4. Implémenter EggStore et EggGateway puis les tester avec des snapshots fictifs.
5. Monter explicitement l'extension sur le serveur HTTP existant, chemin /sae/ws,
   après définition des contrôles d'accès. Utiliser le serveur HTTP de server.js et son port Render.
6. Ajouter l’authentification du dashboard et connecter la page Eggs.
7. Activer la connexion cliente. GO reste désactivé jusqu'à une demande dédiée.

L'hôte fourni est m4gix-ws.onrender.com. Le chemin /sae/ws est une proposition,
pas une route déjà disponible. Les fichiers de cette étape ne démarrent aucun service.
