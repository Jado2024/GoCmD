# GoCmd V18.5 — remédiations ciblées après contre-audit V18.4

## Source et limites
- Base : GoCmd V18.4 complète, archive conservée hors du dossier de travail.
- **Corrections effectuées :** TS2367 du dialogue ventes, `alert()` dans la création de devis, export CSV des soldes en centimes entiers, désactivation en UI de l’approbation/refus par le préparateur, limitation du point d’entrée `_next/image`, désactivation de l’optimisation d’images non utilisée, retrait de la dépendance inutilisée `@reactuses/core`.
- **Sécurité :** versions minimales de Next.js et eslint-config-next relevées à `16.4.1`, version de Sharp relevée à `0.35.5`. Les versions effectivement résolues ne sont pas validées dans l’environnement de création.
- **Contrôle ajouté :** `test:v185` (contrats statiques et intégrité SQLite).
- Base `db/custom.db` et schéma Prisma **inchangés**.

## Points BLOQUANTS NON résolus ici
- `bun.lock` est historique et ne correspond pas au nouveau `package.json`. **Il doit être régénéré par Bun 1.3.14 depuis un registre accessible**, puis validé via `bun install --frozen-lockfile`. Il ne faut pas committer cette version en prétendant que la CI passe.
- Le TypeScript complet, la construction Next.js sur la nouvelle version et les recettes HTTP du projet **n’ont pas été exécutés** ici faute des dépendances et de Bun/réseau.

## Points de fond encore ouverts
- Schéma `SupplierCreditNote.status @default("approved")` : à migrer vers `draft` avec préservation des données et ajout des attributs de décision (`decisionActor`, `decisionReason`, `decidedAt`). Ne pas modifier uniquement le schéma sans migrer la base.
- Avoirs clients toujours mono-acteur : décision métier et implémentation d’un quatre-yeux restent nécessaires.
- Authentification Basic : prévoir HTTPS réel, limites réseau, tests de charge et accès multi-instance avant toute production.
- Le catalogue, les prix et les règles fiscales sont des données de démonstration et non une homologation marocaine.

## Recette sur machine équipée (base isolée pour HTTP)
1. `bun --version` doit afficher `1.3.14`.
2. `bash scripts/finaliser-lockfile-v181.sh` pour régénérer puis exécuter les gates.
3. Conserver la `db/custom.db` livrée et créer une base isolée ; exécuter les scripts de recettes HTTP P2P, ventes, concurrence et crédits après préparation des comptes de test.
4. Refaire le test Chromium sur `next start` derrière une URL HTTPS conforme au déploiement.
5. Refaire `bun audit` sur le lockfile réellement régénéré, examiner les alertes résiduelles et faire valider la politique de dépendances.

Ne pas qualifier cette livraison de certifiée tant que les portes CI, E2E et sécurité ne passent pas.
