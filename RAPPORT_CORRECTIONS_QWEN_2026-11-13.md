# GoCmd / SODEPI — Correctifs ciblés après audit Qwen

**13 novembre 2026 — R13.3 REPRISE (correctif additionnel, sans changement de version métier)**

## Références et doctrine

- Point de départ : `GoCmd_SODEPI_R13_3_PROJET_NETTOYE_ORGANISE.zip`, SHA-256 `d32166507a611164b85f2babc2836ba5656b6361f1dbd9ceef6f447802cdc2c2`.
- Analyse externe conservée intégralement : `docs/audits/AUDIT_QWEN_SOURCE_2026-11-13.md`.
- Les suggestions externes ont été **revues** et non appliquées aveuglément.
- La base DEMO fictive n'a pas été modifiée (`65288ab6a380d3b9a7d8f8b3447fe011d01f674eca4c60efc19d310abf06545d`). Aucune base de production touchée.

## Corrections réellement appliquées

### QWEN-AUTH-01 (A-03/A-04) — Session invalide ≠ erreur de lecture SQLite

- `src/lib/user-directory.cjs` : nouveaux résultats **distincts** `configured/unconfigured/unavailable`, `valid/invalid/unavailable` pour le compte et la session.
- `src/lib/access-gate.ts` : en cas de panne de lecture, refus **503** avec `Retry-After: 1`, sans attribuer de droits ; session révoquée ou expirée : **401** conservé.
- `src/app/api/auth/login/route.ts` : panne de lecture de compte ≠ mot de passe incorrect ; **503**, sans alimenter le compteur d'échecs d'identification.
- `src/lib/user-directory.d.cts` : contrats de types étendus.
- `readUser`/`readSession` historiques restent disponibles aux scripts CLI. Le mode serveur `node:sqlite` reste STRICTEMENT lecture seule ; aucune modification à `identity-writes.ts` ou à l'authentification des permissions.
- Test `tests/qwen-auth-state.test.cjs` : distinction de statut sur base temporaire.
- Test `tests/qwen-auth-gate-behavior.test.cjs` : porte d'accès 401/503/200 simulée (sans serveur Next.js).

**Limite :** ces tests ne prouvent pas la fréquence HTTP réelle des 401/503 à 50 utilisateurs sous Node 24. Une recette de charge et les tests CORR-01/C4-C5-C7 demeurent obligatoires.

### QWEN-P2P-01 (A-01) — Tri urgence / échéance sans deux sous-requêtes corrélées

- `src/lib/consultation-list-query.ts` : pour listes par `urgency`/`due_date`, agrégation par consultation en une passe dans une table dérivée `gocmd_rank`. Les autres tris et l'accès par identifiant exact restent inchangés.
- `src/app/api/p2p/consultations/route.ts` : la page `id` applique le `LEFT JOIN` de classement ; le comptage conserve la sémantique et les filtres existants.
- `tests/qwen-p2p-sort-equivalence.py` : 64 comparaisons d'ordre et de pagination (urgency/due_date × filtres × offsets) sur base **synthétique** avec dates ISO/epoch/null et consultations sans lignes ; `EXPLAIN QUERY PLAN` et temps SQL.
- 20 000 consultations synthétiques, sur cet environnement : **médiane SQL 100,49 ms → 75,03 ms** (8 exécutions ; indicatif). Cela ne mesure **ni HTTP, ni 50 utilisateurs, ni le temps Prisma** ; le p95 historique de 5 080 ms **n'est pas déclaré corrigé**.

### QWEN-DOC-01 — Documentation alignée sur le runtime

- `ARCHITECTURE.md` et `SECURITE.md` : journal SQLite `DELETE` (WAL interdit), Node ≥ 24, 10 rôles incluant `production`.
- `.github/workflows/ci.yml` : deux nouveaux contrôles QWEN ajoutés comme tests bloquants **sans suppression des tests existants**.
- `package.json` : scripts `test:qwen:auth`, `test:qwen:p2p`, `test:qwen:targeted`, sans changement de dépendance.

## Tests réellement exécutés ici

| Contrôle | Résultat | Réserve |
|---|---|---|
| `node tests/qwen-auth-state.test.cjs` | PASS | Node 22, base isolée |
| `node tests/qwen-auth-gate-behavior.test.cjs` | PASS | Contrat comportemental simulé, pas HTTP |
| `python tests/qwen-p2p-sort-equivalence.py` | PASS, 64 comparaisons | SQL synthétique, pas API |
| `QWEN_ROWS=20000 python tests/qwen-p2p-sort-equivalence.py` | PASS, 64 comparaisons | SQL synthétique, pas API |
| `node tests/v18913-accounts.test.cjs` | PASS | Annuaire isolé |
| `node tests/v18913p3-admin-logout.test.cjs` | PASS | Annuaire isolé |
| `node tests/v18913p3-auth-gate.test.cjs` | PASS | Porte d'accès compilée localement |
| `node tests/r133-handoff-integrity-contract.test.cjs` | PASS 5/5 | Contrats et DEMO |
| `python tests/test_v1891_counter_audit.py` | PASS 46 contrôles | Surtout statique/source/BDD |
| Analyse de syntaxe TS (4 fichiers) | PASS | Pas une vérification des types |
| `npm ci --offline --ignore-scripts` | **BLOCKED / EXIT 1** | Node 22 installé, cache npm incomplet : `zod-validation-error@4.0.2` introuvable. Aucun build ou serveur HTTP sur cette livraison. |

**Non exécutés ici** : `npm ci` en ligne sous Node 24, `prisma generate`, `tsc --noEmit` intégral, `next build`, tests HTTP P2P, RBAC complet, CORR-01, E2E Playwright, benchmark 50 utilisateurs et recette Windows. Les succès antérieurs de R13.3 ne remplacent pas la validation de **ce ZIP modifié**.

## Hors du correctif, sans promesse de résolution

1. **P0-OPS-DB** : le dépôt n'a pas de baseline SQL complète validée de création d'une base neuve (les fichiers `prisma/sql` sont additifs). La base `production-blank.db` n'est **pas** générée : jamais reconstruire la production en renommant la DEMO. Une migration initiale certifiée et une qualification Node 24 sont indispensables.
2. **P1-LIST** : p95 historique 1 687 ms pour liste commandes avec 20 000/50 utilisateurs ; optimisation et mesure restant à faire.
3. **P1-P2P** : gain SQL ciblé, mais p95 HTTP à re-mesurer et autres postes (Prisma, hydratation, filtres) à profiler.
4. **P1-GEN-DIV** : gabarit volontairement suspendu, seule une décision SODEPI peut modifier la taxonomie V16.
5. **P0-TERRAIN / LEGAL** : tests Windows, réseau/Tailscale, backup hors machine, fiscalité marocaine et protection des données demeurent à faire par les responsables compétents.

**Verdict : projet corrigé prêt à revalidation intégrale Node 24. NO-GO production.**
