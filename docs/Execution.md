# TestV2 : requête JSON → Lua → réponse JSON

Cette fonction est activée par défaut dans le client dédié TestV2, identifié par la mention TESTV2 dans son titre. Elle exécute le Lua avec les permissions du client ; ce n’est pas un bac à sable. `Test.lua` ne contient pas cette fonction. Le lancement de TestV2 suffit ; aucune variable shared n’est requise. La continuation de téléportation existante relance Test.lua, qui ne contient pas ce canal. L’authentification dédiée est temporairement retirée : toute personne accédant à Render peut envoyer du code à ces clients activés.

1. Sur son propre client, lancer **TestV2.lua** :

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/cagnastylepay-png/Sae/main/TestV2.lua"))()
```

2. Ajouter ce joueur aux favoris. Dans l’onglet **Test**, choisir le client, puis envoyer le code.

Exemple de code sans effet sur le jeu :

```lua
return {jobId = game.JobId, placeId = game.PlaceId}
```

La page envoie :

```json
{"version":1,"type":"execute.request","clientId":"connexion-cible","code":"return 1 + 1","timeoutMs":10000}
```

Render génère un `requestId` et transmet au seul client choisi. Exemple de réponse :

```json
{"version":1,"type":"execute.result","requestId":"id-genere","ok":true,"result":2,"resultCount":1,"durationMs":1}
```

Les erreurs de compilation/exécution reviennent avec `ok:false` et `error`. Les résultats sont privés à la connexion opérateur ; le code et les résultats ne sont pas sauvegardés dans MongoDB. Les Instances/Vector3/CFrame sont convertis en objets JSON descriptifs ; profondeur, taille et nombre d’éléments sont limités. Les doublons de requêtes récents ne sont pas réexécutés.

Un seul test par client ; délai de réponse de 1 à 30 secondes. L’annulation Luau est coopérative : une boucle qui ne rend jamais la main peut bloquer Roblox malgré le délai d’attente. Ne pas envoyer de boucle sans `task.wait()`.

Le client doit être favori et utiliser TestV2. Pour désactiver cette capacité, arrêter TestV2 et utiliser Test.lua.

