# GoCmd / SODEPI — R13.3, qualification de performance, intégrité et exploitation

**Base :** R13.2 transmise le 12 novembre 2026. **Objet :** exécuter la campagne
de qualification R13.3 (performance sur bases de recette volumineuses, maîtrise
des écritures concurrentes en topologie mono-processus, préparation documentée
du serveur Windows SODEPI). Aucune règle métier modifiée, aucune interface
modifiée (UX/UI reporté), base DEMO inchangée (SHA-256 identique à R13.2).

## Défauts démontrés et corrigés (preuves dans le dossier de qualification)

| # | Défaut confirmé | Correction | Preuve |
|---|---|---|---|
| D-CORR-01 | **CORRUPTION SQLite en topologie mono-processus** : dans le processus serveur, les écritures node:sqlite (sessions au login via `user-directory.cjs`, audits de confirmation sensible) et les écritures Prisma (métier) ne se verrouillent pas entre elles — les verrous POSIX sont détenus par PROCESSUS. Un simple login concurrent d'une création de commande entrelaçait les pages et corrompait la base (index `GoCmdSession` et `OrderLine` détruits). Reproduction déterministe : phase « Prisma + logins » sur R13.2 (40 créations + 80 logins), intégrité détruite ; preuves `EVIDENCE_corruption_login_r132.db` (SHA-256 6b5c192a…) et `EVIDENCE_corruption_r132.db` (b60fb952…) | **Un seul moteur SQLite écrivain par fichier en mode serveur** : `GOCMD_SERVER_RUNTIME=1` (posé par `next.config.ts` et le starter vérifié) rend la connexion node:sqlite STRICTEMENT lecture seule et refuse fail-closed toute écriture identités ; les écritures sessions/audits/comptes passent par le client Prisma unique (`src/lib/identity-writes.ts`) dans la file `serializedSQLiteWrite`. Les scripts CLI (serveur arrêté) conservent node:sqlite — les verrous POSIX s'appliquent entre processus distincts. Modèle `GoCmdSession` ajouté au schéma Prisma (mapping de la table existante, AUCUNE migration du disque) | `tests/r133-dual-engine-corruption.test.cjs` : 4 phases + arrêt, intégrité maintenue (R13.2 : corrompue en phase 2). Génération 200 commandes : intégrité OK aux 7 points de contrôle (R13.2 : corrompue dès les décisions) |
| D-PERF-01 | **`nextRef` O(N)** : chaque création de référence chargeait TOUTES les références de l'année (`findMany` complet + boucle JS). EXPLAIN QUERY PLAN : SCAN `Order_ref_key`. Coût croissant avec le volume (mesuré : 1,2 ms SQL à 2 000 commandes ; génération 20 000 : dégradation de 37 s/1000 à 95 s/1000 commandes) | UNE agrégation SQL `MAX(CAST(SUBSTR(ref, ?) AS INTEGER))` sur l'index couvrant (0,26 ms à 2 000 commandes), sans matérialisation de lignes. Même résultat, même format, unicité + retry P2002 inchangés | Benchmark avant/après S06 (création) sur 200/2 000/20 000 commandes ; `tests/test_v09_regression.cjs` et campagne C1-C8 rejoués |
| D-GEN-01 | **Gabarits génériques GEN-MAT/GEN-MOU/GEN-DIV cassés** : la création d'une commande avec ligne générique échoue (trigger V16 : produits internes INT-GEN sans champs taxonomiques obligatoires / famille `DIVERS` hors liste). AUCUN test R13.2 ne couvrait la création via API (tests unitaires purs uniquement) | **CORRIGÉ le 13 novembre 2026 (reprise Z.ai, option D)** : le formulaire générique collecte les caractéristiques taxonomiques réelles, `GenericLineSchema` les valide avant insertion (400 explicites alignés sur le trigger), la fiche INT-GEN les persiste et l'instantané scellé les emporte — trigger V16 et contraintes d'unicité INCHANGÉS. **GEN-DIV reste suspendu** (400 explicite « décision métier SODEPI requise ») : la famille DIVERS ne peut pas être ajoutée sans décision (D-GEN-01/E) | `tests/r133-dgen01-generic-taxonomy.test.cjs` : 9 scénarios sur copie jetable (GEN-SAL 201 inchangé, GEN-MAT PURE/MELANGE et GEN-MOU 201 + fiches conformes vérifiées en base, champs manquants 400, couches > hauteur 400, GEN-DIV 400, cycle quatre-yeux complet, intégrité SQLite) |

## Nouvelles instrumentations (défaut off)

- `GOCMD_BENCH_SQL_PROFILE=1` : journalisation des requêtes Prisma (durée,
  texte) pour attribuer temps SQL et nombre de requêtes par endpoint.
- Harnais de benchmark reproductible (15 scénarios HTTP, concurrence 1→100,
  démarrage à froid / échauffement / mesure stabilisée) — dossier de preuves.
- Générateur de bases de recette 100 % API métier (200 / 2 000 / 20 000
  commandes, six mois de dates, tous états du cycle de vie) + vérificateur
  d'invariants + semis de consultations achats.

## Exécution de recette (environnement sandbox Linux 2 vCPU)

Node.js v24.22.2, npm 11.19.1, Next.js 16.4.6, Prisma 6.19.3, SQLite journal
DELETE, busy_timeout 5000 ms. `npm ci` ; `npx prisma generate` ; `next build`
exit 0 après chaque modification. Serveurs de production via le starter vérifié
(verrou d'instance) sur copies SQLite jetables.

## Résultats clés

*(consolidés dans le dossier de preuves R13.3 : benchmark avant/après sur les
trois bases, suite verrou 14 scénarios, suite sauvegarde 13 scénarios,
non-régression complète, AMDEC, DMAIC/PDCA.)*

## Décision

Voir le verdict final du dossier de qualification (PASS/FAIL/BLOCKED/
EXTERNAL VALIDATION par contrôle, décision GO/NO-GO).
