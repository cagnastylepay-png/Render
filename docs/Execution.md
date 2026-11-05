# TestV2 : requête JSON → Lua → réponse JSON

Cette fonction est réservée aux clients de test que leur propriétaire active explicitement. Elle exécute le Lua avec les permissions du client ; ce n’est pas un bac à sable. `Test.lua` ne contient pas cette fonction. Les options d’exécution ne sont pas enregistrées dans les paramètres ni propagées après une téléportation.

1. Définir dans Render `SAE_EXEC_TOKEN`, une clé aléatoire privée d’au moins 24 caractères.
2. Sur son propre client, avant de lancer **TestV2.lua** :

```lua
shared.__OvoraExecution = {Enabled = true, Token = "VOTRE_CLE_PRIVEE"}
loadstring(game:HttpGet("https://raw.githubusercontent.com/cagnastylepay-png/Sae/main/TestV2.lua"))()
```

3. Ajouter ce joueur aux favoris. Dans l’onglet **Test**, saisir la même clé, cliquer **Autoriser**, choisir le client, puis envoyer le code. Ne pas publier la clé dans un script ou dépôt.

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

L’authentification est refusée si la clé n’est pas configurée ; être favori ne suffit pas. Pour désactiver cette capacité, arrêter TestV2 et le relancer sans l’option `Enabled=true`.
