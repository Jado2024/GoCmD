# Référentiel transversal de contrôle — CASCADE4-R1

**Objet :** critères d'audit techniques des protections existantes, non un changement de politique métier. La politique `POLITIQUE_SODEPI_ACTUELLE.md` conserve son statut prioritaire ; une nouvelle décision de SODEPI y sera intégrée seulement après validation explicite.

| Domaine | Invariant à tester | Mode de preuve minimal | Skills à mobiliser |
|---|---|---|---|
| Commandes clients | En attente avant visa, aucun OF avant approbation indépendante | HTTP + SQLite + cas multi-rôles + navigateur | ventes-directeur, securite-confidentialite |
| Doublons | Idempotence des reprises techniques ; confirmation motivée des commandes réellement similaires | HTTP 201/200/409 + concurrence + audit | ventes-directeur, sqlite-integrite |
| Visas directeur | Rôle director et permission révocable `director.prices`, séparation des tâches | HTTP avec permission révoquée et prix modifié | securite-confidentialite, finance-maroc |
| Stock | `stock.read` révoquée reste interdite même avec rôle inventory ; DTO minimisé | HTTP + réponses JSON + matrice droits | securite-confidentialite, stocks-qualite |
| Réservations | Capacité non dépassée, `engagedAt` stable, absence de libération automatique arbitraire | transactions concurrentes + migration + alertes | stocks-qualite, sqlite-integrite |
| Étiquettes | Métrage total étiqueté cohérent avec le métrage facturé et nombre de pièces | cas pieceCount>1 via lib + HTTP | catalogue-gabarits, ventes-directeur |
| Avoirs / finance | Refus NaN/infini/quantité originale nulle ; centimes cohérents | tests limites + HTTP + rapprochement | finance-maroc, sqlite-integrite |
| Historique | Scellement détecte falsification, re-scellage et perte du dernier maillon | copie DB + scripts verify/deep + preuve externe | preuve-tracabilite, exploitation-resilience |
| SQLite | PRAGMA compatibles, erreurs de corruption non rejouées, pas de 201/409 trompeurs | tests Prisma réel + HTTP après build + crash sur copie | sqlite-integrite, build-ci |
| Windows | Démarrage, identité de service, sauvegardes planifiées, santé, HTTPS | PowerShell sur Windows cible, restore réel | exploitation-resilience |
| Livraison | Correctif autonome réellement applicable ; mêmes fichiers après patch | reconstruction ZIP + SHA par fichier + non-régression | contre-audit-livraison |

## Doctrine de preuve
Chaque test doit indiquer : version SHA, jeu de données fictif, commande exécutée, rôle, résultat attendu/obtenu et code de sortie.
**Ne jamais traiter un script présent, un grep ou une preuve historique comme une recette exécutée.**

## Limites explicitement conservées
Les règles de TVA/fret, la politique d'expiration des réservations, la garde indépendante des clés de scellement et la recette du serveur Windows restent des décisions / vérifications distinctes. Les modules industriels GoProd hors périmètre ne sont pas inventés pour faire passer l'audit.
