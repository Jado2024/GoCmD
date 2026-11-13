## R13.3-reprise — 13 novembre 2026 (contre-audit d'exécution Z.ai : D-GEN-01 corrigé, CI complète rejouée sous Node 24, dérives de packaging réparées)

- **D-GEN-01 CORRIGÉ (option D de l'analyse, sans toucher au trigger V16 ni à la politique métier)** : le formulaire générique collecte désormais les caractéristiques taxonomiques réelles exigées par `go_v16_product_insert` — GEN-MAT : noyau (`SANS_RESSORTS`/`BONNELL`/`ENSACHES`), composition mousse (`PURE`/`MELANGE`/`AGGLO`), finition (`SANS`/`TOPPER`/`ALESE`) et densité ou couches (mélange : ≥ 2 couches PURE+AGGLO, épaisseur totale ≤ hauteur) ; GEN-MOU : nature, densité 1–500, grade ≥ 2 caractères. `GenericLineSchema` valide ces champs AVANT insertion (400 explicites alignés sur le trigger — plus jamais l'aborton 503 trompeur), la fiche INT-GEN les persiste, l'instantané technique scellé les emporte (hash SHA-256), et la prévisualisation les reflète. **GEN-DIV reste suspendu par 400 explicite** (« famille DIVERS absente de la taxonomie V16, décision métier SODEPI requise, D-GEN-01/E ») — aucun contournement du trigger, aucune contrainte d'unicité modifiée. Test bloquant `tests/r133-dgen01-generic-taxonomy.test.cjs` (9 scénarios sur copie jetable : GEN-SAL 201 inchangé, GEN-MAT PURE/MELANGE 201 + fiches conformes, GEN-MOU 201, champs manquants 400, couches > hauteur 400, GEN-DIV 400, cycle quatre-yeux complet, intégrité + FK + audits). Étape CI bloquante `test:dgen01`.
- **Dérive d'index détectée et réconciliée (défaut préexistant R13.2/R13.3)** : le test de parité Prisma↔SQLite (DB-IDX-01) échouait — le schéma Prisma déclarait `@@index([expires_at])` (convention `GoCmdSession_expires_at_idx`) alors que la base, le SQL démo et `user-directory.cjs` créent l'index historique `GoCmdSession_expires_idx`. Réconciliation par l'attribut officiel Prisma `map:` (`@@index([expires_at], map: "GoCmdSession_expires_idx")`) : aucune écriture sur les bases, la détection de dérive du test reste intégrale (elle résout désormais les noms `map:` explicites). Re-vérifié : 99 index déclarés présents, 22 FK critiques couvertes, migration idempotente.
- **Contrat statique A-03 aligné sur PERF-02** : `test_v1891_counter_audit.py` exigeait le motif historique `canSeeCommercial ? activeOrders.reduce` ; depuis PERF-02 la valeur de pipeline provient d'un agrégat SQL (`pipelineRow`). La propriété RBAC exigée (conditionnement par `canSeeCommercial`) est inchangée et reste vérifiée sur le motif actuel.
- **Harnais CORR-01 durci contre la contention transitoire** : sous les tempêtes d'écritures délibérées, l'API peut répondre 503 + Retry-After (comportement CONÇU et contractualisé R13.2, base en journal DELETE par règle métier P5.15.28 P1 — jamais WAL). Le harnais réessaie désormais borné (8 essais, budget Retry-After) sur les logins et confirmations sensibles, COMPTE les contentions absorbées dans le verdict, et échoue toujours sur un 503 persistant ou toute corruption. Stabilité re-vérifiée : **5 exécutions PASS consécutives** (0 contention absorbée sur machine propre), intégrité aux 4 phases + après arrêt.
- **Contre-audit complet sous Node.js 24.22.2 (2 vCPU, 4,1 Go)** : contrat d'intégrité 5/5 sur DEMO vierge (empreinte conforme `65288ab6…`) ; `npm ci`, `prisma generate`, `prisma validate`, `tsc --noEmit`, `eslint .`, `next build` : exit 0 ; migrations CI 12/12 (intégrité ok, 0 violation FK) ; suite verrou mono-instance (déni de second processus, récupération de verrou stale) ; concurrence 409/503 (C1/C2/C3 à 2/5/10, invariants C4/C5/C7, contrats 503 techniques 5/5) ; audit B indépendant RBAC ; régression complète **exit 0** (après corrections ci-dessus) ; recettes HTTP métier (8/8), six-mois, SC-ventes 12/12 + 3/3, concurrence OF, RBAC HTTP isolé, confidentialité client, anti-fuites ; **Playwright E2E 3/3** (quatre-yeux, OF, étiquettes, livraison, facturation TVA, règlement quatre-yeux) après installation du Chromium 1254 requis ; charge P6 avec intégrité ; UX v18910 ; investigations 401 : **aucun 401 transitoire** (phases A/B/C, intégrité ok) ; cycle sauvegarde→vérification→restauration complet sur répertoire neuf : **identité logique intégrale (73 tables, mêmes lignes et empreintes de contenu)**, manifeste validé.
- **Base DEMO inchangée** (SHA-256 `65288ab6a380d3b9a7d8f8b3447fe011d01f674eca4c60efc19d310abf06545d` avant et après régénération), aucune règle métier modifiée, aucun contournement de trigger ou de contrainte, version `18.9.13-p6.15.30-cascade4-r2-v2-r13-3-moteur-unique-identites` conservée.

## R13.2 — 12 novembre 2026 (contre-recette industrielle finale : C4/C5/C7 exécutés, défauts de harnais corrigés, distinction 409/503)

- **C4/C5/C7 réellement exécutés sous Node 24.22.2** (`npm ci` exit 0, `prisma generate`, `next build`, serveur production) : campagne `concurrency-409-503-r13.cjs` **20/20 PASS** — C4 paiements simultanés (201/409, une seule écriture, version facture=1, un seul audit `SALES_PAYMENT_RECORDED`, solde exact 46 000/46 000 centimes), C5 réservations concurrentes sur négoce réel 1:1 (200/409, lignes distinctes, aucune sur-réservation, stock physique intact), C6 retry idempotent (201/409/200), C7 zéro signal SQLITE_BUSY/P1008/P2002/P2010, zéro 5xx, zéro erreur transport, C8 intégrité finale (integrity=ok, FK=0, refs uniques).
- **D1 (C7 renforcé)** : `technicalErrors()` détecte désormais aussi **P2002 et P2010** exigés par la mission (la liste ne couvrait que P1008/P2028/P2034). Injection négative vérifiée : un journal serveur contenant P2002 ou P2010 fait échouer la campagne ; un 409 métier seul reste PASS. Test unitaire étendu (4 groupes).
- **D2 (harnais RBAC HTTP réparé)** : `ci-v1896-isolated-http.cjs` ne pouvait plus démarrer depuis le durcissement anti-démo (P2-01 appliqué à 5 harnais, celui-ci oublié) — `GOCMD_ALLOW_DEMO_DB=1` ajouté (copie jetable, HOSTNAME forcé 127.0.0.1). La matrice RBAC multi-rôles + le scénario compte partagé legacy sont à nouveau réellement exécutés : **2 scénarios PASS** (aucune fuite coût/prix/PII, admin confiné, démo lecture seule même avec `GOCMD_ALLOW_LEGACY_WRITES=1`).
- **D3 (fixture du harnais réparée)** : la commande client du scénario A restait `pending_validation` (jamais approuvée, prix 235 hors catalogue => visa directeur requis) et les assertions de confidentialité du dashboard passaient sur une liste `upcoming` vide. La fixture utilise désormais le prix catalogue et l'approbation quatre yeux par un tiers : les assertions DTO s'exécutent sur une commande réellement active.
- **D4 (503 technique vs 409 métier — mission §2 C7)** : sous stress multi-processus, un P1008 (temporisation de transaction, fail-closed `GOCMD_SQLITE_OUTCOME_UNCERTAIN`) pouvait sortir en **409 générique** « Enregistrement impossible », masquant une erreur technique derrière un conflit commercial. `POST /api/orders` distingue désormais : P1008 → 503 + Retry-After 5 (consigne de vérification), P2028/P2034/SQLITE_BUSY/locked → 503 + Retry-After 2 (rejouable), toute autre erreur `PrismaClient*` → 503 technique ; les conflits d'état métier (DuplicateOrderConflict, PRODUCT_CHANGED, TRADE_CHANGED, devis converti…) conservent leur 409 documenté. Nouveau contrat statique `tests/r132-technical-503-contract.test.cjs` (5 groupes PASS) + étape CI bloquante `test:r132:contracts`.
- **D5 (harnais matrice durci)** : `audit-concurrency-matrix.cjs` ne crashe plus sur une réponse sans corps JSON (`data?.order?.ref`) et vide les journaux des 3 instances en cas d'échec (preuve de cause serveur, ex. P1008) ; c'est ce diagnostic qui a permis de confirmer D4.
- **Non-régression recheckée** (codes de sortie réels) : tsc, ESLint, build, suites logique/base/procurement/v07/v09/v12, recettes HTTP 8/8 (P2P, ventes, concurrence, crédits, v189/v1891/v1892, C4), anti-fuites 40/40, matrice API 574 requêtes/0 échec, audit qualité, SC-ventes 12/12 et 3/3, OF concurrence, multi-processus, matrice concurrence 14/14 (nominal), six-mois, Playwright E2E 3/3 (2 passages), sauvegarde→restauration intégrale vérifiée (74 tables, intégrité ok, manifeste validé), R13 20/20 rejoué après chaque correctif.
- **Performance mesurée** : liste commandes (contrat UI `view=list`) p95 = 27/31/52/115/301 ms à 2/5/10/20/50 utilisateurs, 0 erreur ; charge mixte P6 avec liste lourde 20 k : 0 erreur technique, 0 écriture partielle, RSS 232→399 Mo, sauvegarde SQLite en charge 109 ms ; à 50 sessions mixtes (sandbox 2 vCPU), p95 liste = 2 345 ms — au-dessus de l'objectif provisoire 1 500 ms en forte charge, à consolider sur le serveur Windows cible (conditions différentes assumées).
- **Observation résiduelle** (non corrigée, documentée AMDEC) : en topologie 3 processus sur un même fichier SQLite — hors contrat de déploiement (verrou d'instance), le harnais matrice peut observer des 503 techniques sous saturation CPU et, une fois sur six passages, une double création S5 (write-skew inter-processus) ; en topologie supportée (un seul processus, file sérialisée), la garantie « exactement une création » est prouvée par la campagne R13 (C2 50 requêtes => 1 création) et `http-concurrent-orders`.
- Base DEMO `db/custom.db` **inchangée** (SHA-256 identique à R13.1), aucune règle métier modifiée, aucune interface modifiée (UX/UI reporté), version `18.9.13-p6.15.30-cascade4-r2-v2-r13-2-recette-concurrence-validee`.

## R13 — 12 novembre 2026 (audit industriel final, contre-audit validé)

- **P0 dépendances** : `npm ci` réellement exécuté sous Node 24 (exit 0) ; `deepmerge-ts` 8.0.2
  vérifié dans l'installation ; `npm audit` en ligne : 0 critical / 0 high, 7 moderate dev-only
  (typescript-eslint/minimatch) acceptées avec revue planifiée.
- **SEC-R13-01** : `GET /api/production-stock` vérifie désormais le refus individuel `stock.read`
  (alignement sur stock-lots/movements) ; défaut détecté par le nouveau contre-audit indépendant.
- **Contre-audit B indépendant** (`tests/audit-b-independant-r13.cjs`, 31/31 PASS) : sessions,
  permissions révoquées (stock.read, costs.read, director.prices), admin confiné, fuites de
  coûts/prix par valeurs, quatre yeux, champs protégés, idempotence, intégrité.
- **Tests concurrence dédiés** (`tests/concurrency-409-503-r13.cjs`, 20/20 PASS) : vagues
  2/5/10/20/50 utilisateurs — validations simultanées, rejeu idempotent, lectures massives,
  réservation dernière unité, retry ; zéro 5xx, zéro double écriture, aucun signal
  SQLITE_BUSY/P1008 observé.
- **Performance mesurée** (`tests/perf-bench-r13.cjs`, `tests/perf-volume-r13.cjs`,
  `tests/profile-orders-r13.cjs`) : p95 liste commandes 290–407 ms à 50 utilisateurs
  (objectif < 1 500 ms) ; EXPLAIN QUERY PLAN : index R11 utilisé ; SQL ≤ 0,06 ms/requête.
- **Playwright E2E 3/3** (Chromium 158) : quatre yeux + OF + étiquettes, préparation/livraison,
  facturation TVA + règlement quatre yeux.
- HTTPS privé : pré-vol enforce PASS ; cookies Secure/HttpOnly/SameSite et contrôle d'origine
  vérifiés en HTTP réel (proxy simulé) ; validation TLS/ACL sur site = EXTERNAL VALIDATION.
- Sauvegarde/restauration et migration index R11 (idempotente) re-testées sur copies.
- Dossier de preuves `preuves/R13/` (rapport, matrice 20 skills, PDCA/DMAIC, AMDEC, logs,
  mesures JSON) ; scripts npm `test:r13` et `test:perf:r13` ; version
  `18.9.13-p6.15.30-cascade4-r2-v2-r13-counter-audit-validated`.
- Aucune modification de règle métier, aucune suppression de fonctionnalité.


- Recherche et pagination côté serveur des matières dans la DA ; filtre fournisseur et DA ; compteurs de présence bornés aux sélections.
- Commandes : recherche par référence/client sur toute la base, 50 par page ; indicateurs agrégés globalement.
- Prix spéciaux directeur : file paginée 25 par page et total indépendant de la page.
- Deux assertions de non-régression mises à jour sans supprimer les contrôles de confidentialité/OF.
- Aucune suppression de données DEMO ni changement de schéma. Compilation Node 24 et recettes HTTP/Playwright non vérifiées.

## CASCADE4-R2 (11 novembre 2026) — contrôle des prix en attente

- `GET /api/products?pendingPrice=1` : rôle directeur ET permission `director.prices` révocable ; refus 403 si retrait individuel.
- UX commandes : file et visas tarifaires masqués en cas de retrait de permission.
- Test SQLite + assertions API/UI et scénario HTTP 403/200 intégrés.
- Aucun changement CUMP / transport / taxe / base démo.

## 2026-11-11 — CASCADE4-R1 — nettoyage documentaire et FSNW

- Archive séparée des rapports de campagnes précédentes, annexes et preuves CASCADE4 ; aucun code `src/`, schéma/migration, base, script ni test supprimé.
- Consolidation de README, docs, notices agents et FSNW ; mise à jour des consignes obsolètes relatives à Bun et aux sessions.
- Conservation des 20 skills, de leurs références épinglées, des documents métier, des registres historiques nécessaires aux tests et de la base de démonstration intacte.
- Publication de `RISQUES_RESIDUELS.md` comme synthèse des décisions et essais terrain en attente.
- Aucun nouveau résultat build/HTTP/Playwright homologuant ce paquet n'est déduit de ce seul nettoyage.

## P6U-CASCADE4-R1-RC — 11 novembre 2026 (contre-audit correctif ciblé)

- Révocation individuelle `stock.read` désormais vérifiée par les GET `/api/stock-lots` et `/api/movements` pour comptes SQLite gérés, en complément des rôles.
- Quantité originale nulle/négative refusée par `partialLineCredit` ; quantité déjà créditée supérieure à l'original refusée.
- Recette HTTP C4 enrichie de 4 scénarios de permissions révoquées ; approbation 200 requise pour vérifier les champs privés, sans 409 toléré.
- Contrat de permissions + tests de calcul intégrés à la régression C4. Base démo inchangée. Version candidate non homologuée.

## P6U-CASCADE4-RC — 11 novembre 2026 (contre-audit indépendant extrême, candidat NON homologué)

Contre-audit indépendant du code applicatif (revue sémantique des circuits qui produisent réellement les décisions, écritures et mouvements), avec reproductions exécutées, corrections réelles et contre-vérifications. **Aucune anomalie inventée ; chaque constat porte une preuve (fichier, lignes, exécution ou trace HTTP).**

- **C4-01 (P2, corrigé)** — `src/lib/order-pieces.ts` : une ligne au métre simple avec `pieceCount>1` produisait N étiquettes portant CHACUNE le métrage total (10 ml en 3 pièces → 3 étiquettes de 10 m : 30 m étiquetés pour 10 m facturés). Démontré par exécution ; la garde refus désormais ce chemin (`pieceCount>1` réservé aux découpes réelles via `parts`, dont la somme est déjà contrôlée) ; `order-create-schema.ts` aligné (max 50, plage morte 51–500 supprimée).
- **C4-02 (P2, corrigé)** — visas directeur `products/[id]/catalog-price` et `materials/[id]/sales-price` : la permission révocable `director.prices` n'était pas vérifiée (rôle seul), contrairement aux circuits `orders/[id] approve-prices` et `products/[id]/director-price`. Un directeur dont la permission est retirée conserve deux canaux de décision tarifaire. Corrigé ; test HTTP dédié (compte directeur avec permission refusée → 403).
- **C4-03/C4-04 (P2, corrigés)** — `GET /api/stock-lots` et `GET /api/movements` n'appliquaient pas la matrice `stock.read` documentée (tout compte nominatif lisait les lots, y compris les enregistrements QualityInspection bruts avec `actor` et `reason` — donnée personnelle, doctrine RR-18). Corrigé : portes de rôle côté serveur, DTO inspection minimal (id, décision, quantité, date) ; l'acteur et le motif restent dans le circuit qualité dédié.
- **C4-05/C4-06 (P3, corrigés)** — fuite des champs internes `createRequestKey`, `createRequestDigest`, `customerOrderNoNormalized` dans les réponses des PATCH `/api/orders/[id]` (4 sites) et dans la vue `deliveries` de `/api/sales`, contredisant la règle d'hygiène du code lui-même (GET /api/orders les retire). Corrigé partout.
- **C4-07 (P3, corrigé)** — `sales-credit-lines.ts` : `partialLineCredit` laissait franchir NaN (comparaisons NaN toutes fausses) → montant d'avoir NaN ; `allocateInvoiceTax` écrasait l'allocation d'un id dupliqué (perte silencieuse de centimes de taxe). Gardes ajoutées, fail-closed.
- **C4-08 (P3, corrigé)** — `supplier-credit-coverage.ts` : convertisseur monétaire local `Math.round(Number(x)*100)` (acceptait « 0.145 » → 14,5 c, « 1e5 », produisait NaN sur « abc ») remplacé par le convertisseur unique `moneyToCents` (fail-closed), comme le commentaire du module le prétendait déjà.
- **C4-09 (P3, corrigé)** — `production-planning-formulas.ts` : `pointOfReorder(0.1,3,0)` = 0.300001 (artefact flottant amplifié par ceil) ; epsilon anti-artefact aligné sur `replenishment-policy` (désormais 0.3).
- **C4-10 (P3, corrigé)** — `replenishment-policy.ts` : définition locale des unités fractionnaires inversée par rapport à `purchase-quantity` (suggestion « 8.334 carton », refusée ensuite par `isValidPurchaseQuantity` : suggestion inexploitable). Même définition partagée (`permitsFraction`).
- **C4-11 (P3, corrigé)** — `GET /api/clients` : l'approbateur était exclu alors que la matrice `clients.read` documentée et la liste RIGHTS l'incluent (GET /api/orders l'accepte déjà). Aligné sur la matrice.
- **Tests** — nouveau test de contre-audit HTTP permanent `tests/c4-counter-audit.test.cjs` (21 requêtes : idempotence Idempotency-Key rejouée 200/409, quatre-yeux par compte cumulant, mustChangePassword bloquant, visas directeur sans permission, portes stock.read, absence des champs internes) + `tests/c4-lib-contracts.test.mjs` (contrats numériques C4-07/08/09/10). **Les 4 suites d'audit qui n'étaient PAS en CI (matrice concurrence 3 processus, multiprocessus, anti-fuites 40/40, WAL+backup P1) sont intégrées à `test:regression:runtime`** : le gate de régression ne peut plus les ignorer.
- **Test de mutation quatre-yeux rejoué indépendamment (§9 de la mission)** : garde `SELF_REVIEW_FORBIDDEN` retirée → recette HTTP en échec (409 au lieu de 403 : la seconde couche `ORDER_NOT_APPROVED` de `createMissingWorkOrders` annule toute la transaction — défense en profondeur effective) ; garde rétablie → recette PASS. Causalité démontrée dans les deux sens.
- **Passe C (transactions SQLite/Prisma)** — 5/5 contrôles exécutés sur copie jetable : FK réellement appliquée sur la connexion (P2003), atomicité totale (aucune écriture partielle après erreur), transitions conditionnelles, collision de références inter-connexions → P2002 sans doublon, journal DELETE + foreign_keys vérifiés. Réponses aux 10 questions du cahier des charges dans le dossier de contre-audit.
- **Base de démonstration inchangée** : SHA-256 `550e68d4…f61` identique à l'archive CASCADE3 ; aucune commande, facture, réservation ou opération d'essai dans la base livrée.
- Statut : candidat **NON homologué**. Windows sur site NON TESTÉ (script review uniquement) ; recette navigateur Playwright et charge à rejouer sur le livrable final avant décision.

## P6U-CASCADE3-RC — 11 novembre 2026 (audit industriel en cascade, compléments de preuve)

- **Environnement réel enfin exécuté sur cette branche** : `npm ci` (490 paquets), `prisma generate`, `tsc --noEmit` EXIT 0, ESLint 0 erreur, **build Next.js production EXIT 0**, serveur démarré par le lanceur vérifié, recettes HTTP (7/7 par orchestrateur + recette métier), **Playwright E2E 3/3** (T1 quatre-yeux/OF/étiquettes, T2 préparation/livraison, T3 facturation/TVA/quatre-yeux financiers), charge 10/20/50 sessions 0 erreur technique, simulation six mois **46/46 cas**.
- **Famille TEST-P1FIX (cause racine unique, 7 batteries)** : le P1FIX (toute commande naît `pending_validation`, OF seulement après visa commercial quatre-yeux) avait été appliqué au code **sans mettre à jour les tests dépendants** — l'archive CASCADE2 livrée faisait donc ÉCHOUER sa propre chaîne `test:regression:runtime` (étapes v18910 et reprise). Corrigé CÔTÉ TESTS uniquement, au contrat P1FIX : matrice de concurrence S6 (avec vérification négative : réservation pré-approbation refusée), multiprocessus, reprise industrielle (validation de la commande négoce), SC-05 ventes, CLT-04 phases A/B, OF-SNAP-01 (témoin banquette), six-mois (O2C-OPEN/PARTIAL/COMPLETE/BILL/CREDIT/SETTLE + NEGOCE-01). **Aucune règle métier affaiblie** ; chaque correction vérifie AUSSI la nouvelle règle (aucun OF avant visa).
- **Contrats statiques désynchronisés** : `test_p5159_fusion_contract.py` attendait l'ancienne base démo (64/217/11/0 comptes) et l'ancien transfert brut de messages d'erreur — actualisé sur la base de référence P5.15.23 (82/218/18/9) et le durcissement INFO-001 (liste blanche de messages métier). `test_v18910_ux_contract.py` : libellé de validation nominative actualisé (l'invariant — aucune clé de validation commune — reste vérifié).
- **Lacune de couverture prouvée par mutation (PHASE 8)** : la garde quatre-yeux d'approbation de commande (`SELF_REVIEW_FORBIDDEN`) n'était couverte par AUCUN test détecteur (le 403 passait par la porte de rôle). `http-sales-recipe.cjs` renforcée : un compte cumulant `sales`+`approver` crée une commande puis tente de l'auto-valider → 403 « quatre yeux » attendu ; mutation re-vérifiée DÉTECTÉE.
- **Ergonomie QA** : `test:http:{sales,concurrency,credits,v189,v1891,v1892}` échouaient systématiquement hors orchestrateur (garde d'isolation) — routés par `run-http-recipes-v1899.cjs` (nouvelle option `--only`), la garde d'isolation étant conservée.
- **Chaîne officielle complète rejouée** : `test:regression:runtime` EXIT 0 (105 commandes de suites, 0 échec) + `cascade_audit_runner.py --cycles 3` (33/33 commandes, base démo inchangée). Scénario indépendant de contradiction 28/28 et de variation 27/27 (données, comptes, quantités, ordres d'opérations différents). Base démo livrée **identique à l'octet près** à CASCADE2 (SHA-256 vérifié).
- Statut : les preuves manquantes de CASCADE2 (Node 24, build, HTTP, Playwright) sont comblées ; **Windows sur site reste NON TESTÉ** — homologation conditionnelle recommandée, voir le procès-verbal du dossier d'audit CASCADE3.

## P6U-CASCADE2-RC — 11 novembre 2026

- Contre-audit supplémentaire de l'ancienneté des réservations : insertion SQL sans `engagedAt` → NULL dans les bases migrées historiques alors que Prisma le déclare obligatoire. Reproduit sur base jetable.
- Migration P6 durcie, sans reconstruction de table : réparations idempotentes des réservations NULL, des deux gardes SQL pour les bases anciennes nullable et de l'index, avec sauvegarde SQLite avant modification.
- Nouvelle batterie fonctionnelle `test:cascade2:engagement` : 8 états de migration, 80 assertions de cohérence/immutabilité/intégrité, jamais sur la base d'exploitation.
- Aucune modification des circuits achats/ventes/OF ; version non homologuée tant que Node 24, Next build, API, Playwright et Windows réel ne sont pas rejoués.

## 11/11/2026 — P6U-CASCADE1-RC (contre-audit en passes indépendantes, candidat NON homologué)

- P2 confirmé : index Prisma `SalesStockReservation_engagedAt_idx` absent de la base demo livrée malgré sa déclaration dans `schema.prisma`. Base corrigée sans suppression de données ; le test historique de parité 96 index/22 FK est maintenant PASS.
- P2 confirmé : migration P6 `upgrade_reservation_engagement_p6.py` ignorait le cas « colonnes présentes, index absent ». Migration additive corrigée pour réparer également l'index, même sur une base déjà partiellement migrée ; sauvegarde SQLite cohérente et migration idempotente.
- Contrats de tests hérités actualisés SANS assouplir les règles : acteur capturé après auth, création des OF exclusivement après approbation quatre-yeux, permission directeur et réauthentification personnelle sur prix exceptionnels.
- Test P5.14.3 modernisé : l'ancien reset destructif doit échouer sans écraser la base protégée ; le regénérateur P6 recrée une démonstration propre sur un environnement isolé.
- Nouveau test anti-récidive `test_cascade_p6_reservation_index_drift.py`, intégré à la régression et à la CI.
- Limites : Node 22 présent, Node 24 requis, npm ci hors ligne impossible (cache npm incomplet) ; aucun build/HTTP/Playwright exécuté dans ce contre-audit. Exploitation Windows, chiffrement et sauvegarde externe à valider sur site. Version non homologuée.

## P6U-P2FIX — 11/11/2026 (candidate, non homologuée)

- Contrats de recettes commerciales actualisés pour l'approbation obligatoire
  de toutes les commandes et la création des OF seulement après validation.
- Playwright : second compte approbateur et cas négatif auto-approbation ; OF=0
  avant visa, OF produit après visa.
- Service WinSW sous LocalService explicitement, identité vérifiée avant start.
- Planification Windows : sauvegardes 4/jour, contrôle d'une première exécution,
  supervision quotidienne et maintenance nominative horodatée.
- PDF fournisseur : audit des consultations sérialisé, téléchargement suspendu si
  l'audit ne peut être écrit.
- Acteur commande : capture unique dans le PATCH.
- SQLite : télémétrie FK explicite avec distinction connexion Python / Prisma.
- Les campagnes Node24/Next/HTTP/Playwright et Windows sur site restent à refaire
  sur ce ZIP exact ; aucune homologation de production revendiquée.

## 2026-11-11 — P6 UNIFIÉE P1FIX (contre-audit sévère, candidat non homologué)

- P1 commande : plus aucune commande standard/négoce/spéciale auto-validée à sa création ; approbation commerciale systématique, indépendante du visa directeur ; OF exclusivement après approbation nominative dans la transaction, garde active dans le service OF et l'avance de statut.
- P1 Windows : installateur et supervision fournissent `--db`, version Node 24+ vérifiée ; nouvelle route HTTP de liveness 204, état arrêt sécurisé distingué d'une panne ; absence du contrôle SQLite = alerte critique.
- P1 TVA : aucun barème fictif activé par le gabarit du service Windows.
- P2 migration : sauvegarde SQLite cohérente avec `Connection.backup` sous `BEGIN IMMEDIATE`, intégrité et FK contrôlées avant toute modification.
- P2 exploitation : RPO cible 12 h non garanti, proposition 4 sauvegardes/jour, rétention ajustée à 56 ; seuil d'alerte >12 h ; Node 24 aligné avec CI et lanceur.
- P2 résiduels : lancement direct de Next.js hors wrapper (procédure + ACL, non empêché universellement), garde externe de la clé et des maillons de scellement, reprise après crash du scelleur : procédures documentées, validation sur site requise.
- Cibles testées : contrôle P1 23/23, migration SQLite fictive, émission OF en simulation, tests P6 réservations/scellement/exploitation, base DEMO intègre. **Aucun test Next build/HTTP/Playwright sur ce P1FIX faute des dépendances complètes ; statut NON HOMOLOGUÉ.**

## 2026-11-11 — P6 UNIFIÉE (fusion branches auditées + corrections des scellés)

- Base : P6.15.30 auditée, avec migration `engagedAt`, supervision quatre états, tests P6 et base DEMO propre.
- Fusion contrôlée de P6-MERGE : verrou d'instance atomique dans le lanceur, traçabilité de l'acteur de commande figée et absence de rejeu aveugle sur erreurs SQLite d'issue incertaine ; tests nouveaux et CI dédiée.
- Sécurité corrigée : vérification de tous les maillons scellés par défaut (y compris la période intermédiaire), validation du pointeur `chainLatest` et refus du scellement si la période déjà scellée ou le maillon terminal est absent/altéré.
- Tests de régression adversariaux ajoutés pour la falsification de la période récente et la suppression du dernier maillon.
- Statut RC : nécessite re-build, recettes HTTP/Playwright sur cette version fusionnée et recette Windows sur site avant homologation définitive.

## 11/11/2026 — AUDIT INDUSTRIEL FINAL P6 — HOMOLOGATION TECHNIQUE, RÉSERVATIONS, SÉCURITÉ, AUTONOMIE, PERFORMANCE

- Mission P6 sur l'archive officielle P5.15.29-P5 (SHA-256 b14ab435785bd59c32e7267a7aee462e3e56a1785bf99744413924a417b4a88a) ; installation fraîche reproduite ici (npm ci 17 s — l'échec de l'équipe P5 était environnemental, PAS structurel), build/tsc/lint EXIT 0.
- **Famille d'anomalies TEST-DUP (9 fichiers de tests, cause racine unique)** : la garde doublons P5.15.29-P5 (correcte côté serveur) n'avait jamais été rejouée contre les tests qui créent légitimement des commandes similaires — 7 batteries ÉCHOUAIENT sur l'archive livrée : reprise industrielle, recette concurrence HTTP, matrice de concurrence, multiprocessus, six mois (NEGOCE-01), sc-ventes p51521 (SC-08) / p51523 (SC-14), CLT-04, anti-fuites (5 cas). Corrigé CÔTÉ TESTS uniquement, au contrat documenté P5 (confirmation `duplicateReview:{token,reason}` ou jours de livraison distincts) : AUCUNE règle métier affaiblie. La matrice S5 vérifie désormais le contrat P5 sous concurrence (1 création / 9 refus 409 justifiés, 0 écriture partielle) et multiprocess ajoute la garde inter-processus.
- **Typos réels** : `due()` à 864e3 ms (14,4 min au lieu de 14 jours) dans sc-ventes p51523 et anti-fuites — corrigés (86400e3).
- **Chantier 2 — Réservations** : migration additive `engagedAt` (début d'engagement, jamais rajeuni par consommation partielle) + `updatedAt` sur réservations finies ; alertes `/api/sales/reservation-alerts` sur le modèle explicite complet (createdAt/engagedAt/lastModifiedAt/expectedDeliveryAt/warningAt/expiresAt/state) ; expiration toujours inactive sans validation SODEPI, libération jamais automatique pour une commande ferme. Tests : `test:p6:reservations` (24 contrôles, garde SQL gocmd_p5154 vérifiée).
- **Chantier 3 — Sécurité/journaux** : scellement d'audit **chaîné append-only** — un re-scellage après falsification est REFUSÉ (code 6), la suppression d'un maillon est détectée (code 4), vérification exhaustive `--deep` ; compatibilité P5.15.2 conservée. Tests : `test:p6:seal-chain` (15 contrôles).
- **Chantier 4 — Autonomie** : supervision à quatre états (OPÉRATIONNEL/DÉGRADÉ/INTERVENTION REQUISE/ARRÊT SÉCURISÉ) avec nouveaux contrôles (tentatives d'accès anormales via `health_metrics_p6.py`, erreurs techniques, fraîcheur scellement) ; sauvegarde/restauration/rétention contre-auditées ; RPO/RTO proposés à la validation SODEPI. Tests : `test:p6:exploitation` (28 contrôles).
- **Chantier 5 — Performance** : charge multi-niveaux 10/20/50 sessions (22/42/102 sessions, 400 opérations, 0 erreur technique, 0 écriture partielle, p95 création 234/444/846 ms, sauvegarde 109 ms base chargée) ; échelle 100 000 documents maintenue ; versions SQLite relevées (Python 3.53.1 / Node 3.53.4 / Prisma 3.46.0, journal DELETE partout).
- **Chantier 6 — Documentation** : `ROLES_ET_PERMISSIONS.md` (matrice RBAC réelle, source `RIGHTS`) ; compléments RUNBOOK P6.1–P6.5 ; docs historiques déplacés vers `docs/historique/`.
- Batteries complètes P6 : régression runtime 327 PASS ; HTTP 7/7 ; matrice API 543/0 ; concurrence 14/14 ; sc-ventes 12/12 et 3/3 ; six mois 46 cas/0 échec ; anti-fuites 40/40 ; Playwright 3/3 ; reprise industrielle intégrale ; E2E navigateur réel.
- Version livrée : 18.9.13-p6.15.30-rc. Statut : voir le procès-verbal d'homologation P6 (ZIP 3) — recette sur site SODEPI (Windows, LAN, tablettes, impression) toujours obligatoire avant production.

## 11/11/2026 — CONTRE-AUDIT INDUSTRIEL 360° P5.15.29 — P0 écrits + P1 concurrence corrigés — P3-RC

- Mission de contre-audit contradictoire sur l'archive P5.15.29-P2-RC ; journal complet dans `RAPPORT_CONTRE_AUDIT_P51529_P3.md`, preuves et homologation dans le dossier d'audit (ZIP 3).
- **P0-01 (bloquant, découverte par exécution réelle des tests jamais joués)** : `PRAGMA busy_timeout=5000` via `$executeRawUnsafe` rejeté par le moteur Prisma 6.19.3 (P2010 « Execute returned results ») → pré-vol rejeté → TOUTES les écritures applicatives renvoyaient 409. Corrigé par `$queryRawUnsafe` + test permanent `tests/preflight-p51529.test.cjs` (4 tests) ; OF-SNAP-01 passe de FAIL à PASS ; recettes HTTP 7/7.
- **P1-01** : erreurs moteur transitoires multi-processus (5898 « File being deleted », P1008 socket timeout, SQLITE_CORRUPT transitoire sous contention) non rattrapées → échecs intermittents de la matrice de concurrence (20-24/25). `retryable()` étendu ; acteur figé après accessGate dans POST /api/orders (TypeError sous contention éliminé). Matrice 14/14 × 2 runs ; rafales 25/25 × 3. Mono-instance : 75/75 même avant correctif (mode de déploiement SODEPI nominal).
- **P2-01** : 5 harnais de recette HTTP bloqués par la garde anti-démo (jamais rejoués depuis son durcissement) — GOCMD_ALLOW_DEMO_DB ajouté (recettes locales sur base jetable uniquement). **P3-01** : contrat statique SEP-001 mis à jour et renforcé après figage d'acteur.
- Batteries complètes rejouées sur P3-RC : tsc/lint/build EXIT 0 ; régression runtime 325 PASS ; HTTP 7/7 + matrice 542/0 + sc-ventes 12/12 et 3/3 + recette métier ; concurrence 14/14 ×2 + multiprocess + anti-fuites ; échelle 100 000 ; simulation mensuelle vérifiée ; Playwright 3/3 ×2 ; **reprise industrielle intégrale §5** (21 commandes/21 OF/réservation/réception partielle/facture/PDF privé ; sauvegarde pendant charge ; restauration sur installation distincte ; empreintes A=B=manifeste ; écriture post-restauration ; gardes négatives).
- Nouveau kit `deploy/windows/` (service WinSW, installation + ACL + contrôle préalable, supervision quotidienne, sauvegardes planifiées, scénarios réseau §7) — À VALIDER SUR SITE.
- Version livrée : 18.9.13-p5.15.29-p3-rc. Statut : HOMOLOGATION CONDITIONNELLE RECOMMANDÉE (B) — recette sur site SODEPI obligatoire avant production.

## 10/11/2026 — HOMOLOGATION TECHNIQUE P5.15.27-B — 13 anomalies corrigées, batteries complètes

- Mission d'audit contradictoire 360° sur l'archive RC ; deux vagues de correctifs (A : reprise de session interrompue ; B : présente mission), journal complet dans `CORRECTIONS_HOMOLOGATION_P51527B.md`.
- Anomalies corrigées et contre-testées : AN-AF-01 (anti-fuites AUD-B1), AN-SC-05/07/08/13/14/15 (recettes ventes), AN-CLT-04 (concurrence OF : amorce DPR, prix dynamique, cycle §7, rôle magasinier), AN-O2C-01 (montants dynamiques simulation), AN-NEGOCE-01 (tarif négoce par proposition + visa directeur), AN-FIN-04 (troisième compte finance pour solder un remboursement), AN-MOIS-01/02/03 (recette mensuelle sur base administrée, issues recalculées, qualification préalable).
- Aucune garde produit affaiblie : chaque contournement passe par le circuit métier réel ; gardes inchangées (intégrité, FK, sur-réservation zéro, stocks négatifs interdits, 12 refus attendus, quatre-yeux).
- Batteries : régression 88/88 ; build/lint/tsc EXIT=0 (129 erreurs TS au départ → 0) ; HTTP 7/7 + matrice 542 requêtes/0 échec + sc-ventes 12/12 et 3/3 ; Playwright 3/3 ; concurrence 14/14 + CLT-04 (1 et 2 processus) + multiprocess ; échelle 100 000 documents (pages 665–893 ms) ; simulation 6 mois 46/46 cas ; recette mensuelle PASS (44 DA / 43 BC / 69 devis PDF) ; sauvegarde + restauration démontrées (serveur opérationnel sur base restaurée).
- Version livrée : 18.9.13-p5.15.27-b. Statut : HOMOLOGABLE TECHNIQUEMENT, sous réserve de la validation métier sur site (déploiement Windows, LAN, impression : À VALIDER SUR SITE).

## 10/11/2026 — AUDIT ANTI-FUITES 360° (DMAIC/AMDEC) — 12 correctifs + tests de non-régression

- **P1 DB-MIG-01** : `apply_catalogue_upgrade_v1893.py` désormais transactionnel (BEGIN IMMEDIATE/ROLLBACK) avec sauvegarde fraîche horodatée à chaque exécution (l'ancienne sauvegarde fixe était sautée si déjà présente).
- **P1 DB-HIST-02** : `Material` protégé contre la suppression physique (trigger `gocmd_no_hard_delete_material` + `onDelete: Restrict` sur `Movement.material`) — un DELETE SQL direct détachait silencieusement l'historique des mouvements (DDL réel ON DELETE SET NULL). Garde au démarrage portée à 20/20.
- **P2 OF-SNAP-01 (règle SODEPI §7)** : snapshot OF complété — `upholstery`, `foamLayers` (couches des mélanges), `foamNature`, `foamGrade`, `foamDensity` et dimensions catalogue désormais transmis intégralement aux OF. Test : `npm run test:of-snapshot:p51524`.
- **P2 DB-IDX-01** : 37 index créés (22 FK critiques + 15 index Prisma déclarés mais absents de la base) — réconciliation totale schéma ↔ SQLite. Migration additive : `npm run db:upgrade:fk-indexes` ; test : `npm run test:fk-indexes:p51524`.
- **P3 SEC-ERR-01** : messages d'erreur de `/api/me/password` et `/api/admin/users` filtrés par liste blanche (plus de divulgation d'erreurs SQLite/infrastructure).
- **P3 FIN-4E-01** : quatre-yeux étendu au règlement des remboursements fournisseurs — l'approbateur de l'avoir ne peut plus solder la créance qu'il a ouverte.
- **P3 CONC-MVT-01** : verrou d'écriture SQLite posé avant lecture du lot dans `/api/movements` (même convention que reserve-stock / prepare-OF).
- **P3 SEC-READ-01** : `GET /api/p2p/replenishment` réservé aux rôles supply-chain (référencement fournisseur-matière et délais) — comme `p2p/overview`.
- **PKG-01** : scripts npm `test:db-safety:p51523` / `test:demo-reseed:p51523` réparés (fichier de test inexistant dans l'archive livrée).
- **TEST-SC13/SC14/DEF-R9** : recettes SC-13..15 et v1899 corrigées — elles ÉCHOUAIENT sur l'archive livrée elle-même (divergences spéc/code arbitrées selon la règle §7 « aucune deuxième approbation commerciale des OF » ; garde tarifaire du devis exercée à l'ENVOI).
- **E2E-LOGIN** : harnais Playwright fiabilisé (attente de session réellement établie) et lanceur autonome (GOCMD_ALLOW_DEMO_DB géré par le lanceur sur copie jetable).
- **Nouveau harnais d'audit anti-fuites** : `npm run test:audit:anti-fuites` — 39 contrôles dynamiques sur serveur isolé dont les deux cas obligatoires (prix 2000→1500 MAD sans visa directeur ; double réservation 2×4 matelas sur stock de 4).
- Rapport complet : `PREUVES_AUDIT_20261110/` (livrable ZIP audit) ; risques résiduels documentés (avoir libre, fret fournisseur, TVA achats, CUMP au prix BC, verrouillage de compte à distance, TTL réservations…).

## 09/11/2026 — Correctif transversal sécurité, OF, CI et localisation MP (RC, NON homologuée)

- Décisions de prix sur devis/commandes : rôle directeur ET permission explicite `director.prices` pour les comptes gérés.
- Référencement matière-fournisseur : masquer `unitPrice` à la sortie API si `costs.read` est refusé ; tests de DTO ajoutés.
- Ancien test OF et recettes SC/HTTP/E2E actualisés pour les OF générés après confirmation, sans second visa, et les prix catalogue réels ; CI bloquante enrichie.
- Sortie MP : affichage des emplacements enregistrés au magasinier autorisé, sans étiquette obligatoire, avec avertissement de multi-emplacement.
- Base démo préservée ; aucune décision non arbitrée sur la qualité n'a été imposée.
- Rapport : `CLOTURE_CORRECTIFS_TRANSVERSAUX_20261109.md` ; tests HTTP/Playwright/build non réexécutés dans l'environnement de correction.

## 2026-11-09 — Circuit commercial SODEPI simplifié (candidate RC)
- Commande directe au prix catalogue : confirmation immédiate, CMD + OF activés atomiquement.
- Devis facultatif : brouillon → visa directeur si prix exceptionnel → envoi → acceptation client référencée → conversion en commande.
- Prix modifié sur catalogue : visa directeur sur les lignes de la commande, sans modifier le catalogue ; contrôle à quatre yeux ; aucun OF avant accord.
- Dimension ou composition personnalisée (ex. tissu gris, mousse HR35) : demande de contrôle technique, données figées dans ligne/OF/étiquette.
- OF d'une commande confirmée directement utilisables, sans deuxième approbation commerciale ; préparation par magasinier depuis « Stock matières ».
- Suspension : libération des réservations et nouvelle préparation requise après reprise, sans nouvelle approbation commerciale.
- Migration additive SQLite : `npm run db:upgrade:commercial-demo` sur **copie démo seulement**. Les anciennes commandes ne sont pas converties automatiquement.
- Vérifications ici : parsing TS/TSX, tests des droits/contrats, intégrité DB. **Build, Prisma Client, API HTTP et Playwright à relancer sur machine équipée de Bun et dépendances.**

## Correctif autorisations OF — 09/11/2026

- Correction du blocage de validation des OF : le rôle `approver` n'a plus besoin du rôle `sales` et de la permission `sales.orders` pour les opérations d'OF.
- L'approbateur peut consulter la vue des commandes, avec `clients.read`, sans pouvoir créer une commande, l'avancer commercialement ou livrer.
- L'API GET des commandes et des OF accepte les approbateurs habilités. La séparation des tâches (`createdBy !== actor`) reste imposée côté serveur.
- Tests de droits ajoutés à la régression, avec comptes `approver` seuls dans les scénarios HTTP existants. Aucune migration ni modification des données de démonstration.

## P5.15.23 — Clôture CI et nettoyage ciblé (2026-11-09)

- **CI-01 (P1)** : insertion des 11 régressions historiques `p56` → `p5133` dans la chaîne **canonique** `test:regression:runtime`, donc dans `test:regression` utilisée par la CI. Le test `p5132` est en lecture seule sur la base démo.
- **CI-02 (P2)** : ajout du scénario `test:sc-ventes:p51523` (SC-13..15, base jetable) comme étape **bloquante** GitHub Actions.
- **CI-03 (P2)** : lanceur `run-regression-chunks.sh` portable depuis tout dossier, journalisation conservée, échecs immédiatement propagés, `p5132` ajouté au découpage.
- **CI-04 (P3)** : correction du document d'intégrité et régénération du manifeste du livrable.
- **Contrôle durable** : test `test:ci:coverage:p51523` prévient une nouvelle omission. Fichiers caches `__pycache__/*.pyc` supprimés, preuves historiques et source conservées.
- Aucune modification des règles métier, des routes, des migrations ou de `db/custom.db`. Voir `CLOTURE_CI_P51523.md` pour les preuves fraîches et les limitations.

## P5.15.23 FINAL — Audit 360°, corrections AN-01..AN-09, recette complète (2026-11-09)

Archive d'entrée : `GoCmd_P5_15_23_PROJET_NETTOYE_DOCUMENTATION_RC.zip`
(SHA-256 `aff2ac02ef54a2307490d3a45c4627d74d8075a06e43faa9633ce763b72059c4`).
Audit final indépendant : validation d'archive (manifeste 726/726), audit de
code complet, exécution réelle de toute la chaîne de tests, recette métier
étendue, simulation six mois, audit UX navigateur, comparaison ERP/normes.

- **AN-05 (P1)** : 11 étapes de régression (v18913p56→p5133) étaient
  silencieusement omises des journaux de preuve P5.15.21/P5.15.22
  (« 57 étapes, 0 échec ») — la vraie chaîne canonique compte 67 étapes
  runtime. Corrigé par l'exécution intégrale documentée
  (`scripts/run-regression-chunks.sh`, codes de sortie par étape) ;
  la CI GitHub reste l'unique référence.
- **AN-01..AN-04, AN-06 (P3/P2)** : 5 tests de contrat statique figés sur
  d'anciens instantanés de code/jeu démo (garde devis centralisée et renforcée,
  statut `partially_approved`, `revisionNo`, attribution déplacée dans
  `AwardPlanPanel`, jeu démo V16+) — assertions resynchronisées sur les
  mécanismes réels, intentions conservées et souvent renforcées ; échecs
  initiaux et rejeux PASS documentés.
- **AN-07/AN-08 (P3)** : suppression de 2 constantes mortes
  (`erp-server.ts`) et correction du commentaire de schéma du verrou
  `GOCMD_STOCK_RESERVATION_LOCK`. Aucun changement métier.
- **AN-09 (P2)** : création des scénarios métier SC-13/14/15 exigés par la
  mission d'homologation (`tests/sc-recette-ventes-p51523.cjs`,
  `test:sc-ventes:p51523`) : modification de CMD après OF, mouvement concurrent
  de stock avant livraison, crash/redémarrage/reprise.
- **Exécutions réussies** : tsc, eslint, build production, régression 68/68
  (vraie chaîne), suites P5.15.21/23, 7 recettes HTTP, matrice RBAC 485
  requêtes/0 fuite, concurrence 14/14 (dont SIGKILL), multiprocessus,
  OF-matelas [200,409]×2, SC-01..SC-15 (15/15), six mois 46/46, E2E 3/3
  (chromium-1254 installé), migrations idempotentes sur copie,
  sauvegarde/restauration avec redémarrage applicatif, UX navigateur
  (13 écrans). Base démo préservée à l'identique
  (`74970861de5e9a8ed6f231089bfb3336aa584fa19d330374366676c9b49f8b2c`).
- **Livrables** : `AUDIT_FINAL_P51523/RAPPORT_FINAL_P51523.md`, registre DMAIC
  et AMDEC dans `preuves/audit-final/`, comparaison ERP/normes sourcée,
  instructions Windows inchangées. **Statut : validé techniquement pour
  recette, NON HOMOLOGUÉ production** (conditions au rapport final §12).

## P5.15.23 — Nettoyage documentaire contrôlé (2026-11-08)

Aucun changement de code, de migration, de test, de base de données, d'asset ou de paramétrage. Le README et les notices actives sont mis en cohérence avec `18.9.13-p5.15.23` ; la frontière OF simplifié GoCmd / fabrication complète GoProd est clarifiée. Une notice de consolidation ancienne est déplacée sous `docs/historique/` ; deux doublons stricts non référencés sont supprimés, les exemplaires originaux sont conservés. Manifeste SHA-256 reconstruit et rapport d'opérations disponible dans `docs/NETTOYAGE_P51523.md`.

## P5.15.22 — Clôture RC ventes, corrections CLT-01..CLT-05 (2026-11-08)

Archive d'entrée : `GoCmd_P5_15_21_VENTES_FINAL_RC.zip`
(SHA-256 `32d19d6071b3c2f1e1232cb2a21599950a534b1eeec8443282a6e570ad932c3d`).
Clôture demandée : quatre corrections ciblées sans refonte (CLT-01..CLT-04),
plus une cinquième anomalie découverte et corrigée pendant l'exécution réelle
(CLT-05), puis exécution réelle intégrale (TypeScript, ESLint, build,
SC-01..SC-12, E2E, concurrence, régression complète). Circuit CMD → OF
automatiques → livraison → facturation, gabarits et étiquettes conservés
intégralement ; base démo préservée (empreinte `ce08167c…` identique
avant/après).

- **CLT-01 (P2, corrigé — tests)** : `tests/run-e2e-playwright.cjs` ne
  garantissait ni l'arrêt propre du serveur ni un code de sortie fiable —
  `start-gocmd-checked.cjs` lance `next start` comme PETIT-FILS via
  `spawnSync`, le signal n'était envoyé qu'à l'enfant direct : le serveur
  Next survivait, les tubes stdout/stderr restaient ouverts et l'orchestrateur
  ne rendait jamais la main (timeout externe nécessaire après la réussite des
  tests). Correction : arrêt par signaux au GROUPE de processus entier
  (`process.kill(-pid)` SIGTERM puis SIGKILL, `taskkill /T` sous Windows),
  destruction des flux hérités, délai de grâce borné, `process.exit(code)`
  explicite (0 réussite / 1 échec / 2 précondition) et gestion SIGINT/SIGTERM.
  Preuve : E2E **3/3 PASS en 23 s, sortie immédiate code 0, zéro processus
  serveur résiduel** (journal `PREUVES_CLOTURE_RC/11-e2e-playwright.log`).
- **CLT-02 (P2, corrigé — CI)** : les tests Playwright étaient absents du
  pipeline GitHub Actions (`.github/workflows/ci.yml`) — un échec navigateur
  ne pouvait pas bloquer la CI. Correction : cache du navigateur
  (`~/.cache/ms-playwright`, clé sur `bun.lock`), installation
  `bunx playwright install --with-deps chromium`, puis étape bloquante
  `bun run test:e2e` après le build de production (tout code de sortie non
  nul fait échouer le job). L'étape de concurrence CLT-04 ajoutée au même
  pipeline.
- **CLT-03 (P3, corrigé — documentation)** : comptages faux dans le rapport
  final RC — §4 annonçait « 696 fichiers (695 + manifeste) » et « 695/695
  OK » alors que l'archive livrée contient **698 fichiers** (697 + manifeste)
  et que le manifeste vérifie **697/697**. Rapport corrigé et complété par la
  section clôture (§8) ; manifeste `SHA256SUMS.txt` régénéré sur l'archive
  consolidée finale.
- **CLT-04 (P1, corrigé — application)** : **double allocation potentielle du
  stock fini de matelas à la préparation d'OF** — `PATCH /api/work-orders/:id
  {action:"prepare"}` (branche MATELAS) vérifiait uniquement la somme des lots
  disponibles, sans retrancher les quantités déjà engagées par d'autres OF
  terminés non livrés : deux OF demandant chacun 4 matelas sur un stock de 4
  étaient **tous deux déclarés disponibles** (reproduction prouvée : course
  simultanée `[200, 200]` avant correction). Correction : verrou d'écriture
  SQLite pris AVANT toute lecture de stock (`GOCMD_OF_PREPARE_LOCK`, même
  convention que `reserve-stock`), puis déduction des reliquats non livrés des
  autres lignes OF terminés du même produit (commandes non clôturées) ;
  refus 409 `STOCK_NOT_AVAILABLE_FOR_PREPARATION` si le reliquat libre est
  insuffisant. Sémantique négoce et livraison atomique inchangées (SC-08
  valide). Preuves : nouveau test
  `tests/test-of-matelas-concurrency-p51522.cjs` (`test:of-concurrency:p51522`)
  — course simultanée sur un processus **[200, 409]**, course à travers
  **deux** processus serveur **[200, 409]**, stock jamais débité par
  « préparer », commande perdante non lançable, intégrité/FK OK ; échec
  démontré sur le code d'origine (`[200, 200]`,
  `PREUVES_CLOTURE_RC/09b-of-concurrency-avant-correction.log`) ; SC-01..12
  rejouées 12/12.
- **CLT-05 (P1, corrigé — test, découvert en exécution)** : même classe que
  FA-06 — l'orchestrateur `tests/run-http-recipes-v1899.cjs` (`test:http:all`)
  ne configurait pas `GOCMD_SALES_TAX_RATES_BPS` pour son serveur : sur
  environnement propre (sans `.env` local), la recette ventes
  `http-sales-recipe.cjs` échouait (facturation 409 « Taux de TVA absent de
  la configuration SODEPI ») — l'ancien PASS reposait sur un `.env` local
  retiré de l'archive, et cette recette n'avait pas été rejouée par la
  finalisation précédente. Correction : barème explicite par défaut `'0,2000'`
  (surchargeable), même convention que FA-06. Preuve : rejeu
  `test:http:all` **7/7 recettes PASS** (journal
  `PREUVES_CLOTURE_RC/13-concurrence.log`).

Revalidation intégrale exécutée après corrections (journaux
`PREUVES_CLOTURE_RC/`) : install verrouillée 489 paquets, prisma validate +
generate, `tsc --noEmit` exit 0, `eslint .` exit 0, build production exit 0,
régression complète (57 étapes, 0 échec), SC-01..SC-12 (12/12, 108 requêtes),
concurrence OF matelas (22 requêtes, 2 phases), E2E Playwright 3/3, matrice de
concurrence 14/14, multiprocessus, 7 recettes HTTP (après CLT-05), RBAC +
matrice confidentialité 485 requêtes/0 fuite, simulation six mois 46/46.
Aucune homologation de production déclarée : la recette SODEPI reste requise
(§6 du rapport final RC).

## P5.15.21 — Finalisation RC ventes, contre-audit final FA-01..FA-06 (2026-11-08)

Archive d'entrée : `GoCmd_P5_15_21_VENTES_AUDITEES_CORRIGEES.zip`
(SHA-256 `5a037df5629ef539fcd1f07f4aaa4112ccc40b36cd1b7e9e0ac89caf3d1985b5`).
Dernier contre-audit indépendant avant consolidation : aucune règle métier
SODEPI modifiée, aucun module refondu, base démo préservée, formulaire
commercial inchangé.

- **FA-01 (P3, corrigé — documentation)** : incohérence du nombre de
  corrections annoncées — le rapport du contre-audit ventes annonçait « 8
  anomalies corrigées (AV-01..AV-08) » alors que le registre DMAIC, le
  CHANGELOG et sa propre §18 documentent 9 corrections (AV-01..AV-09, dont
  AV-09 « exemption lint »). Rapport aligné : §1 (9 corrigées), §15 (17 modes
  AMDEC au lieu de 16), §16 (ligne `eslint.config.mjs`/AV-09 ajoutée), §17
  (AV-04..09 clos).
- **FA-02 (P3, corrigé — documentation)** : entrée CHANGELOG du contre-audit
  ventes incohérente — titre « AV-01..AV-04 » et bullets AV-05..AV-08
  (corrections de tests figés) absents. Titre corrigé en AV-01..AV-09 et les
  4 bullets ajoutés conformément au registre DMAIC.
- **FA-03 (P3, corrigé — packaging)** : `tsconfig.tsbuildinfo` (cache de
  build TypeScript, 220 Ko) livré dans l'archive alors qu'il est ignoré par
  `.gitignore`. Supprimé ; manifeste SHA-256 régénéré.
- **FA-04 (P3, corrigé — documentation)** : README et TESTS.md périmés — le
  README affirmait « pas de build complet, tests HTTP… validés ici »
  (contredit par les preuves du contre-audit ventes) et ignorait les dossiers
  `CONTRE_AUDIT_VENTES_20261108/`/`PREUVES_AUDIT_VENTES/` ; TESTS.md
  affirmait que la base livrée n'était pas migrée (faux depuis AV-02). Les
  deux fichiers alignés sur l'état réel ; suite E2E Playwright documentée
  dans TESTS.md.
- **FA-05 (P2, corrigé — tests)** : la suite E2E Playwright du circuit ventes
  (`playwright.config.ts`, `tests/e2e/sales-circuit.spec.ts`,
  `tests/run-e2e-playwright.cjs`, script `test:e2e`, dépendance
  `@playwright/test@1.65.0`) avait été retirée sans déclaration de l'archive
  livrée, alors que le contre-audit ventes revendiquait des « tests
  inchangés ». Restauration à l'identique depuis la RC d'entrée, `bun.lock`
  régénéré (même version épinglée 1.65.0). La suite — jamais exécutée
  auparavant — a demandé dix itérations d'alignement des sélecteurs sur
  l'UI réelle (rôle bouton des lignes catalogue, filtre famille, labels sans
  for/id, règle /u une-pièce, croix du dialog, rendu asynchrone) avant de
  passer : **3/3 PASS en 20,6 s** (T1 saisie+OF+étiquettes, T2 quatre-yeux,
  T3 TVA+règlement 403/quatre-yeux+solde 0,00 MAD).
- **FA-06 (P1, corrigé — test, découvert en revalidation)** : la simulation
  six mois (`tests/http-purchasing-dmaic.cjs`) échouait sur archive extraite
  (O2C-BILL 409 « Taux de TVA absent de la configuration », BILAN failed:3) —
  l'ancien PASS s'appuyait sur un `.env` local depuis retiré de l'archive, et
  la vérification finale de l'archive n'avait pas rejoué cette simulation. Le
  serveur de la simulation configure désormais explicitement
  `GOCMD_SALES_TAX_RATES_BPS` (défaut `'0,2000'`, surchargeable) ; aucun code
  applicatif modifié, la politique TVA reste bloquée par défaut en production.

## P5.15.21 — Contre-audit ventes, corrections AV-01..AV-09 (2026-11-08)

Archive d'entrée : `GoCmd_P5_15_21_VENTES_CORRIGEES_RC_20261108.zip`
(SHA-256 `8a07ea00a21099482f35d4786fc0b45820367ed242d6c3155660df65eed1a0b6`).
Exécution réelle complète : installation, prisma, tsc, eslint, build, tests
statiques, recettes HTTP, simulation six mois, recette métier SC-01..SC-12.

- **AV-01 (P1, corrigé)** : `POST /api/sales {action:"invoice"}` — include
  Prisma `invoiceLine` imbriqué au mauvais niveau (`OrderLine` au lieu de la
  ligne de BL) → `tsc` et build de production ÉCHOUAIENT et la facturation
  depuis BL tombait en erreur de validation Prisma. Correction d'une ligne ;
  preuve : build PASS + recette `http-sales-recipe` (facture, avoir, paiement,
  statut `settled`).
- **AV-02 (P1, corrigé)** : la procédure CI officielle n'appliquait pas la
  migration `WorkOrder` et la base de démonstration livrée n'était pas migrée
  P5.15.21 → **toute création de commande échouait en 409** (table OF absente),
  dès la conversion d'un devis. Corrections : garde-fou de démarrage étendu
  (tables ventes P5.15.21 exigées, remédiation explicite), étape de migration
  OF+avoirs ajoutée à `ci.yml`, base de démonstration migrée (données
  intégralement préservées, comptes identiques, intégrité OK), test de
  régression `test:startup-guard:p51521`.
- **AV-03 (P1, corrigé)** : les recettes HTTP ventes (`http-sales-recipe`,
  simulation six mois `six-months-sales`) n'avaient pas été mises à jour pour
  le workflow OF automatique → échec à l'avancement (`WORK_ORDERS_NOT_APPROVED`)
  et à la livraison (`OF_INCOMPLETE_OR_MISSING`). Corrections : cycle de vie OF
  (quatre-yeux, approve/start/complete, prepare négoce) intégré aux recettes,
  compte de recette `SALES_APPROVER` (sales+approver) dans l'orchestrateur et
  `saleschief` dans la simulation ; assertions OF (1 OF/ligne, brouillon,
  pièces, quatre-yeux) ajoutées.
- **AV-09 (P3, corrigé)** : exemption ESLint étendue à
  `PREUVES_AUDIT_VENTES/**/*.cjs` — l'outil de reproduction de preuve (CJS)
  faisait échouer `lint` sur l'archive reconditionnée.
- **AV-04 (P3, corrigé)** : commentaire obsolète du compteur
  `SalesDocCounter` (anciennes clés QUOTE/DELIVERY/INVOICE/CREDIT) remplacé par
  les clés réelles.
- **AV-05 (P3, corrigé — test)** : `test_v189_remediation.py` figé sur
  l'ancien défaut UI TVA 20 % — assertions réalignées sur l'arbitrage du
  08/11/2026 (aucun taux implicite, sélecteur vide restreint aux taux
  autorisés `GOCMD_SALES_TAX_RATES_BPS`).
- **AV-06 (P3, corrigé — test)** : `test_v18910_ux_contract.py` UX-022 trop
  large (10 px interdits partout) — assertion recentrée sur l'avertissement
  atelier (`text-xs`), les valeurs imprimées des étiquettes restant légitimement
  en 10 px.
- **AV-07 (P3, corrigé — test)** : `test_p51521_work_orders_upgrade.py`
  dépendant de l'état de la base livrée — `DROP TABLE IF EXISTS` explicite
  avant de forcer l'état hérité, le chemin d'élargissement est vérifié quel que
  soit l'état de la base.
- **AV-08 (P3, corrigé — test)** : contrôle FEFO-001 figé à « exactement 3
  tris » — étendu à TOUS les tris `expiresAt` du circuit ventes (5/5 avec
  `nulls:"last"`), aucun tri nu toléré.
- **Nouveau** : `tests/sc-recette-ventes-p51521.cjs` — recette métier
  SC-01..SC-12 du contre-audit (commande stockée, salon 9 pièces 8+1, matelas
  7/11 sans dessin, commande mixte, produit spécial visa directeur, reliquat
  10/4+6, concurrence même lot, annulation/audit, livraison partielle,
  retour→qualité→avoir, refus d'accès) sur serveur de production isolé.
  Script `test:sc-ventes:p51521` + étape CI dédiée.
- Constat de non-régression : ESLint, 137 fichiers de tests existants et
  matrices de sécurité inchangés et re-exécutés avec succès après corrections.
- Anomalies vérifiées non fondées : le CHECK `FinishedStockMovement.type`
  inclut bien `available` (écrit par les retours) — signalement de cartographie
  écarté avec preuve.
- Anomalies documentées non corrigées (décision métier ou P3 assumé) :
  plancher de prix catalogue absent (P2, arbitrage SODEPI), asymétrie de garde
  OF avancement/livraison (P3, commentée dans le code), `reactivate` OF réécrit
  `createdBy` (P3), double compteur MFP (P3), champs morts `OrderPiece.status`
  et `LabelSheet` (P3), GOCMD_PUBLIC_ORIGIN requis en production pour
  l'anti-DNS-rebinding (P2 déploiement).

# CHANGELOG — GoCmd / SODEPI

## P5.15.21 RC — OF simplifiés et étiquettes atelier (08/11/2026)

- OF par ligne fabriquée, suivi `draft → approved → in_progress → completed`, double validation.
- Numérotation transactionnelle et unicité par ligne ; liaison à la commande.
- Planche A4 2×4 (8 étiquettes), gabarit coté uniquement pour pièces non standards ; **matelas sans dessin**.
- Nouvelle migration SQLite additive avec sauvegarde externe obligatoire et dry-run par défaut.
- Tests de 9/7/11 pièces, schéma, unicité et clés étrangères sur base copiée ; CI étendue.
- GoProd, nomenclatures, sorties matières non modifiés ; aucun changement de stock par un OF.
- Le build et l'impression via Next.js ne sont pas homologués dans cet environnement sans dépendances.

# CHANGELOG — GoCmd / SODEPI

## P5.15.21 RC — contrôle qualité de livraison (2026-11-08)

- CI : gate `test:p51521` ajoutée après le build de production ;
  gate `test:audit:quality` pour DMAIC et AMDEC.
- `test:regression:runtime` inclut désormais P5.14.7 ; test maintenu pour
  téléphone sans PDF après validation acheteur, offre e-mail et PDF.
- Registre DMAIC : 5 colonnes `analyze` manquantes restaurées avec causes racines explicitées.
- AMDEC : 6 statuts « risque accepté documenté » remplacés par
  « en attente d'arbitrage SODEPI », sans décision inventée.
- Fiche de décisions métier et addendum de contre-audit ajoutés.
- Aucun fichier applicatif ni donnée de démonstration modifié.

## P5.15.21 RC — Audit industriel final (2026-11-08)

Archive de départ : `GoCmd_P5_15_21_PROJET_NETTOYE_DOCUMENTATION_RC.zip`
(SHA-256 `22a59f7600c6b5dc577fcc4669d1ff46860c63cb742dc58ae8d71654dfb1e120`).
Branche d'audit : `audit/p51521-rc-final` (Git local du dossier consolidé).

### Corrections appliquées et vérifiées (registre DMAIC complet : `AUDIT_FINAL_P51521/REGISTRE_DMAIC.csv`)

| ID | Gravité | Correction | Preuve de non-régression |
|---|---|---|---|
| DMAIC-001 | P2 | `.gitignore` : exception `!.env.example` restaurée (perdue au nettoyage documentaire) | régression complète 229 contrôles |
| DMAIC-002 | P2 | Harnais six-mois conforme SEP-002 : paiements via compte distinct, tests explicites du 403 | 46/46 cas six mois |
| DMAIC-003 | P2 | Recette HTTP ventes : même cause racine corrigée | 7/7 recettes HTTP |
| DMAIC-004 / DEF-A-01 | P2 | **Plafond d'attribution contractuelle re-vérifié à la révision ET à l'approbation du BC** (la garde `CONTRACT_AWARD_REQUIRED` n'existait qu'à la création) | test dédié `test:defa01` (contournement 60→100 refusé aux deux niveaux) |
| DMAIC-005 / DEF-S-05 | P3 | PRAGMA SQLite appliqués en attente + exposés + pré-vol déterministe dans la file d'écritures | tests gardes P5.15.21 |
| DMAIC-006 / DEF-S-01 | P2 | `db:push` redirigé vers le garde de refus (`scripts/refuse-unsafe-schema-change.cjs`) | script exécutable |
| DMAIC-007 / DEF-S-02 | P2 | Rôle `admin` pur retiré de `p2p/awards` et `p2p/sourcing` (rôles métier requis) | matrice API 421 requêtes |
| DMAIC-008 / DEF-S-11 | P3 | `poweredByHeader:false` (suppression `X-Powered-By`) | en-têtes vérifiés |
| DMAIC-009 / DEF-V-05 | P3 | **Analysé puis REVERTU** : exclusion du directeur du répertoire clients = règle métier testée (v189 épingle `sales||finance`) ; recommandation documentée pour décision SODEPI | régression v189 |
| DMAIC-010 / DEF-A-06 | P3 | Message explicite sur BL dupliqué | test BL |

### Anomalies résiduelles documentées (non corrigées sans décision métier SODEPI)

24 défauts documentés dans `AUDIT_FINAL_P51521/MATRICE_AUDIT_CODE_COMPLET.csv` et
`AUDIT_FINAL_P51521/AMDEC_P51521.csv` — notamment DEF-A-02 (liaison plan↔BC par
préfixe de note), DEF-A-03 (facture « matched » sans issue de rejet), DEF-A-04
(FEFO non imposé en sortie manuelle), DEF-V-01/02/03/04 (évolutions finance/ventes).
Chaque correction exige une décision métier conforme à la doctrine
(`fsnw/POLITIQUE_SODEPI_ACTUELLE.md`) : fiabilité avant richesse, pas de
modification arbitraire des règles.

### État des contrôles après audit

- Fermés par preuve d'exécution : HTTP bout-en-bout (7/7), matrice API
  421 requêtes/0 fuite, concurrence multiprocessus CONC-001 (matrice 14/14),
  simulation six mois cumulative (46 cas, 7 snapshots, réconciliation exacte),
  volumétrie 100→100k, régression technique complète (229 contrôles), tsc, lint,
  build production (×3).
- Ouvert : installation Windows réelle (sandbox Linux — scripts revus
  statiquement seulement), recette UX exhaustive 8 résolutions × tous les écrans,
  conformité fiscale marocaine / CNDP 09-08 (professionnels habilités requis).

## Historique antérieur conservé

- P5.15.21 (archive d'origine) : nettoyage documentaire uniquement ; base démo
  migrée (colonne `Order.createdBy`, index `StockLot_material_status_expires_idx`)
  — voir `README_CONSOLIDATION_P51521.md`.
- P5.15.18 et antérieures : voir `fsnw/POLITIQUE_SODEPI_ACTUELLE.md` (§ versions)
  et `docs/README.md`. Les notices historiques (`README_P5_15_18.md`,
  `docs/historique/`) ne sont **pas** des instructions actuelles.


## Correctif de recette — arbitrages approuvés le 08/11/2026 (NON HOMOLOGUÉ)

- Avoirs par lignes : nouvelle table `SalesCreditNoteLine`, migration non destructive, API protégée et interface Finance.
- État de compte client : API Finance, solde chronologique, période, pagination et interface.
- TVA : taux autorisés configurables explicitement, zéro taux fiscal par défaut, validation serveur.
- Réservations : délai/avertissement configurables, alerte et script d'expiration en lecture seule par défaut.
- Protections existantes conservées pour les lots expirés et les anomalies de rapprochement fournisseur.
- Nouveaux tests ciblés et gate CI. Le build et la recette HTTP complète doivent encore être rejoués avec les dépendances.
- Notes de décision : `AUDIT_FINAL_P51521/ARBITRAGES_VALIDES_20261108.md`.

## RC — 08/11/2026 — OF automatiques sur chaque commande validée

- CMD + OF en transaction lors de l'enregistrement commercial standard ou après approbation des références spéciales.
- OF émis pour les lignes fabriquées **et** les articles achetés/revendus, sans demander de mode d'approvisionnement au commercial.
- Étiquette de préparation pour une ligne de négoce sans création artificielle de pièce.
- Validation rapide de préparation à quatre yeux, annulation motivée et réactivation avec journal.
- Blocage de livraison lorsqu'un ordre existant manque ou n'est pas terminé.
- Reprise sécurisée des anciennes tables WorkOrder et contrôle SQL du lien CMD/ligne.
- Nouveaux tests ciblés et rapport `AUDIT_FINAL_P51521/RAPPORT_CORRECTION_AUTO_OF_20261108.md`.
- **Version RC : pas d'homologation production.**


## 08/11/2026 — Contre-audit ventes, RC de correction VEN

- VEN-01 : lots de matelas finis distincts des matières, entrée en quarantaine avec libération qualité à quatre yeux, déduction par BL et traçabilité de lots, migration additive.
- VEN-02 : photographie des libellés et SKU dans les devis, commandes, BL et factures ; les factures imprimées ne changent plus avec les paiements ; migration additive.
- VEN-03 : retours clients traçables par BL et par pièce, réception, contrôle qualité, réintégration des matelas acceptés seulement. Le retour de matières sans réintégration automatique reste signalé.
- VEN-04 : réservations sur commandes validées `new` ou `production`, indépendamment des autres lignes ; commandes correspondantes visibles à la préparation.
- VEN-07 : OF de préparation vérifie le stock matériel ou les matelas finis, sans mouvement à la création/approbation de l'OF.
- VEN-08 : BL affiche les codes et quantités des lots réellement ventilés.
- Nouveaux tests de migration SQLite, contrôles de non-régression et chaîne CI sur copie. Build et HTTP non exécutés localement.

## P5.15.23 RC — Réservations matelas finis
Réservation physique par lots à la préparation OF ; BL consomme les lots réservés, annulation/suspension libèrent ; gardes SQL anti-surallocation, migration additive et tests de concurrence. Pas de mouvement de stock à la préparation.

## 2026-11-09 — contrôles ciblés intégrité historique, migrations et précision
- Ajout d’une protection SQL activable sur la base métier (19 tables) contre suppressions physiques, sauvegarde externe obligatoire, sans retoucher le schéma ni les données de démonstration.
- Lanceur supervisé pour migrations additives historiques autorisées : préflight sur copie, backup externe, contrôle FK/intégrité et lignes.
- Valorisation : refus des coûts moyens antérieurs négatifs ; recettes CUMP/centimes élargies, sans changement de règle fiscale.
- Tests intégrés à la CI ; `INTEGRITE_HISTORIQUE_P51523.md` précise activation, risques et limites.


## 2026-11-09 — Correctifs sécurité des factures et journaux
- Journaux d'erreur API sans données brutes ni stacks (21 modules TS + utilitaire d'accès SQLite).
- Six triggers SQLite pour l'immutabilité de montants et lignes existantes, intégrés au re-seeding de la DEMO.
- Sauvegarde externe obligatoire pour la migration de facturation opérationnelle.
- Démarrage sécurisé refusé si l'historique/facturation n'est pas protégé.
- Tests de régression historiques resynchronisés avec les autorisations de consultation client/commandes déjà en vigueur.

## P5.15.29-P4-RC (11 novembre 2026) — Contre-corrections indépendantes
- SQLITE_CORRUPT n'est plus traité comme une simple contention réessayable.
- Commandes : Idempotency-Key facultative, persistée et liée à l'auteur ; l'interface web réutilise la clé lors d'un retry du même formulaire.
- Migration additive sans destruction de l'historique, et tests dédiés.
- AMDEC et manifeste livrés dans le dossier rectificatif (27/27 calculs relus).
- **Non homologué** : build et recettes HTTP P4 restent à exécuter sur une installation complète.

## P5.15.29-P5-RC — 11 novembre 2026
- Détection transactionnelle des commandes client potentiellement similaires (client, produits/quantités et date de livraison), sans bloquer les commandes répétées légitimes après justification.
- Unicité du numéro de commande externe normalisé par client, migration additive non destructive.
- Contrôle préalable dans la saisie et confirmation traçable ; conversion de devis protégée.
- Clé d'idempotence P4 et contrôles à quatre yeux conservés. Voir `CORRECTIONS_P51529_P5_LIVRAISON.md`.

## 2026-11-11 — V2 R3, contre-audit 2 (candidate, non homologuée)

- PF : parité seed Python/générateur TypeScript 189/189
- Prix : cohérence ligne/snapshot SHA-256 sous transaction
- Visa directeur indépendant par ligne et UX correspondante
- Pagination matières, CI V2, garde de backup DEMO
- 18 scripts ciblés PASS ; build et recette navigateur non exécutés


## R13.3 (13 novembre 2026) — moteur SQLite unique, nextRef O(1), qualification performance

- **CORR-01 (critique)** : corruption SQLite démontrée en topologie mono-processus
  (écritures node:sqlite des sessions/audits concurrentes des écritures Prisma —
  verrous POSIX par processus). Correctif : `GOCMD_SERVER_RUNTIME=1` (next.config.ts
  + starter) → connexion node:sqlite strictement lecture seule, écritures identités
  via le client Prisma unique (`src/lib/identity-writes.ts`, file serializedSQLiteWrite),
  modèle `GoCmdSession` mappé (aucune migration disque). Test permanent :
  `tests/r133-dual-engine-corruption.test.cjs`.
- **PERF-01** : `nextRef` ne charge plus toutes les références de l'année
  (O(N)) — agrégation SQL `MAX(CAST(SUBSTR(ref,?)))` indexée (0,26 ms à 2 000 commandes).
- **Instrumentation** : `GOCMD_BENCH_SQL_PROFILE=1` (profilage requêtes Prisma,
  défaut off). Harnais benchmark + générateur de bases de recette + suites
  verrou/sauvegarde dans le dossier de preuves R13.3.
- **Documentation** : deploy/windows/PROCEDURE_R13_3.md, deploy/network/
  RESEAU_LOCAL_R13_3.md, compléments Tailscale R13.3, LIVRAISON_R13_3.md.
- Défaut documenté non corrigé (décision métier SODEPI) : D-GEN-01 gabarits
  génériques GEN-MAT/GEN-MOU/GEN-DIV refusés par le trigger taxonomique V16.
