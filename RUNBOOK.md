## Mise à niveau P5.15.27 RC — copie isolée uniquement

**Avant tout :** sauvegarde restaurée sur autre répertoire et arrêt du serveur.
Migrer dans l'ordre P5.15.25 → P5.15.26 → P5.15.27. Sur une copie déjà migrée
P5.15.26 :

```bash
python scripts/upgrade_mts_rework_cost_p51527.py --db /chemin/vers/copie.db --apply
npm run test:p51527
bun install --frozen-lockfile
bunx prisma validate && bunx prisma generate
bunx tsc --noEmit && bun run lint && bun run build
```

Les rejets MTS donnent lieu à **REOF approuvé par la production**, distinct de
la réception et de la qualité. Le magasinier doit référencer le rejet,
l'autorisation REOF et le motif lorsqu'une entrée dépasse l'historique initial.
Avant la libération qualité d'une matière fabriquée MTS, la finance valide un
coût standard provisoire MAD via `/api/production-stock/cost`. Ce n'est pas le
coût réel GoProd. Ni un ordre MTS ni une validation de coût ne crée un BC.

Les évolutions kg/ml, charges 100k et les recettes HTTP/Windows doivent encore
être vérifiées. **Pas d'homologation sans ces preuves.**

---

## Démarrage sécurisé — 09/11/2026

- **Production :** utiliser une base séparée préexistante et sa sauvegarde vérifiée,
  renseignée dans `GOCMD_DB_FILE`. `npm run start` appelle maintenant
  `scripts/start-gocmd-checked.cjs`, comme `npm run start:checked`.
- **Démonstration locale uniquement :** sous Windows, `LANCER_GOCMD_NEUF.cmd`
  définit explicitement `GOCMD_ALLOW_DEMO_DB=1`, utilise `db/custom.db` et
  écoute sur `127.0.0.1`. Sur Linux, démarrer avec
  `GOCMD_DB_FILE=db/custom.db GOCMD_ALLOW_DEMO_DB=1 HOSTNAME=127.0.0.1 npm run start`.
- **Interdit :** exposer la démo sur `0.0.0.0` ou utiliser le fichier livré
  en production. Les bases copiées à un autre chemin exigent une discipline
  opérationnelle supplémentaire : le garde identifie la base *embarquée*.
- **Sécurité :** consulter le journal d'authentification `GoCmdAccessAudit` :
  évènements `session.login` (succès) et `session.login.failed` (échecs).
  Mettre en place une politique de conservation, un accès restreint et une
  limitation des tentatives par IP sur le reverse proxy.

### Mise à niveau commerciale P5.15.23 — copie de démonstration uniquement
1. Faire une sauvegarde vérifiée de `db/custom.db`.
2. Sur la copie démo : `python scripts/upgrade_commercial_sodepi_20261109.py --db db/custom.db --apply --ack DEMO_COPY_ONLY`.
3. `bun install --frozen-lockfile`, `bunx prisma validate`, `bunx prisma generate`, `bun run build`.
4. Exécuter `npm run test:commercial:sodepi`, la régression, les recettes HTTP et Playwright.
5. Tester avec deux utilisateurs distincts : prix catalogue direct, directeur pour exception, responsable technique pour personnalisation, magasinier pour préparation et BL.
Ne jamais appliquer l'outil de mise à niveau à la base de production sans plan de migration/recette et sauvegarde SODEPI.

# RUNBOOK — GoCmd / SODEPI P5.15.23 RC

Exploitation, sauvegarde et restauration. Environnement de recette ;
l'exploitation en production SODEPI exige en plus TLS, reverse proxy et
professionnels habilités (voir SECURITE.md).

## 0. Migrations de l'audit anti-fuites (10/11/2026) — à appliquer sur une vraie base

Après sauvegarde externe vérifiée et GoCmd arrêté (jamais sur la base active) :

```bash
# Garde anti-suppression physique de la table Material (P1 DB-HIST-02)
python scripts/upgrade_material_delete_guard_20261110.py --db /chemin/base.db \
    --backup /dossier/externe/before_material_guard.db --apply
# Index des clés étrangères + réconciliation Prisma ↔ SQLite (P2 DB-IDX-01)
python scripts/upgrade_fk_indexes_20261110.py --db /chemin/base.db \
    --backup /dossier/externe/before_fk_indexes.db --apply
# Contrôles
python scripts/verify_operational_guards_p51523.py --db /chemin/base.db   # attend 20/20 + 6/6
python tests/test_fk_indexes_20261110.py                                  # parité des index
```

Les deux migrations sont additives, idempotentes et transactionnelles ; la base
de démonstration de l'archive les a déjà intégrées. Le démarrage contrôlé
(`npm run start:checked`) REFUSE désormais toute base sans les 20 gardes.

## 1. Installation de recette (dossier neuf, jamais par-dessus un ancien GoCmd)

```bash
# Prérequis : Node.js ≥ 24, Bun, Python 3 (sqlite3 standard)
bun install --frozen-lockfile
bunx prisma validate
bunx prisma generate
cp .env.example .env      # vérifier DATABASE_URL → base de recette UNIQUEMENT
bun run test:types && bun run lint
bun run build
bun run test:p51521       # gardes + DEF-A-01
python fsnw/tools/verifier_skills.py
```

**Windows** : `LANCER_GOCMD_NEUF.cmd` (après installation, configuration et
build) avec contrôles d'en-tête SQLite (`scripts/start-gocmd-checked.cjs`).
Vérification d'installation : `node scripts/verify_current_package.cjs`.

## 2. Démarrage / arrêt

```bash
GOCMD_DB_FILE=/chemin/vers/base-production.db bun run start
# Refus de démarrage sans GOCMD_DB_FILE explicite (et refus démo par défaut).
# arrêt : SIGTERM propre ; le mode WAL reprend à froid sans perte
```

Le serveur de développement (`next dev`) est réservé au développement et ne
préuve rien (TESTS.md).

## 3. Comptes

```bash
node scripts/bootstrap-admin.cjs       # premier administrateur (une seule fois)
node scripts/create-user.cjs           # comptes nominatifs ensuite (UI admin)
node scripts/upgrade-admin-session.cjs # mise à niveau session admin
node scripts/purge_test_sessions_p51513.py   # purge des sessions de test
```

Chaque personne = son compte ; renouvellement de mot de passe quand forcé.

## P5.15.28 — Correctifs P1 avant mise en production (10/11/2026)

**Attention : la version candidate P5.15.28 applique la politique de sûreté SQLite `DELETE` (rollback).**
Le mode `WAL` est provisoirement désactivé : les moteurs SQLite de `node:sqlite`,
Python et Prisma doivent d'abord être qualifiés sur le serveur cible, car SQLite
signale un risque rare de corruption WAL-reset sur les versions anciennes.
La politique `DELETE` est une mitigation **conservatrice**, pas une mise à jour de
ces moteurs. Elle peut augmenter les contentions : refaire les recettes de charge.

Ne jamais convertir le journal avec GoCmd en fonctionnement :

```sh
# Lecture seule : contrôle du journal et de l'intégrité, sans modification.
python scripts/verify_sqlite_runtime.py --db /chemin/base-reelle.db

# Si la base est encore en WAL : GoCmd arrêté, fenêtre de maintenance,
# sauvegarde complète externe déjà vérifiée. Cette commande effectue aussi
# une sauvegarde SQLite externe distincte avant tout changement de journal.
python scripts/verify_sqlite_runtime.py --db /chemin/base-reelle.db \
  --set-rollback --ack MAINTENANCE_WINDOW \
  --backup-file /autre-disque/avant-conversion.db
```

Le lanceur `scripts/start-gocmd-checked.cjs` refuse de démarrer si le journal
n'est pas `DELETE`, si la DB est altérée ou si des FK sont incorrectes.
`src/lib/db.ts` contrôle le journal et les FK au pré-vol Prisma ; les erreurs
ne sont plus ignorées avant les écritures sérialisées. Il faut passer par le
lanceur contrôlé en production, et non démarrer Next.js directement.

### Sauvegarde complète P1 (remplace la sauvegarde DB seule en exploitation)

```sh
python scripts/backup_gocmd_complete.py --source /data/gocmd.db \
  --documents-dir /data/gocmd-private-documents \
  --output-dir /disque-externe-chiffre/gocmd-backups

# Valider la sauvegarde puis restaurer vers un NOUVEAU répertoire.
python scripts/restore_gocmd_complete.py \
  --archive /disque-externe-chiffre/gocmd-backups/gocmd_full_....zip \
  --verify-only
python scripts/restore_gocmd_complete.py \
  --archive /disque-externe-chiffre/gocmd-backups/gocmd_full_....zip \
  --target-dir /restauration-test/gocmd-restaure
```

L'archive contient **SQLite + les PDF fournisseurs référencés + manifeste SHA-256**.
Si un PDF manque ou diffère de sa référence, la sauvegarde complète échoue sans
produire d'archive finale. Les documents sont identifiés par leurs noms UUID
immuables ; leurs SHA sont validés sur le snapshot SQLite et sur le ZIP final.
Les secrets de service, comptes système, clés TLS et autres fichiers externes ne
sont **pas** inclus : ils doivent être documentés et protégés dans un coffre
séparé avec une procédure de reprise.

**IMPORTANT : le ZIP généré n'est PAS chiffré.** Il doit être stocké sur une
destination chiffrée et protégée hors du disque serveur, avec tests de
restauration et suivi des échecs via le Planificateur de tâches Windows.
La sauvegarde et la restauration réelles sur Windows restent à valider sur site.
La base DB seule (`db:backup`) demeure disponible pour les migrations ou
les diagnostics, mais ne constitue **pas** une sauvegarde métier complète.

**Pas de migration automatique, pas de conversion sur base de production sans
fenêtre de maintenance et autorisation SODEPI.**

## 4. Sauvegarde

```bash
python scripts/backup_sqlite.py        # copie SQLite seule, NON suffisante pour l'exploitation métier
```

- Fréquence recommandée : quotidienne + avant **toute** migration.
- Rétention contrôlée par les tests (`test_backup_source_retention.py`).
- Vérifier l'empreinte SHA-256 de chaque sauvegarde et la consigner.

## 5. Restauration (à répéter sur copie, jamais sur la base active)

```bash
mkdir restauration-test && cd restauration-test
# extraire le ZIP officiel, copier la sauvegarde dans db/custom.db
sqlite3 db/custom.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
bun install --frozen-lockfile && bunx prisma generate && bun run build
GOCMD_DB_FILE=/chemin/vers/base-restauree.db bun run start
# recette ciblée : login, un circuit achat complet
```

La restauration a été vérifiée pendant l'audit (snapshot `VACUUM INTO`
mensuels relus : intégrité ok, 0 violation FK, reprise fonctionnelle).

## 6. Migrations — garde-fous OBLIGATOIRES

```bash
# INTERDIT : bunx prisma db push   → refusé par scripts/refuse-unsafe-schema-change.cjs
```

- Migrations officielles : `prisma/sql/` + scripts `scripts/upgrade_*.py` /
  `scripts/migrate_*.py` versionnés.
- **Sauvegarde vérifiée avant** ; contrôles après :
  `PRAGMA integrity_check`, `foreign_key_check`, `table_info`, `sqlite_master`.
- Les scripts `ALTER TABLE` ne sont **pas idempotents** : vérifier la colonne
  avant réapplication.
- Ne jamais appliquer une migration à une base réelle SODEPI sans autorisation
  explicite, sauvegarde vérifiée et recette séparée.

## 7. Contrôles périodiques

| Fréquence | Contrôle | Commande |
|---|---|---|
| Hebdo | intégrité base | `sqlite3 db/custom.db "PRAGMA integrity_check;"` |
| Hebdo | cohérence FK | `sqlite3 db/custom.db "PRAGMA foreign_key_check;"` |
| Mensuel | régression technique | `bun run test:regression` |
| Mensuel | recette HTTP (serveur build) | `bun run test:http:all` |
| Trimestriel | restauration d'une sauvegarde | §5 |
| Avant livraison | matrice API + concurrence | `test:audit:api`, `test:audit:concurrency:matrix` |

## 8. Incidents connus et conduite à tenir

- **409 sous charge concurrente** : conflit métier légitime (double
  approbation, quantité déjà engagée) — faire actualiser et rejouer
  l'opération ; jamais un contournement.
- **Base verrouillée (SQLITE_BUSY)** : vérifier qu'un seul serveur accède à
  `db/custom.db` ; `busy_timeout=5000` est déjà appliqué ; ne jamais copier
  une base sans son WAL/SHM.
- **Après un crash** : WAL rejoué automatiquement ; contrôler
  `integrity_check` avant de rouvrir aux utilisateurs.

## 9. Limites de ce runbook

- Installation Windows réelle : **non exécutée** depuis le sandbox Linux —
  dérouler le §1 sur le PC cible SODEPI avant homologation.
- La simulation fonctionnelle de six mois ne prouve pas la stabilité d'une
  production de six mois (voir RAPPORT_FINAL.md §6).


## Migration ventes P5.15.21 — exécution MANUELLE après sauvegarde (08/11/2026)

**Ne pas lancer sur le PC SODEPI sans sauvegarde validée et fenêtre de maintenance.**
Le code révisé exige les colonnes de photographie commerciale et les tables de stocks finis/retours. Ne jamais utiliser `prisma db push` sur la base de production.

1. Arrêter GoCmd, sauvegarder `db/custom.db` avec la procédure SQLite de sauvegarde cohérente (fichier `.db`, WAL inclus). Vérifier l'intégrité et la restauration sur une copie.
2. Environnement de TEST seulement : exécuter d'abord sans `--apply` les 3 migrations ci-dessous ; vérifier leurs ajouts.
3. Exécuter sur une **copie** avec `--apply` dans cet ordre :

```bash
python scripts/upgrade_sales_snapshots_p51521.py --db db/custom.db --apply
python scripts/upgrade_finished_stock_p51521.py --db db/custom.db --apply
python scripts/upgrade_customer_returns_p51521.py --db db/custom.db --apply
```

Chaque script crée sa propre sauvegarde SQLite au premier changement. Ils sont idempotents. Rejouer `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, puis `bunx prisma generate`, `bun run test:types`, `bun run build`, recettes HTTP et retour-arrière documenté.

4. Recette des matelas finis : magasin `POST /api/sales/finished-stock` (action `receive`) → décision `release` d'un autre compte qualité → OF de préparation → BL déduit les lots. Ne pas insérer de stock « automatiquement » pour simuler de la fabrication.
5. Retours : `POST /api/sales/returns` (action `request`) → `receive` par réception → `accept/reject` par qualité, puis avoir/éventuel remboursement traité séparément par finance.

**RESTENT À VALIDER avant production** : API HTTP (rôles, concurrence), impression réelle, rapprochement fiscal, retour de matières revendues, stock fini partiel, procédure Windows et validation SODEPI.


## Migration additive des réservations de matelas finis — P5.15.23

**La base de démonstration livrée est déjà migrée.** Ce bloc décrit une procédure future sur **copie isolée**, pas une commande à exécuter immédiatement sur SODEPI :

1. Arrêter l'application, réaliser une sauvegarde cohérente SQLite et vérifier une restauration sur copie.
2. Exécuter le contrôle sans `--apply` **sur la copie**, puis examiner les tables/triggers et les écarts.
3. Après validation du schéma source et des prérequis de versions, appliquer **uniquement sur la copie** :

```bash
python scripts/upgrade_finished_reservations_p51523.py --db db/custom.db
python scripts/upgrade_finished_reservations_p51523.py --db db/custom.db --apply
python scripts/check_sqlite_schema_p5157.py --db db/custom.db
python tests/test_finished_reservations_p51523.py
```

Les OF historiques `legacy_stock` doivent être examinés humainement ; aucune réservation ne doit être inventée rétroactivement. Tester la coexistence des préparations, livraisons partielles, suspensions et annulations, puis le build et le parcours HTTP sur le code final.

## Intégrité historique et migration supervisée — 09/11/2026

Appliquer uniquement après recette SODEPI et arrêt de GoCmd. Lire `INTEGRITE_HISTORIQUE_P51523.md`. Le script de protection ajoute 19 triggers empêchant les suppressions physiques des documents historiques sur la base ciblée, après sauvegarde externe ; **ne pas l’appliquer par défaut à la base démo réinitialisable**. Les migrations anciennes autorisées passent par `run_verified_schema_upgrade_p51523.py` (prétest sur copie, sauvegarde externe, comparaison avant/après). Jamais de restauration automatique sur une base active.

## Démarrage sécurisé après la mise à jour des factures (09/11/2026)

Sur une **copie de recette** de la base opérationnelle, application arrêtée :

```sh
python scripts/upgrade_history_delete_guards_p51523.py --db /data/gocmd.db --backup /backups/before_delete_guards.db --apply
python scripts/upgrade_invoice_immutability_p51523.py --db /data/gocmd.db --backup /backups/before_invoice_guards.db --apply
python scripts/verify_operational_guards_p51523.py --db /data/gocmd.db
```

Vérifier les écritures courantes et la reprise sur la copie, puis appliquer sur la base réelle uniquement après recette humaine et sauvegarde vérifiée. `start:checked` refuse un démarrage sans ces gardes. Les données de démonstration peuvent toujours être supprimées et régénérées par le script dédié.

---

# Compléments P6 — 11/11/2026 (homologation technique)

## P6.1 — Ancienneté des réservations (chantier 2, migration additive)

La table `SalesStockReservation` porte désormais `engagedAt` (début
d'engagement, fixé à la création, **jamais rajeuni** par une modification ou
une consommation partielle) ; `FinishedStockReservation` porte `updatedAt`
(dernière modification). Les alertes `/api/sales/reservation-alerts` exposent
le modèle complet : `createdAt`, `engagedAt`, `lastModifiedAt`,
`expectedDeliveryAt`, `warningAt`, `expiresAt`, `state`.

- Base existante : `npm run db:upgrade:reservation-aging:p6` (sauvegarde
  automatique, idempotent, backfill `engagedAt = createdAt`).
- Vérification : `npm run test:p6:reservations`.
- L'expiration automatique reste **inactive par défaut** : sans
  `GOCMD_RESERVATION_TTL_HOURS`/`GOCMD_RESERVATION_WARNING_HOURS` validés par
  SODEPI, les alertes sont informatives et AUCUN stock n'est libéré
  automatiquement (une commande ferme garde ses engagements).

## P6.2 — Scellement d'audit chaîné (chantier 3, §4.5)

`scripts/audit_seal_p5152.py` gère désormais une **chaîne append-only** :
chaque scellement écrit un maillon horodaté référençant l'empreinte du
précédent. Un administrateur ne peut plus masquer une modification en
re-scellant : le scellement est **refusé** si la chaîne existante diverge
(code 6) ; supprimer un maillon est détecté (code 4).

Procédure SODEPI (direction, PAS l'administrateur) :

```bash
# 1. Générer et CONSERVER HORS SERVEUR une clé >= 32 octets (coffre direction).
# 2. Scellement quotidien (tâche planifiée, clé fournie au moment de l'exécution) :
GOCMD_AUDIT_SEAL_KEY=<clé> python scripts/audit_seal_p5152.py seal --chain \
  --db C:\GoCmd\data\gocmd.db --out D:\GoCmdVault\sauvegardes\gocmd-audit-seal.json
# 3. Vérification quotidienne (désormais EXHAUSTIVE même sans --deep) :
GOCMD_AUDIT_SEAL_KEY=<clé> python scripts/audit_seal_p5152.py verify --chain --db ... --out ...
GOCMD_AUDIT_SEAL_KEY=<clé> python scripts/audit_seal_p5152.py verify --chain --deep --db ... --out ...
```

Codes de retour : 0 intègre · 2 événements modifiés/clé incorrecte ·
3 événements non scellés (mode strict) · 4 chaîne cassée (maillon
supprimé/modifié) · 6 scellement refusé (divergence — investiguer).

L'indépendance réelle exige : clé ET maillons archivés sur un support séparé
hors serveur, vérification par une personne distincte de l'administrateur.

## P6.3 — Supervision locale à quatre états (chantier 4, §5.3)

`deploy/windows/verifier-sante.ps1` qualifie désormais l'état global :

| État | Signification | Sortie |
|---|---|---|
| OPÉRATIONNEL | Aucune alerte | 0 |
| DÉGRADÉ | Application utilisable, alertes à suivre (disque < 20 Go, sauvegarde 25–48 h, erreurs, accès anormaux) | 1 |
| INTERVENTION REQUISE | Application/base indisponible ou incertaine, sauvegarde > 48 h, disque < 5 Go | 2 |
| ARRÊT SÉCURISÉ | Service volontairement arrêté, base vérifiée saine | 3 |

Nouveaux contrôles : tentatives de connexion refusées (24 h, via
`scripts/health_metrics_p6.py`, compteurs sans données confidentielles),
erreurs techniques des journaux, fraîcheur du scellement d'audit.
Le script PowerShell est livré testé statiquement ; **son exécution réelle
sur Windows Server doit être recettée sur site** (mission §5.2).

## P6.4 — Objectifs RPO/RTO (à arrêter avec la direction SODEPI)

Proposition initiale soumise à validation (planification à installer sur site :
4 sauvegardes/jour, rétention 56 archives soit 14 jours nominaux) :

| Paramètre | Proposition initiale | Justification | Statut |
|---|---|---|---|
| RPO | Cible proposée ≤ 12 h, non garantie tant que les alertes et le stockage externe ne sont pas qualifiés | 4 sauvegardes/jour (00h00, 06h00, 12h00, 18h00), soit 6 h d'écart nominal ; alerte > 12 h | À valider SODEPI |
| RTO | ≤ 4 h | Restauration guidée testée (POSTE DE SECOURS) + démarrage vérifié | À valider SODEPI |

La fréquence planifiée ne suffit pas à garantir le RPO : les sauvegardes
échouées, le temps de transfert hors serveur et les alertes doivent être
surveillés. Les scripts Windows doivent signaler une sauvegarde vieille de
plus de 12 h. L'objectif RPO/RTO sera fixé avec SODEPI après une recette sur site.

## P6.5 — Références de performance mesurées (chantier 5, §6.4)

Environnement de RECETTE Linux (pas le serveur SODEPI) — base 20 000
consultations, `npm run test:p6:load` :

| Niveau | Sessions | Opérations | Erreurs techniques | Liste lourde p95 | Création commande p95 | Validation p95 |
|---|---|---|---|---|---|---|
| 10 | 22 | 50 | 0 | 788 ms | 234 ms | 125 ms |
| 20 | 42 | 100 | 0 | 1 421 ms | 444 ms | 276 ms |
| 50 | 102 | 250 | 0 | 3 220 ms | 846 ms | 535 ms |

À 100 000 documents (`npm run test:audit:scale`) : pagination/filtre/tri
200–864 ms. Sauvegarde sur base chargée : 109 ms. Aucune écriture partielle,
intégrité préservée à tous les niveaux. **Ces chiffres servent de base de
comparaison ; la qualification réelle doit être refaite sur le serveur cible.**


## P6 unifiée — sécurité des scellés et service SQLite

- `verify --chain` et `seal --chain` recalculent désormais la totalité des empreintes des intervalles scellés, et non uniquement le plus ancien. Un intervalle récent modifié est rejeté. `--deep` est conservé pour la compatibilité, mais n'est plus nécessaire.
- Le pointeur `chainLatest` doit correspondre au dernier maillon. La perte du maillon terminal bloque aussi les vérifications et le scellement. Un effacement simultané de tous les scellés et du pointeur ne peut être détecté sans **copie d'ancrage indépendante** : archiver périodiquement `chainLatest` et les maillons hors du serveur, avec un accès distinct de l'administrateur.
- Le démarrage officiel est `npm run start` / `node scripts/start-gocmd-checked.cjs` avec `GOCMD_DB_FILE`. Le verrou atomique couvre le PID du serveur enfant et refuse une seconde instance. `next start` direct contourne cette mesure : interdit dans la procédure d'exploitation. Aucun verrou de fichiers ne remplace des sauvegardes cohérentes ni les tests d'arrêt brutal.
- Les erreurs SQLite `SQLITE_CORRUPT`, `P1008` et erreurs ambigües post-commit nécessitent une investigation, pas un rejeu automatique aveugle de la requête.
- Vérifier avant mise en service le fonctionnement effectif sur Windows, les permissions de fichiers, la supervision, le verrou après crash, les transactions concurrentes et les sauvegardes/restaurations.

## P6 unifiée P1FIX — interruption et contrôle de scellement

Le pointeur du dernier maillon et l'écriture de ce maillon ne sont pas une
transaction unique entre deux fichiers. En cas de crash, ne pas effacer le
maillon orphelin et ne pas lancer un nouveau scellement sans contrôle :

1. Arrêter la tâche de scellement et préserver les fichiers présents (copie en
   lecture seule, empreintes SHA-256).
2. Comparer la chaîne, le pointeur et la dernière ancre hors serveur par un
   responsable distinct de l'administrateur.
3. Vérifier les HMAC et les événements de la base via l'option `--deep` ; en
   cas d'écart, ouvrir un incident et restaurer depuis un point vérifié.
4. Réconcilier une écriture interrompue uniquement selon un PV à quatre yeux ;
   ne pas écraser de maillon pour masquer la discontinuité.

La conservation hors serveur, la garde indépendante de la clé et le test sur
serveur SODEPI restent des conditions d'exploitation, non des tests réussis.


## P6U-P2FIX — Exploitation (2026-11-11)

Le kit Windows actif est `deploy/windows/installer-service.ps1` (instructions
prioritaires : `deploy/windows/README.md`). Service WinSW sous LocalService
explicitement déclaré, démarrage interdit si contrôle SQLite/identité/tâches
échoue, quatre sauvegardes quotidiennes planifiées avec vérification du ZIP,
supervision quotidienne ; arrêt `ARRÊT SÉCURISÉ` uniquement après marqueur
administrateur valide créé par `maintenance-controlee.ps1`. Ne jamais traiter
un service arrêté sans marqueur comme une maintenance.

Les sauvegardes restent des **ZIP non chiffrés** : imposer volume chiffré,
stockage hors serveur et exercice périodique de restauration. La protection
de la clé de scellement reste distincte du service Windows. Les recettes
Windows, Wi-Fi, imprimantes, TLS et stockage hors serveur sont NON TESTÉES.
