## Suites P6 (11/11/2026 — audit industriel final)

```
npm run test:p6:reservations   # 24 contrôles : ancienneté des réservations (engagedAt), alertes, migration additive
npm run test:p6:seal-chain     # 15 contrôles : chaîne de scellement append-only, re-scellage refusé, --deep
npm run test:p6:exploitation   # 28 contrôles : santé 4 états, sauvegarde/restauration/rétention, gardes négatives
npm run test:p6:load           # charge 10/20/50 sessions : 0 erreur technique, latences p50/p95, invariants
npm run test:p6:all            # les quatre suites
```

Doctrine inchangée : un refus métier attendu (409 garde) n'est jamais un échec
technique ; un test non exécuté n'est pas un PASS ; les mesures de performance
sont issues de l'environnement de recette, PAS du serveur SODEPI.

## Contrôle additionnel 09/11 — Sécurité et déploiement

`npm run test:hardening:p51523` : teste sur copie jetable de SQLite la
journalisation d'échecs d'authentification (sans secrets), le refus du lancement
sur la base démo et la dérogation réservée à la démo locale.
Cette vérification n'est PAS une recette HTTP ou une homologation production.
L'étape est ajoutée à la CI.

## Complément du 09/11/2026 — Sécurité et nouveau circuit commercial

Exécuter d'abord `npm run test:security:closure`, `npm run test:commercial:sodepi`, `npm run test:work-orders:p51521`, `npm run test:ci:coverage:p51523`. Ces commandes ont été exécutées avec succès lors de la correction, sans Next.js. Les scénarios HTTP et E2E ont été alignés sur le nouveau circuit mais doivent **réellement** passer en CI sur un build de production. Voir `NOTICE_NETTOYAGE_DEMO_P5.md` pour le statut de la présente base de test.

### RC commercial — contrôle limité disponible dans cet environnement
`npm run test:commercial:sodepi` couvre les invariants statiques et les droits existants ; `node`+TypeScript parse la syntaxe TS/TSX. Une réussite de ces contrôles **ne démontre pas** la réussite du build, des endpoints HTTP ni de Playwright. Rejouer le pipeline complet avant homologation.

# TESTS — GoCmd / SODEPI P5.15.23 RC

**Exécution de référence : audit final du 09/11/2026 (journaux complets dans `preuves/audit-final/`).** Toute la chaîne a été réellement exécutée : types, lint, build, régression 68/68 (vraie chaîne canonique 67 étapes runtime + types + startup-guard — voir `regression-status.csv`), suites P5.15.21/23, 7 recettes HTTP, matrice RBAC 485 requêtes/0 fuite, concurrence 14/14 dont crash SIGKILL, multiprocessus, SC-01..SC-15 (15/15), six mois 46/46, E2E 3/3 (chromium-1254), migrations idempotentes sur copie, sauvegarde/restauration avec redémarrage applicatif.

Toutes les commandes s'exécutent depuis la racine du projet, après
`bun install --frozen-lockfile` et `bunx prisma generate`.

## Validation technique (rapide)

```bash
bun run test:types        # tsc --noEmit — doit sortir 0
bun run lint              # eslint . — doit sortir 0
bun run build             # next build --webpack — doit sortir 0
bun run test:p51521       # APRÈS build : gardes P5.15.21 + HTTP DEF-A-01 (plafond contrat)
bun run test:audit:quality # registre DMAIC + AMDEC : structure et risques ouverts
bun run test:v18913p5147  # parcours fournisseur : téléphone, PDF, e-mail
bun run test:logic        # gabarits 11/21-24/31-34/41/51 + salon/ml + sécurité
python fsnw/tools/verifier_skills.py   # disponibilité des 20 skills FSNW
```

## Garde de couverture CI P5.15.23

```bash
python tests/test_ci_coverage_p51523.py  # sans dépendances, vérifie 11 tests et SC-13..15
bun run test:ci:coverage:p51523        # commande CI équivalente
bun run test:sc-ventes:p51523          # SC-13..15, serveur isolé et base jetable, après build
```

`test:regression:runtime` (et par conséquent `test:regression`) exécute maintenant les onze étapes P5.6→P5.13.3 auparavant omises. La CI refuse l'absence des scénarios SC-13 à SC-15. Le découpage d'audit `scripts/run-regression-chunks.sh` est portable, mais **la référence CI est `test:regression`**. Toute conclusion PASS dépend des journaux datés et de leur code de sortie, pas d'une précédente version.

## Régression complète (229 contrôles, v07 → v18913p51519)

```bash
bun run test:regression   # types + runtime (≈ 20 min ; Python requis)
```

Couvre : lots/provenance (v07), approbations, audit, concurrence in-process
(v12), CI ventes/contrats (v14), démo v16, forensic v17, opérationnel v18,
séries de remédiations v181→v18913p51519, rétention de sauvegarde.
Prérequis : Python 3 avec `sqlite3` standard ; base démo `db/custom.db`
présente (ne jamais viser une base réelle).

## Recettes HTTP (serveur de production `next start` requis)

```bash
bun run build && bun run start   # ou LANCER_GOCMD_NEUF.cmd sous Windows
bun run test:http:all            # 7 recettes : p2p, ventes, concurrence, avoirs, v189/v1891/v1892
bun run test:audit:api           # matrice sécurité/confidentialité : 485 requêtes, 0 fuite attendue
bun run test:sc-ventes:p51523    # SC-13/14/15 : modification CMD après OF, mouvement concurrent, crash/reprise
```

## Concurrence multiprocessus (CONC-001 — clos)

```bash
bun run test:audit:multiprocess          # 2 serveurs réels × 12 commandes parallèles
bun run test:audit:concurrency:matrix    # 14 scénarios : 2/5/12/25 créations simultanées,
                                         # double approbation/réception/paiement, crash SIGKILL
```

## Concurrence préparation OF sur stock fini (P5.15.22 CLT-04 — clos)

```bash
bun run build                          # prérequis : build de production présent
bun run test:of-concurrency:p51522     # deux OF × 4 matelas sur 4 en stock
```

Scénario exigé par la clôture : deux OF demandant chacun quatre matelas
alors qu'il n'en existe que quatre en stock fini. Le test exécute la course
deux fois — sur un seul processus serveur, puis à travers **deux** processus
`next start` distincts partageant la même base — et exige **exactement une
200 et une 409** : aucune double allocation, aucune préparation déclarée
disposable à tort, stock physique jamais débité par « préparer », commande
perdante non lançable, intégrité/FK intacts. L'échec est prouvé sur le code
d'origine (`[200, 200]`, journal
les archives de preuves historiques (non livrées)).

## Simulation industrielle six mois (base cumulative unique)

```bash
bun run test:audit:six-months   # nov 2026 → avr 2027 : 46 cas, snapshots mensuels,
                                 # invariants stock/finance chaque mois
```

Préconditions documentées dans `tests/http-purchasing-dmaic.cjs` : base démo
fraîche (empreinte vérifiée), serveur démarré, comptes de recette.

## Volumétrie

```bash
bun run test:audit:scale   # 100 / 1k / 10k / 100k documents — p50/p95 mesurés
```

## Règles d'interprétation (doctrine §8)

- **Non exécuté = Non testé**, jamais PASS.
- Une preuve fraîche comporte : date, version figée (SHA), entrée, attendu,
  obtenu, code de sortie.
- Le serveur de développement (`next dev`) ne prouve rien sur le build de
  production : les recettes HTTP s'exécutent contre `next start`.
- Les 409 observés sous concurrence sont des conflits métier légitimes
  (double approbation, quantité déjà engagée) — pas des erreurs.

## Contre-audit documentaire 2026-11-08

La CI exécute maintenant `test:p51521` après `build` et la validation
documentaire `test:audit:quality` ; le parcours P5.14.7 fait désormais partie
de `test:regression:runtime`. Toute mention PASS des recettes HTTP historiques
reste liée aux journaux fournis tant qu’un serveur réel n’a pas été relancé.
Voir `AUDIT_FINAL_P51521/ADDENDUM_CONTRE_AUDIT.md`.

## Résultats de référence (audit final 2026-11-08)

Voir `AUDIT_FINAL_P51521/RAPPORT_FINAL.md` : régression 229/229, p51521 PASS,
HTTP 7/7, matrice API 421/421, concurrence 14/14, six mois 46/46, volumétrie
p50 314 ms / p95 327 ms @100k, tsc/lint/build exit 0. Preuves d'exécution
volumineuses : archive séparée `GoCmd_P5_15_21_PREUVES_AUDIT.zip`.

## Recette OF/étiquettes — RC du 08/11/2026

`bun run test:work-orders:p51521` exécute le test de pagination
9→[8,1], 7→[7], 11→[8,3], les règles matelas sans dessin,
les gardes d'éligibilité et la migration SQLite sur une copie jetable.
La base de démonstration livrée est **désormais migrée P5.15.21**
(garde `test:startup-guard:p51521` — correction AV-02 du contre-audit
ventes) ; ces tests statiques ne remplacent pas les recettes HTTP, désormais
exécutées (`PREUVES_AUDIT_VENTES/`).
Le PDF d'exemple est une maquette indépendante et ne constitue pas une
preuve de rendu imprimé depuis l'application.

## Vérification CMD → OF automatique (08/11/2026)

Commande : `npm run test:work-orders:p51521`.

Elle inclut la pagination 9/7/11, un scénario mixte fabriqué + négoce en double Prisma, les tests de migration SQL sur copies et les gardes statiques. Les tests HTTP du projet, notamment la livraison et les permissions, doivent être rejoués une fois les dépendances installées et après migration sur une copie isolée de la base. Voir le rapport de correction dans `AUDIT_FINAL_P51521/`.


## Contre-audit VEN — tests ventes corrigées (08/11/2026)

```bash
bun run test:sales-fixes:p51521  # migrations autonomes et contrats de code ; PAS une preuve HTTP
bun run test:work-orders:p51521  # OF universels, étiquettes 9/7/11
bun run test:v186                 # émission/avoirs et facture historique figée
bun run test:v187                 # cohérence financière/réservations
bun run test:logic                # gabarits 11/21-24/31-34/41/51 + salon
```

En CI seulement, les migrations VEN sont appliquées à la **base de TEST** avant Prisma/TypeScript. Sur un ordinateur SODEPI, lire le RUNBOOK, sauvegarder et ne pas exécuter automatiquement une migration en production.

La validation du front, des scénarios HTTP de matelas fini et du parcours retours n'est **pas prouvée** par ces tests statiques. Tous les essais d'exploitation doivent être rejoués après installation des dépendances.

## E2E Playwright — circuit ventes dans l'interface réelle (restauré 08/11/2026)

```bash
bun run build                      # prérequis : build de production présent
bun run test:e2e                   # navigateur réel, base isolée jetable, comptes nominatifs
```

Le lanceur `tests/run-e2e-playwright.cjs` démarre un serveur de production
sur un port libre, copie la base de démonstration en base jetable, crée les
comptes de recette (commercial, responsable sales+approver, deux comptes
finance) puis exécute `tests/e2e/sales-circuit.spec.ts` : saisie catalogue +
CMD + OF brouillon automatique + impression bloquée + 8 étiquettes/page,
cycle quatre-yeux complet (approbation → production → BL → expédition
automatique), facturation TVA + règlement quatre-yeux.
La suite avait été retirée par erreur de l'archive intermédiaire
(correction FA-05) ; elle est de nouveau exécutée à chaque revalidation.

**Clôture P5.15.22 (CLT-01)** : le lanceur garantit désormais l'arrêt propre
du serveur (signaux au groupe de processus entier, SIGTERM puis SIGKILL,
`taskkill /T` sous Windows) et un **code de sortie fiable** — 0 réussite,
1 échec, 2 précondition (build absent) — sans timeout externe après la
réussite des tests. La CI exécute l'E2E comme étape **bloquante** avec
installation de Chromium (`bunx playwright install --with-deps chromium`,
cache `~/.cache/ms-playwright`) — correction CLT-02. La suite exige
chromium-1254 dans le cache Playwright (`bunx playwright install chromium`).

## P5.15.23 — Contrôles réservation stock fini
`python tests/test_finished_reservations_p51523.py` : migration, plafonds, prévention de double réservation, livraison partielle et annulation. Les recettes HTTP/Playwright nécessitent installation des dépendances et le build.


**Note de nettoyage documentaire P5.15.23 :** aucune compilation Next.js, recette HTTP complète ou session Playwright n'est exécutée par cette opération documentaire. Ne pas transférer automatiquement les PASS historiques P5.15.22 à la version P5.15.23. Les tests de non-régression ciblés et l'intégrité du paquet nettoyé sont documentés dans `docs/NETTOYAGE_P51523.md`.

## 09/11/2026 — contrôles additionnels d’intégrité

`npm run test:integrity:p51523` : deux tests SQLite (migration triggers 19 tables, backup, refus des DELETE, idempotence et préflight sur copie des migrations) + sept cas financiers (CUMP et centimes). `node --experimental-strip-types tests/v181-stock-cost.test.mjs` vérifie aussi les coûts historiques négatifs. Aucun résultat historique ne constitue une preuve de build/HTTP après cette livraison.

## Sécurité factures/journaux — 09/11/2026

`npm run test:invoice-hardening:p51523` contrôle les triggers SQLite sur une copie jetable, la préservation des paiements/statuts, la sauvegarde obligatoire, la re-jouabilité et le masquage des exceptions. Contrôle ajouté à la CI.

**Non exécutés dans l'environnement de préparation sans Bun/Next :** build Next.js, recettes HTTP, tests de charge réels (`npm run test:audit:scale`) et Playwright. Ne pas assimiler les tests statiques et SQLite à une homologation de production.

## 10/11/2026 — AUDIT ANTI-FUITES 360° : nouveaux tests et corrections

Exécution réelle (Node 24, Python 3.12, build de production, Chromium Playwright) :

- `npm run test:audit:anti-fuites` — **harnais d'audit anti-fuites (39 contrôles dynamiques, serveur isolé + copie jetable)** : cas obligatoires prix (2000→1500 MAD sans visa directeur : pending_validation, aucun OF, advance refusé, approbation directrice seule) et réservations (2×4 matelas sur stock de 4 : exactement une gagnante ; négoce idem), fuites de coûts par rôle, RBAC/IDOR, CSRF/origines, injection/divulgation, double facturation/paiement/avoir, sur-livraison, immutabilité SQL (triggers), intégrité finale. Résultat : 39/39 PASS.
- `npm run test:of-snapshot:p51524` — **non-régression OF-SNAP-01** : composition intégrale (couches de mélange, garnissage, densité, dimensions catalogue et personnalisées, instructions) transmise aux OF ; commande technique bloquée avant validation (aucun OF), OF émis après approbation tierce.
- `npm run test:fk-indexes:p51524` — **non-régression DB-IDX-01** : parité totale des index Prisma ↔ SQLite (89/89), 22 FK critiques couvertes, idempotence de la migration.
- `python tests/test_p51523_history_guards.py` — passe à **20 tables protégées** (ajout `Material`) ; idempotence et sauvegarde vérifiées.
- Corrections de recettes livrées défaillantes : SC-13/SC-14 (arbitrage règle §7 : pas de 2e approbation commerciale d'OF après suspension), R9 v1899 (garde tarifaire du devis à l'envoi, `quote-state sent` → 409 sans visa), assertion quatre-yeux `FIN-4E-01` dans `test:http:v1892`.
- E2E Playwright 3/3 avec login fiabilisé ; matrice API 485 requêtes/0 échec ; recettes HTTP 7/7 + v1899 ; concurrence 14/14 + multi-processus ; SC-15 crash/reprise PASS.

**NON TESTÉ dans cet environnement :** `test:audit:scale` (charge progressive), `test:audit:six-months` (volumétrie mensuelle), restauration sur serveur physique Windows, déploiement TLS/réverse proxy réel. Ces éléments restent à la recette industrielle SODEPI.

## P6 unifiée P1FIX — tests ciblés vérifiés

- `python tests/test_p6u_hardening.py` : 23/23 (contrats d'approbation, garde OF,
  TVA XML, supervision, Node, migration cohérente sur SQLite fictive et DEMO intacte).
- `node --experimental-strip-types tests/v18913p51521-auto-of.test.mjs` : PASS,
  y compris refus de créer un OF pour une commande sans visa responsable.
- `python tests/test_commercial_sodepi_20261109.py` : 26 contrôles PASS.
- `python tests/test_p5_duplicate_contract.py`, `python tests/test_p5_duplicate_migration.py` : PASS.
- `python tests/test_p6_reservation_aging.py`, `python tests/test_p6_audit_seal_chain.py`,
  `python tests/test_p6_exploitation.py` : PASS.
- `python scripts/verify_sqlite_runtime.py --db db/custom.db` : intégrité OK, mode DELETE.

**Non exécutés sur P1FIX** : `npm ci`, Prisma generate, TypeScript complet,
Next build, recettes HTTP, Playwright, concurrence et Windows réel. Les tests
historiques de parcours qui supposent une création de commande auto-validée
doivent être réadaptés puis rejoués sur un serveur compilé avant homologation.


## P6U-P2FIX — tests

- `python tests/test_p6u_p2fix_contracts.py` : contrats statiques des approbations,
  PDF/audit, maintenance Windows, sauvegardes planifiées, télémétrie FK,
  contrôle SQLite réel de la base fictive. Ne remplace pas les E2E.
- `python tests/test_p6u_hardening.py` : contrôles P1FIX conservés.
- `python tests/test_p6_exploitation.py` : reprise intégrale sur copies fictives.
- Après `npm ci`, Prisma generate et `npm run build`, exécuter
  `npm run test:http:all`, `npm run test:sc-ventes:p51521`,
  `npm run test:sc-ventes:p51523`, `node tests/audit-anti-fuites-sodepi-20261110.cjs`
  et `npm run test:e2e` sous Node 24, sur bases jetables. Chaque recette doit
  vérifier qu'une commande créée a zéro OF jusqu'à l'approbation nominative.
- Les scripts PowerShell ne peuvent être certifiés que par une recette Windows
  avec WinSW et le Planificateur de tâches.

### Cascade 2 — cohérence des réservations historiques

`npm run test:cascade2:engagement` exécute 8 scénarios SQL réels sur copies jetables, en supprimant volontairement les gardes ou l'index avant migration. Vérifie rétablissement automatique de la date d'engagement, protection contre sa modification, mise à jour des quantités, intégrité et idempotence. Le résultat ne remplace **pas** le build ni les tests HTTP.

`npm run test:cascade2:stress` vérifie par défaut 20 000 séquences SQL aléatoires (date d'engagement non modifiable, quantité modifiable, rollback intact). Pour une campagne de résistance distincte : variables `GOCMD_ENGAGEMENT_STRESS_CASES` et `GOCMD_ENGAGEMENT_STRESS_SEED`. Les cinq séries à 200 000 effectuées en audit CASCADE2 sont archivées dans le dossier de preuves. **Un million de scénarios ne représente pas un million d'audits indépendants du code.**

`python scripts/cascade_audit_runner.py --quick --cycles 3 --out /chemin/preuves` orchestre la régression ciblée avec codes de sortie et empreinte de la base. Les tests complets Node 24/Next/Playwright et Windows restent obligatoires séparément.
