# Intégration

Le reporting de test reste dans Sae/Test.lua, en attendant l'extraction vers NotreLib.

Déploiement : publier main sur Render, définir MONGODB_URI et MONGODB_DB=autosae pour l'historique durable,
puis relancer Test.lua dans Delta. Vérifier /health, les logs [REPORT], les cartes, Players et Historique.

La connexion Atlas réelle reste à vérifier après configuration des variables privées.
Le code ne contient aucun mot de passe. Les fichiers d'images sont inclus dans Git et servis par Render.

GO n'est pas branché ; aucune demande distante de téléportation/vol n'est reçue ni exécutée.
