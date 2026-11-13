# Matrice de déclenchement des skills

- **`audit-orchestrator`** — Orchestrer un audit contradictoire multi-discipline GoCmd, avec preuves, suivi des P0 et décision de recette.
- **`preuve-tracabilite`** — Figer une version et produire des preuves datées, rejouables, exactes, sans divulguer de secrets.
- **`build-ci`** — Auditer installation reproductible npm/lockfile, Prisma, TypeScript, lint, régression, build et CI sans faux PASS.
- **`sqlite-integrite`** — Auditer schéma Prisma, invariants SQLite, transactions, unicité, coûts, migrations et restauration.
- **`securite-confidentialite`** — Contrôler authentification par session, RBAC, accès HTTP, DTO récursifs, CSP, CSRF, exports et fuites inter-rôles.
- **`achats-p2p`** — Auditer fournisseurs, liens matières, demandes achat, BC, BR, sourcing, qualité, factures, paiements et retours.
- **`stocks-qualite`** — Auditer lots, emplacements, FEFO/FIFO, CUMP, qualité, inventaires, retours et cohérence des mouvements.
- **`ventes-directeur`** — Auditer devis, commandes, salon en ml, BL partiels, factures, avoirs et approbation des prix spéciaux par le directeur.
- **`catalogue-gabarits`** — Auditer taxonomie catalogue SODEPI, codification, produits ouate, mousse et géométrie Richbond en mètres linéaires.
- **`ux-accessibilite`** — Protocole UX/UI expert ERP en 10 axes ; phases 1–4, rapport prouvé, puis **STOP** jusqu’à validation des corrections.
- **`tests-navigateur-playwright`** — Recettes multi-rôles, captures et mesures de navigateur ; exécution isolée sur base fictive.
- **`performance-react-nextjs`** — Diagnostic React/Next.js et fluidité sans modification métier.
- **`finance-maroc`** — Auditer cohérence des factures, TVA, avoirs, centimes, export CSV et applicabilité des obligations marocaines.
- **`exploitation-resilience`** — Auditer installation, configuration, TLS, opérations multi-utilisateurs, backup/restore, logs, performance et reprise.
- **`benchmark-normes`** — Comparer les tâches ERP utiles à SODEPI et vérifier normes techniques avec sources, éditions et preuves comparables.
- **`nettoyage-code`** — Supprimer fichiers inutiles, doublons, artefacts et code mort avec inventaire d'usages et non-régression.
- **`contre-audit-livraison`** — Recontrôler tous les correctifs de la dernière version et valider les deux ZIP avec manifestes et tests rejoués.

## Ordre d'une mission complète
1. `audit-orchestrator` → `preuve-tracabilite` → `build-ci` → `sqlite-integrite`.
2. En parallèle sur **copies de recette distinctes** : `securite-confidentialite`, `achats-p2p`, `stocks-qualite`, `ventes-directeur`, `catalogue-gabarits`, `ux-accessibilite`, `tests-navigateur-playwright`, `performance-react-nextjs`, `finance-maroc`, `exploitation-resilience`, `benchmark-normes`.
3. `nettoyage-code` sur branche/copie à part, sous contrôle des tests et du graphe d'import.
4. `contre-audit-livraison` sur un ZIP final neuf, sans recycler les preuves d'avant modification.

Le travail parallèle nécessite des copies DB indépendantes. N'écrivez jamais deux campagnes simultanément sur le même fichier SQLite.

**Règle de priorité UX :** lorsque la mission demandée est un audit UX seul, la chaîne s’arrête après le rapport de phase 4, sans correctif automatique.

## Ajout P5.15.4 — circuit article commun / revente
- **`articles-negoce-o2c`** — Appliquer `fsnw/skills/articles-negoce-o2c/SKILL.md` en parallèle avec `ventes-directeur`, `stocks-qualite`, `securite-confidentialite` et `sqlite-integrite` pour tester l'article commun, le stock disponible/réservé, la réservation, le BL et le reliquat. Cette extension de procédure ne change pas la doctrine SODEPI.

## P5.15.5 — Poste de travail acheteur
- **`acheteur-poste-travail`** — Vérifier la séparation rupture/stock faible/fabrication, les DA ouvertes, les BC en transit, les fournisseurs actifs et la navigation du compte acheteur. Les tâches sont informatives, non des DA automatiques.

## P5.15.6 — Navigation acheteur par processus
- **`acheteur-navigation-complete`** — Tester les 7 onglets de l’acheteur, le guidage des transitions, les comptes multi-rôles et la consultation des BR en lecture seule.


## Complément technique — CASCADE4-R1 (20 skills conservés)
Pour les audits des versions actuelles, répartir obligatoirement les sujets transversaux :

- **Approbations client, OF, doublons :** `ventes-directeur` + `securite-confidentialite` + `tests-navigateur-playwright`.
- **Réservations et concurrence :** `stocks-qualite` + `articles-negoce-o2c` + `sqlite-integrite`.
- **Révocation de droits et confidentialité DTO :** `securite-confidentialite` + `preuve-tracabilite`.
- **Scellement HMAC et historique :** `preuve-tracabilite` + `sqlite-integrite` + `exploitation-resilience`.
- **Centimes, NaN, métrage / étiquettes :** `finance-maroc` + `catalogue-gabarits` + `ventes-directeur`.
- **Windows et archives :** `exploitation-resilience` + `build-ci` + `contre-audit-livraison`.

Voir `REFERENTIEL_CONTROLES_CASCADE4_R1.md`. Ce complément précise les **tests de règles existantes** ; il ne crée pas de nouvelle règle métier et ne vaut pas validation de production.
