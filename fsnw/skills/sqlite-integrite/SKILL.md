---
name: gocmd-sqlite-transactions-migrations
description: "Auditer schéma Prisma, invariants SQLite, transactions, unicité, coûts, migrations et restauration."
---

# Skill — gocmd-sqlite-transactions-migrations

## Quand utiliser
Auditer schéma Prisma, invariants SQLite, transactions, unicité, coûts, migrations et restauration.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Garantir qu'une opération sensible de GoCmd n'entraîne ni doublon, ni stock négatif, ni perte d'historique ni altération de données.

## Procédure obligatoire
1. Copier `db/custom.db` dans un environnement de test ; journaliser origine et hash. Ne jamais migrer la copie maîtresse.
2. `PRAGMA integrity_check; PRAGMA foreign_key_check;` puis inspecter unicités, contraintes, index, triggers et relations.
3. Relire les migrations V18.6, V18.9.2, catalogue V18.9.3 et prix directeur V18.9.5 ; vérifier idempotence et rollback/restauration sur copie.
4. Rejouer collisions référence BC/BR, réception parallèle, double BL, crédit affecté deux fois, inventaire concurrent et création fournisseur après suppression.
5. Réconcilier quantités, lots, mouvements, CUMP et conversions ; tester frontières Decimal/Float/centimes y compris dépassement d'entiers sûrs JS.
6. Tester SQLite avec un seul écrivain puis expliciter les limites multi-processus du mutex JS.
7. Réaliser backup cohérent + restore sur fichier distinct, comparer clés et comptages, relever RTO/RPO réels mesurés.

## Vérifications et critères d'acceptation
Les tests SQL en lecture ne doivent pas être appelés « test HTTP ». Les comptes d'inventaire et factures historiques ne doivent pas être détruits au prétexte d'un nettoyage. Chaque mutation de test sur base jetable uniquement.

## Livrables attendus
`preuves/DB_schema.txt`, `preuves/DB_reconciliation.csv`, `preuves/backup_restore.log`, tableau invariants + cas concurrents.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — transactions, migrations, incidents
- Identifier séparément les versions SQLite utilisées par Prisma/libsql, `node:sqlite` et Python. Vérifier le journal réellement actif, les clés étrangères sur les connexions pertinentes et les limites d'un **serveur unique**.
- Ne pas appeler `$executeRawUnsafe` pour un PRAGMA qui retourne une ligne (ex. `busy_timeout`) ; le pré-vol doit être testé par **écriture Prisma réelle** et API HTTP après build.
- Un `SQLITE_CORRUPT` ou « database disk image is malformed » n'est pas une erreur de verrou à rejouer automatiquement ; déclencher analyse d'intégrité, arrêt sûr et sauvegarde de preuve.
- Tester l'ambiguïté timeout/commit : réponse 201 seulement pour une écriture persistée ; sur issue inconnue ne jamais réexécuter aveuglément une mutation non idempotente.
- Tester les migrations `engagedAt` sur base neuve, ancienne, partielle et rejouée : index présent, colonne non nulle selon le modèle, valeur stable lors des mises à jour ; une migration doit réparer l'index absent.
- Les sauvegardes d'une base active doivent employer une méthode cohérente SQLite, et couvrir les PDF privés dans le même scénario de restauration.
