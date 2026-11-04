# État d'intégration

Le serveur HTTP, le gateway /sae/ws, le stockage mémoire et la page Eggs sont branchés.
Test.lua contient temporairement le client pour les essais, sans dépendre des squelettes modulaires.

Prochaines étapes :
1. Tester dans Delta et vérifier les accusés [REPORT] sur un reset réel.
2. Extraire les méthodes dans NotreLib et les modules sans changer le protocole.
3. Prévoir le passage des paramètres privés lors des changements de serveur si les clés sont activées.
4. Ajouter une persistance si les observations doivent survivre aux redémarrages Render.
5. Définir le comportement de GO séparément ; aucune commande distante n'est implémentée.

Protocole v1 : voir Sae/modular/docs/Protocol.md et README.md pour les modes d'accès.
