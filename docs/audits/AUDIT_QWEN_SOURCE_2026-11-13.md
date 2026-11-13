# RAPPORT D'AUDIT INDÉPENDANT — GoCmd / SODEPI R13.3 REPRISE
**Avec registre des anomalies, solutions et plan de clôture**

| | |
|---|---|
| **Version auditée** | R13.3 REPRISE — commit `efed13d` (branche `main`, 13/11/2026), dépôt `Jado2024/GoCmD` |
| **Date du rapport** | 13 novembre 2026 |
| **Auditeur** | Auditeur ERP senior indépendant (architecture Next.js/Prisma/SQLite, sécurité, processus P2P/O2C/stocks/finance, PME Maroc) |
| **Environnement d'audit** | Extraction complète du dépôt (665 fichiers) + sandbox Python 3.10 — **sans Node/npm/bun** |
| **Doctrine applicable** | `fsnw/POLITIQUE_SODEPI_ACTUELLE.md` prime sur tout prompt ; GoProd (BOM/MRP/OF industriels) hors périmètre ; statuts : Conforme / Partiel / Non conforme / Non testé / Non applicable |
| **Données** | Tous contrôles destructifs sur **copie jetable** de la DEMO fictive ; aucune donnée réelle touchée ; GEN-DIV non étendu ; aucune modification UX |

---

## 1. RÉSUMÉ EXÉCUTIF — 4 VERDICTS SÉPARÉS + DÉCISION

| Axe | Verdict | Base de preuve |
|---|---|---|
| **Logiciel** | **GO technique conditionnel — confirmé, réserves renforcées** | Architecture défensive vérifiée en revue de code (écrivain Prisma unique CORR-01, fail-closed, RBAC serveur, quatre yeux, visa `director`, CSP à nonce, anti-injection CSV, TVA non présumée). 2 causes racines identifiées : A-03 (401 = erreur d'infrastructure masquée) et A-01 (tri par sous-requêtes corrélées, plein scan démontré en SQL). Chaîne `npm ci → build → tests` : **Non testée** dans cette campagne. |
| **Données** | **Conforme (DEMO)** / **Non conforme (production)** | Exécuté : SHA-256 `db/custom.db` = `65288ab6a380d3b9a7d8f8b3447fe011d01f674eca4c60efc19d310abf06545d` **identique au manifeste README** ; `PRAGMA integrity_check = ok` ; `foreign_key_check = 0` ; journal `delete` ; 74 tables. **Mais `db/production-blank.db` absent** → installation production impossible en l'état (P0). |
| **Terrain** | **NO-GO** | Windows/WinSW, HTTPS privé Tailscale, sauvegarde/restauration sur site, charge sur matériel cible : **Non testés**, aucun PV. Les chiffres 5 080 ms / 1 687 ms proviennent des journaux fournis (sandbox 2 vCPU), pas de mesures reconfirmées ici. |
| **Conformité Maroc** | **Non testé — EXTERNAL VALIDATION** | TVA/ICE/IF/RC/mentions factures/loi 09-08-CNDP : validation par comptable et professionnels habilités requise. Point positif vérifié en code : `src/lib/sales-tax-policy.ts` ne présume **aucun taux** (liste en points de base, tout taux absent refusé). |

### DÉCISION GLOBALE : **NO-GO PRODUCTION**
Motivée par 5 bloquants indépendants du logiciel : **P0-OPS-DB** (base vierge), **P0-OPS-WIN**, **P0-OPS-NET**, **P0-OPS-BCP**, **P0-LEGAL**. Le GO technique conditionnel de R13.3 n'est pas remis en cause mais ne peut être promu sans ces preuves. Aucun critère d'arrêt immédiat du plan §3 (corruption, double paiement, contournement RBAC/4 yeux, OF avant approbation) n'a été constaté dans ce qui a été exécuté ou revu.

---

## 2. PÉRIMÈTRE, MÉTHODE ET LIMITES DE PREUVE

**Lus dans l'ordre imposé :** README, AGENTS, PLAN_RESTANT_R13_3, RISQUES_RESIDUELS, ARCHITECTURE, REGLES_METIER, ROLES_ET_PERMISSIONS, SECURITE, RUNBOOK, TESTS, POLITIQUE_SODEPI_ACTUELLE, MATRICE_SKILLS, skill `audit-orchestrator` + skills applicables (build-ci, sqlite-integrite, securite-confidentialite, achats-p2p, stocks-qualite, ventes-directeur, catalogue-gabarits, finance-maroc, exploitation-resilience, benchmark-normes).

**Exécuté réellement (preuves fraîches de cette campagne) :**
1. Extraction du dépôt et inventaire (665 fichiers) ; vérification SHA-256 de la DEMO ✅
2. Sur copie jetable : `integrity_check`, `foreign_key_check`, `journal_mode`, inventaire tables/index ✅
3. Peuplement synthétique reproductible (seed 42) : 20 000 consultations + 40 000 RFQ sur la copie ✅
4. `EXPLAIN QUERY PLAN` du tri urgence reconstruit fidèlement depuis `src/lib/consultation-list-query.ts` + 30 mesures de latence SQL ✅

**Non testé (environnement sans Node ≥ 24, sans npm/bun, Python 3.10/3.7 seulement) :** `npm ci`, `prisma generate`, `tsc`, `lint`, `build`, toutes suites JS/Python longues, recettes HTTP contre `next start`, Playwright, benchmarks 10/20/50 utilisateurs, test anticorruption runtime R13.3, procédures Windows. **Ces éléments ne sont jamais déclarés Conforme.**

**Qualité réelle des tests (revue, pas comptage de PASS) :** `tests/r133-handoff-integrity-contract.test.cjs` est en partie un test de **présence de motifs regex dans le code** (contrat anti-régression, utile mais ne prouve pas le runtime) ; le vrai test comportemental est `tests/r133-dual-engine-corruption.test.cjs` (garde `GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY`, assertions ≥ N/2 créations, 4 pending, intégrité par phase) — bien conçu, **Non testé ici**. `tests/audit-api-matrix.cjs` contient de vraies assertions (sonde de fuite, 401 anonyme systématique, deny `clients.read`, chemins encodés `%6frders`) — pas un compteur vide. La chaîne `test:regression` (~70 suites) mélange contrats statiques et vrais tests SQLite/HTTP : le nombre de PASS ne vaut pas couverture sémantique (doctrine CASCADE4-R1).

---

## 3. REGISTRE DES ANOMALIES

| ID | Gravité | Constat / preuve (fichier · ligne ou résultat obtenu) | Cause racine | Correctif | Statut |
|---|---|---|---|---|---|
| **A-01 PERF-P2P** | P1 | `src/lib/consultation-list-query.ts` L105–131 : tri urgence = 2 sous-requêtes corrélées (`rank`, `due`) évaluées par consultation + `count(*)` filtré répété (`src/app/api/p2p/consultations/route.ts` L53–57). **Exécuté** : `EXPLAIN QUERY PLAN` → `SCAN TABLE SupplierConsultation` + 2 `CORRELATED SCALAR SUBQUERY` + `USE TEMP B-TREE FOR ORDER BY`. SQL seul sur copie 20 000 consultations : p50 **51 ms**, p95 **51 ms** (30 runs, mono-utilisateur). p95 HTTP **5 080 ms** à 50 users = mesure fournie, non reconfirmée | Tri calculé ligne à ligne, double jointure, hydratation Prisma profonde (include L100–113), amplifié par 50 sessions + sérialisation + 2 vCPU | **S-02** | Partiel (goulot SQL démontré ; charge HTTP Non testée) |
| **A-02 PERF-LIST** | P1 | `src/app/api/orders/route.ts` L67–95 : même en `view=list`, 5 requêtes « parallèles » dont `SUM` portefeuille sur toutes les OrderLine + 3 `count` globaux **à chaque page** ; `Promise.all` sur SQLite = contention, pas vrai parallélisme. p95 **1 687 ms** > seuil 1 500 ms (mesure fournie) | Agrégats globaux recalculés à chaque appel + include `lines` complet hors mode list | **S-03** | Partiel |
| **A-03 AUTH-401** | P2 | `src/lib/user-directory.cjs` L226–233 : `readSession` fait `catch{return null}` → toute erreur SQLite transitoire (busy, I/O) devient « session invalide » → **401** (`src/lib/access-gate.ts` L138, L215). Le commentaire CONC-ACTEUR (`orders/route.ts` L104–109) admet déjà ce mécanisme pour un TypeError corrigé. Fréquence observée 1/600 (2 000 cmd / 50 users, journaux fournis) | Confusion « erreur d'infrastructure » et « session expirée » ; journal DELETE = lecteurs bloqués pendant commit | **S-01** | Non conforme (mécanisme identifié en code ; reproduction HTTP Non testée) |
| **A-04 SQLITE-503** | P2 | `src/lib/sqlite-write.ts` L20–48 : retry borné (6 tentatives, backoff ≤ 1 500 ms), fail-closed P1008/corruption — conforme doctrine. Mais `managed()` (`user-directory.cjs` L71) `catch{return false}` : base momentanément illisible → état « non configuré » → 503 avec message trompeur « Initialiser les comptes » | Même confusion infrastructure/état que A-03 | **S-01** (2ᵉ volet) | Partiel |
| **A-05 GEN-DIV** | P1 décision | `src/lib/order-create-schema.ts` L51–56 : HTTP 400 volontaire « famille DIVERS absente taxonomie V16, décision SODEPI requise ». **Comportement voulu, pas un bug** ; aucune extension faite | Décision métier en attente | **S-09** | Non applicable (bug) / bloquant métier ouvert |
| **A-06 PROD-DB** | **P0** | `db/production-blank.db` **absent** (inventaire exécuté : seuls `custom.db`, fixtures, SQL). `deploy/windows/PROCEDURE_R13_3.md` L71 s'arrête explicitement dessus | Provisionnement jamais conçu ni testé | **S-04** | Non conforme — **BLOQUANT installation** |
| **A-07 DOC-WAL** | P3 | ARCHITECTURE.md annonce « SQLite WAL » ; le code exige **DELETE** (`src/lib/db.ts` L27–28, `user-directory.cjs` L64–65, `scripts/start-gocmd-checked.cjs` L68–75). La doctrine runtime prime | Documentation en retard sur P5.15.28 | **S-10** | Non conforme (documentaire) |
| **A-08 DOC-ROLES** | P3 | SECURITE.md : « 9 rôles » ; ROLES_ET_PERMISSIONS.md : 10 (`production` ajouté) ; `access-gate.ts` L4 confirme 10 | Idem | **S-10** | Non conforme (documentaire) |
| **A-09 CSRF** | — | `access-gate.ts` L241–248 : `sec-fetch-site: cross-site` refusé, Origin exigée pour comptes gérés, comparaison `GOCMD_PUBLIC_ORIGIN`/Host, `X-Forwarded-Host` seulement si `GOCMD_TRUST_PROXY=1` ; cookie SameSite=Lax | — | — | Partiel (Conforme en revue statique ; HTTP Non testé) |
| **A-10 CSP / en-têtes** | — | `src/proxy.ts` L15–47 : nonce par requête, `strict-dynamic`, pas d'`unsafe-inline` scripts ; `next.config.ts` : DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS conditionnel HTTPS | — | — | Partiel (statique ; en-têtes réels Non testés) |
| **A-11 Fuites prix/coûts** | — | Masquage serveur : `canSeeMaterialCosts` + 403 contractuel (`consultations/route.ts` L30–33), DTO par acteur (`orders/route.ts` L36, L96), suppression des clés d'idempotence internes (L32–33), export CSV anti-injection formule y compris caractères de contrôle (`src/lib/export-csv.ts` L4–7) | — | — | Partiel (code probant ; matrice API Non rejouée) |
| **A-12 Quatre yeux / visa director** | — | `SELF_APPROVAL`, `isDirector` strict (`access-gate.ts` L85–88), admin pur exclu des API métier (L222–224), compte legacy lecture seule sans drapeau de réactivation (L99–103, L244) | — | — | Partiel (statique ; HTTP Non testé) |
| **A-13 Intégrité SQLite** | — | **Exécuté sur copie** : integrity ok, 0 FK, journal delete, index FK présents (`SupplierConsultationLine_consultationId_idx`, `SupplierRFQ_status_deadline_idx`…). Pré-vol PRAGMA fail-closed (`db.ts` L15–35), garde `refuse-unsafe-schema-change`, verrou mono-instance (`start-gocmd-checked.cjs` L80–82), starter refuse la DEMO en production même renommée (L39–40) | — | — | **Conforme** (contrôles exécutés) ; anticorruption HTTP R13.3 : Non testé |
| **A-14 TVA / finance Maroc** | P0 externe | `sales-tax-policy.ts` : aucun taux présumé, liste points de base, taux absent refusé — bonne conception. Aucun avis comptable ICE/IF/RC/mentions/09-08 au dépôt | Validation professionnelle hors logiciel | **S-08** | Non testé (EXTERNAL VALIDATION) |
| **A-15 Exploitation** | P0 | Kit WinSW, 4 sauvegardes/jour, scellement HMAC chaîné : conçus, partiellement testés en sandbox Linux selon journaux fournis ; **aucun PV Windows/Tailscale/restauration sur site**. ZIP de sauvegarde **non chiffré** (documenté RUNBOOK) | Recette terrain non faite | **S-05/06/07** | Non testé — bloquant GO production |
| **A-15b Scellement** | P2 | RUNBOOK P6U-P2FIX : pointeur `chainLatest` + maillon non atomiques entre 2 fichiers ; ancrage hors serveur requis ; procédure d'incident documentée | Limite assumée, mitigation procédurale | **S-11** | Partiel |

---

## 4. SOLUTIONS — CORRECTIFS SPÉCIFIÉS (NON APPLIQUÉS, NON REJOUÉS)

> **Décision doctrinale :** aucun patch n'a été appliqué dans cette campagne, car (1) impossible de rejouer `npm ci → prisma generate → tsc → lint → build → tests` sans Node — livrer un diff non rejoué violerait « Non exécuté = Non testé » et le contre-audit sur extraction neuve ; (2) les correctifs perf exigent la mesure après sous même charge. Chaque solution ci-dessous est un **correctif minimal prêt à appliquer**, avec test de non-régression et mini-AMDEC. Aucun ne contourne quatre yeux, approbation avant OF, permissions nominatives, visa `director` ni le moteur Prisma écrivain unique. Les extraits de code sont **illustratifs** (à adapter au code exact lors de l'application).

### S-01 · FIX-401/503 — Distinguer erreur d'infrastructure et session invalide (A-03 + A-04, P2)

**Principe :** ne jamais accorder l'accès sur erreur (fail-closed conservé), mais ne plus fabriquer un 401 « session expirée » quand la lecture SQLite échoue techniquement → répondre **503 + `Retry-After: 1`**.

```js
// src/lib/user-directory.cjs — readSession (≈L226–233) — PROPOSÉ
- } catch { return null }
+ } catch (err) {
+   // Erreur technique ≠ session absente : ne pas fabriquer un 401.
+   return { transient: true, code: err?.code ?? 'SQLITE_ERROR' };
+ }
```
```ts
// src/lib/access-gate.ts — points où readSession()===null → 401 (≈L138, L215) — PROPOSÉ
+ if (session?.transient) {
+   return Response.json({ error: "INFRA_TRANSIENT" },
+     { status: 503, headers: { "Retry-After": "1" } });
+ }
```
**2ᵉ volet (A-04) :** même marqueur `transient` dans `managed()` (`user-directory.cjs` ≈L71) pour que le gate ne dise plus « Initialiser les comptes » sur une base momentanément illisible.

- **Invariants préservés :** session réellement expirée/révoquée → toujours 401 ; RBAC, quatre yeux, visa director inchangés ; pas de retry automatique sur écriture ambiguë.
- **Test de non-régression :** (a) unitaire : mock DB levant `SQLITE_BUSY` → 503 ; ligne absente → 401 ; session révoquée → 401. (b) Harnais P2-AUTH : ≥ 3 campagnes représentatives 50 users / 2 000 commandes, identité/session tracées, tableau 200/401/409/503, **zéro 401 injustifié**.
- **AMDEC :** mode « 503 masque une expiration » S=3 O=2 D=2 → test unitaire dédié ; mode « boucle de retry client » → `Retry-After` + interdiction de retry aveugle en écriture.
- **Effort :** 0,5–1 j-h dev + 1 j-h campagne. **PDCA :** Plan (harnais) → Do (patch) → Check (3 campagnes) → Act (requalification fréquence AUTH-401 dans RISQUES_RESIDUELS).

### S-02 · FIX-P2P — Tri urgence des consultations (A-01, P1)

**Goulot démontré (exécuté) :** `SCAN TABLE SupplierConsultation` + 2 sous-requêtes corrélées par ligne + `TEMP B-TREE FOR ORDER BY`. Trois étapes minimales, **mesure après chacune**, dans cet ordre :

**Étape 1 — Agrégation en une seule passe (CTE) au lieu de 2 sous-requêtes corrélées :**
```sql
-- PROPOSÉ — esquisse ; sémantique de tri STRICTEMENT identique à vérifier
WITH classe AS (
  SELECT l.consultationId,
         min(CASE WHEN target_ms <= :soon AND m.stockQty < r.qty THEN 0
                  WHEN m.stockQty <= 0 THEN 1
                  WHEN m.stockQty > 0 AND m.stockQty < m.minStock THEN 2
                  WHEN target_ms <= :soon THEN 3 ELSE 4 END) AS lineRank,
         min(target_ms) AS firstTarget
  FROM SupplierConsultationLine l
  JOIN SupplierRFQ r ON r.id = l.rfqId
  JOIN Material m   ON m.id = r.materialId
  GROUP BY l.consultationId
)
SELECT c.id
FROM SupplierConsultation c
LEFT JOIN classe cl ON cl.consultationId = c.id
ORDER BY min(coalesce(cl.lineRank, 4),
             CASE WHEN deadline_ms <= :soon THEN 3 ELSE 4 END),
         min(coalesce(deadline_ms, 8640000000000000),
             coalesce(cl.firstTarget, 8640000000000000)),
         created_ms DESC, c.id ASC
LIMIT :pageSize OFFSET :offset;
```
**Étape 2 — Réduire l'`include` Prisma du GET** (`consultations/route.ts` L100–113) aux champs affichés en liste, **sans toucher au masquage RBAC/DTO**.
**Étape 3 — Ne plus exécuter le `count(*)` filtré à chaque page :** cache court par clé de filtre (TTL ≈ 5 s) invalidé aux écritures consultations, ou endpoint de comptage séparé.
**Étape 4 (seulement si p95 > 1 500 ms persiste) :** table de classement persistée, mise à jour transactionnelle à l'écriture — changement plus lourd, **décision d'architecture formelle requise** (doctrine).

- **Test de non-régression :** équivalence de tri — mêmes ids ordonnés avant/après sur base figée (20 pages × jeux de filtres) ; matrice API RBAC rejouée (confidentialité du tri incluse) ; contrat de pagination inchangé.
- **Protocole de mesure obligatoire avant/après :** `GOCMD_BENCH_SQL_PROFILE=1` (existe déjà, `db.ts` L44–55) + `tests/perf-bench-r13.cjs`, bases 200/2 000/20 000 figées par SHA, 10/20/50 utilisateurs, p50/p95/p99 + CPU/RSS + codes HTTP, **même machine, même charge, mêmes données**. Ne pas maquiller par suppression de scénarios.
- **AMDEC :** « tri modifié silencieusement » S=4 → test d'équivalence bloquant ; « count périmé » S=2 → TTL court + invalidation ; « fuite via include réduit » → matrice API.
- **Effort :** 2–3 j-h + mesure. **Honnêteté :** le SQL seul à 51 ms ne prouve pas la cause des 5 080 ms HTTP (multiplicateur = 50 sessions + hydratation + sérialisation + 2 vCPU) ; la validation en charge HTTP est indispensable.

### S-03 · FIX-LIST — Liste des commandes (A-02, P1)

- **Correctif minimal :** sortir les agrégats globaux (`SUM` portefeuille + 3 `count`) du chemin de chaque page → cache in-process invalidé aux mutations de commandes, ou endpoint `/summary` rafraîchi périodiquement. Conserver le contrat `view=list` et la pagination ; le `Promise.all` sur SQLite n'apporte pas de vrai parallélisme, ne pas compter dessus.
- **Test :** contrat pagination r6 (`tests/test_r6_pagination_contract.py`) + matrice RBAC + bench 20 000 / 50 users avant/après même charge.
- **AMDEC :** « agrégat obsolète affiché » S=2 → invalidation à l'écriture + horodatage du cache.
- **Effort :** 1–2 j-h.

### S-04 · P0-OPS-DB — Provisionnement de la base de production vierge (A-06, P0 BLOQUANT)

**Nouveau script `scripts/provision-production-blank.py` (à créer et recetter) :**
1. Créer un fichier **neuf** (jamais une copie de la DEMO, même renommée) ; appliquer les migrations officielles `prisma/sql/` dans l'ordre sur base vide (elles sont non idempotentes → contrôle préalable).
2. Poser les gardes indépendantes des données : 20 gardes historiques + 6 triggers facture (`upgrade_history_delete_guards_p51523.py`, `upgrade_invoice_immutability_p51523.py`) ; `verify_operational_guards_p51523.py` doit retourner 20/20 + 6/6.
3. `PRAGMA journal_mode=DELETE`, `foreign_keys=ON`, `integrity_check=ok`, `foreign_key_check=0` ; `check_sqlite_schema_p5157.py`.
4. `node scripts/bootstrap-admin.cjs` une seule fois ; aucun autre compte, aucune donnée.
5. Consigner SHA-256 de la base vierge + PV signé.
- **Tests d'acceptation :** `start:checked` **accepte** la vierge ; **refuse** la DEMO comme production (y compris renommée) ; refuse une base sans gardes ; refuse le journal WAL.
- **Effort :** 2–3 j-h. **AMDEC :** « DEMO installée en production » S=5 → double garde starter + PV ; « migration rejouée » → contrôle de version de schéma avant application.

### S-05 · P0-OPS-WIN — Recette réelle du serveur Windows (P0)

Checklist PV à exécuter **sur le matériel SODEPI** : Node 24 ; service WinSW sous LocalService (non-admin) ; NTFS, disque SSD interne (jamais de partage réseau pour SQLite) ; règles pare-feu sans port public ; reboot ; `taskkill` brutal pendant écritures → `integrity_check` ok, 0 écriture partielle ; **une seconde instance ne peut pas écrire** (verrou) ; coupure réseau ; permissions de fichiers ; tâche planifiée de sauvegarde + supervision `verifier-sante.ps1` (4 états). Screenshots/logs/codes de retour archivés. **Effort : 2–3 j-h sur site.**

### S-06 · P0-OPS-NET — HTTPS privé (P0)

Tailscale **Serve** uniquement (jamais Funnel/exposition publique) ; `GOCMD_PUBLIC_ORIGIN=https://…` → HSTS activé ; cookies Secure ; test d'accès **refusé depuis appareil non autorisé** + révocation appareil/utilisateur ; tests tablette Wi-Fi et LAN ; limitation par IP au reverse proxy (DEF-S-06/07). **Effort : 1–2 j-h.**

### S-07 · P0-OPS-BCP — Sauvegarde/restauration exploitables (P0)

4 sauvegardes/jour (00/06/12/18 h) via `backup_gocmd_complete.py` (SQLite + PDF + manifeste SHA) ; **le ZIP n'est pas chiffré → destination chiffrée hors serveur obligatoire** ; alerte sauvegarde > 12 h ; restauration trimestrielle sur machine isolée (`restore_gocmd_complete.py --verify-only` puis restauration + recette login + circuit achat) ; RPO ≤ 12 h / RTO ≤ 4 h **à signer par la direction** ; exercice chronométré. **Effort : 2 j-h + exercices.**

### S-08 · P0-LEGAL — Conformité Maroc (externe, P0)

Checklist à faire viser par comptable/conseil habilités : taux TVA réels configurés en points de base (le code refuse tout taux absent — ne pas « corriger » cela) ; mentions ICE/IF/RC ; séquence et immuabilité des factures (6 triggers déjà en place) ; avoirs ; déclaration loi 09-08/CNDP pour les données personnelles ; rétention/purge des journaux d'audit. **Aucun test logiciel ne peut déclarer la conformité.** **Effort : externe.**

### S-09 · GEN-DIV — Arbitrage métier (P1, aucun code sans décision)

- **Option A :** suspension définitive → documenter, conserver le test HTTP 400 comme contrat.
- **Option B :** extension **documentée** de la taxonomie V16 : matrice de codification, attributs obligatoires, test HTTP, contrôle intégrité/trigger.
- **Dans les deux cas :** décision écrite SODEPI (direction + responsable catalogue/qualité) avant tout changement. GEN-MAT et GEN-MOU déjà corrigés : ne pas y toucher. **Effort : décision + 1–2 j-h si option B.**

### S-10 · FIX-DOC — Alignement documentaire (P3)

ARCHITECTURE.md : « WAL » → « journal DELETE (WAL désactivé conservatoirement, P5.15.28) » ; SECURITE.md : « 9 rôles » → 10 (`production`). Test : `test:r133:integrity:contract` inchangé. **Effort : 0,5 j-h.**

### S-11 · Scellement d'audit — Ancrage indépendant (A-15b, P2)

Archiver périodiquement `chainLatest` + maillons **hors serveur**, sous garde d'une personne distincte de l'administrateur ; en cas de crash entre pointeur et maillon : appliquer la procédure P6U-P2FIX (copie lecture seule + SHA, comparaison à quatre yeux, jamais écraser un maillon). **Effort : 0,5 j-h + procédure.**

---

## 5. TABLEAU D'OPTIMISATION AVANT / APRÈS

| Cible | Avant — mesure fournie (journaux R13.3, sandbox 2 vCPU) | Avant — mesuré dans CETTE campagne (exécuté) | Après | Statut |
|---|---|---|---|---|
| `/api/p2p/consultations` tri urgence, 20 000 / 50 users | p95 **5 080 ms** | SQL seul, copie 20 000 consultations synthétiques : p50 **51 ms**, p95 **51 ms**, max 51 ms (30 runs, mono-utilisateur) ; plan : SCAN + 2 sous-requêtes corrélées + TEMP B-TREE | **Non testé** | Correctif S-02 spécifié, non appliqué |
| Liste commandes, 20 000 / 50 users | p95 **1 687 ms** (seuil 1 500 ms : FAIL) | Non mesuré (0 commande dans la DEMO ; pas de runtime HTTP) | **Non testé** | Correctif S-03 spécifié |
| Liste commandes, 20 000 / 10 users | p95 417 ms (PASS ≤ 800 ms) | Non re-mesuré | — | Référence |
| Création commande, 20 000 / 50 users | p95 797 ms, 600×201 | Non re-mesuré | — | Référence |
| Dashboard | p95 1 458 ms | Non re-mesuré | — | À recetter Windows |

**Règle :** aucune ligne « Après » ne sera renseignée sans re-mesure même charge / mêmes données / même machine (`perf-bench-r13.cjs`, bases figées SHA, `GOCMD_BENCH_SQL_PROFILE=1`).

---

## 6. BENCHMARK CONCURRENTS

**Aucun concurrent installé ni mesuré dans cette campagne** (environnement sans runtime applicatif). Conformément à « ne rien inventer » :

| Tâche réelle SODEPI | GoCmd | Odoo | ERPNext | Dolibarr | Sage | Source / preuve |
|---|---|---|---|---|---|---|
| Création fournisseur | Implémenté (revue code) | Non comparé | Non comparé | Non comparé | Non comparé | Aucune édition/version testée ; aucune source datée homogène collectée |
| DA → BC → BR | Implémenté + 4 yeux (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Comptage de stock | Implémenté (`stock.count`/`approve`) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Vente en mètres linéaires | Implémenté (ml + étiquettes, revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Prix spécial visa directeur | Implémenté (mot de passe personnel) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| BL partiel | Implémenté (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Avoir client | Implémenté + approbation (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Export CSV | Implémenté + anti-injection (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Contrôle qualité / quarantaine | Implémenté (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Accès multi-rôles / révocation | Implémenté (10 rôles, revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Réception partielle + retour fournisseur | Implémenté (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |
| Rapprochement 3 voies / paiement | Implémenté + SEP-002 (revue) | Non comparé | Non comparé | Non comparé | Non comparé | idem |

**Ergonomie GoCmd (clics, temps, ressaisies) : Non mesurée.** Protocole pour la prochaine campagne : mêmes 12 tâches, éditions communautaires datées (Odoo CE, ERPNext v15, Dolibarr LTS) + Sage sous licence, chronométrage homogène, grille **séparée** fiabilité / simplicité / adéquation métier ; sinon maintenir « Non comparé ».

---

## 7. PLAN D'ACTION PRIORISÉ (P0 → P3)

| Priorité | Action | Solution | Effort estimé | Responsable | Critère de clôture |
|---|---|---|---|---|---|
| **P0** | Base production vierge | S-04 | 2–3 j-h | DBA/architecte + SODEPI | Script testé sur base neuve isolée, PV, starter accepte vierge / refuse DEMO |
| **P0** | Recette Windows réelle | S-05 | 2–3 j-h | Exploitant SODEPI | PV avec logs, kill/reboot, mono-instance prouvée |
| **P0** | HTTPS privé + révocation | S-06 | 1–2 j-h | IT SODEPI | Tests sur site, appareil non autorisé refusé, pas de Funnel |
| **P0** | Sauvegarde/restauration + RPO/RTO | S-07 | 2 j-h + exercices | Exploitation + direction | Restauration hors machine prouvée, RPO ≤ 12 h / RTO ≤ 4 h signés |
| **P0** | Conformité TVA/mentions/09-08 | S-08 | Externe | Comptable + conformité | Avis/signature habilités |
| **P1** | Perf consultations | S-02 | 2–3 j-h + mesure | Backend + auditeur perf | p95 ≤ 1 500 ms à 50 users sur matériel comparable, ou écart documenté ; équivalence de tri prouvée |
| **P1** | Perf liste commandes | S-03 | 1–2 j-h | Backend + exploitation | p95 ≤ 1 500 ms forte charge, même protocole |
| **P1** | Arbitrage GEN-DIV | S-09 | Décision (+1–2 j-h si B) | Direction + catalogue/qualité | Décision écrite ; si B : matrice + tests + trigger |
| **P2** | 401 isolé / 503 infra | S-01 | 1,5–2 j-h | Sécurité + backend | 3 campagnes, 0 401 injustifié, 401 légitimes préservés |
| **P2** | Idempotence 503 / C4-C5-C7 | Rejeu suites existantes | 1 j-h | Backend + QA | Aucune double écriture, pas de 409 masquant l'infra |
| **P2** | Ancrage scellés hors serveur | S-11 | 0,5 j-h | Direction (pas admin) | Ancrage + vérification par personne distincte |
| **P3** | Documentation WAL/DELETE, 9→10 rôles | S-10 | 0,5 j-h | Dev | Docs alignées, contrat R13.3 vert |
| **P0 final** | **Contre-audit sur extraction neuve Node 24** | — | 2–3 j-h | Auditeur indépendant | `npm ci`, prisma, tsc, lint, build, HTTP métier, RBAC, CORR-01, D-GEN-01, verrouillage, C4/C5/C7, Playwright, backup/restauration — vrais exit codes + SHA du ZIP final |

**Total effort interne estimé : ~15–22 j-h** (hors validations externes et décisions métier).

---

## 8. TESTS — EXÉCUTÉS vs NON TESTÉS (cette campagne)

| Contrôle | Commande / méthode | Résultat | Statut |
|---|---|---|---|
| Empreinte DEMO | SHA-256 `db/custom.db` | `65288ab6…f06545d` = manifeste README | **Conforme (exécuté)** |
| Intégrité base (copie jetable) | `PRAGMA integrity_check` | `ok` | **Conforme (exécuté)** |
| Clés étrangères | `PRAGMA foreign_key_check` | 0 violation | **Conforme (exécuté)** |
| Journal | `PRAGMA journal_mode` | `delete` (cohérent P5.15.28) | **Conforme (exécuté)** |
| Plan tri urgence | `EXPLAIN QUERY PLAN` (SQL reconstruit, 20 000 consultations synthétiques seed 42) | SCAN + 2 sous-requêtes corrélées + TEMP B-TREE | **Exécuté — goulot A-01** |
| Latence SQL tri urgence | 30 runs mono-utilisateur | p50 51 ms / p95 51 ms / max 51 ms | **Exécuté** |
| `npm ci`, `prisma generate`, `tsc`, `lint`, `build` | — | Environnement sans Node | **Non testé** |
| Suites régression / P6 / C4 / RBAC matrix / anti-fuites | — | idem | **Non testé** |
| Anticorruption HTTP R13.3 (CORR-01 runtime) | `r133-dual-engine-corruption.test.cjs` | idem | **Non testé** |
| Bench HTTP 10/20/50 users avant/après | `perf-bench-r13.cjs` | idem | **Non testé** |
| Playwright multi-rôles | — | idem | **Non testé** |
| Windows / Tailscale / restauration sur site | — | Aucun PV | **Non testé** |
| Conformité Maroc | — | Hors logiciel | **Non testé (externe)** |
| Périmètre GoProd (BOM/MRP/OF détaillés) | — | Hors périmètre doctrine §2 | **Non applicable (justifié)** |

---

## 9. CHECKLIST DE CLÔTURE — CONDITIONS DU GO PRODUCTION

- [ ] S-04 base vierge provisionnée, testée, PV signé — **P0**
- [ ] S-05 PV recette Windows (kill, reboot, mono-instance, pare-feu) — **P0**
- [ ] S-06 HTTPS privé testé sur site, révocation prouvée, aucun accès public — **P0**
- [ ] S-07 restauration hors serveur prouvée, RPO/RTO signés, alertes actives — **P0**
- [ ] S-08 avis fiscal/CNDP signé par professionnels habilités — **P0**
- [ ] S-02/S-03 mesurés avant/après même charge : p95 ≤ 1 500 ms ou écart formellement documenté et accepté — **P1**
- [ ] GEN-DIV : décision écrite SODEPI — **P1**
- [ ] S-01 : 3 campagnes, zéro 401 injustifié — **P2**
- [ ] Contre-audit complet sur extraction neuve Node 24 du ZIP final modifié (SHA scellé), vrais exit codes — **P0 final**
- [ ] AMDEC mise à jour ; aucun critère d'arrêt déclenché (corruption, double paiement/réservation, OF avant approbation, contournement RBAC/4 yeux, DEMO en production, SQLite sur partage réseau, test non exécuté déclaré PASS)

**Tant qu'une case P0 est ouverte : NO-GO production maintenu.**

---

*Fin du rapport — document unique consolidant les phases compréhension → audit → bugs → optimisation → corrections → benchmark. Aucun patch appliqué ; 11 solutions spécifiées avec tests de non-régression et AMDEC ; toute promotion de statut exige une preuve fraîche datée, versionnée (SHA), avec entrée/attendu/obtenu/code de sortie.*