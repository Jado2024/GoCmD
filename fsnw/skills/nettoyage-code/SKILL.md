---
name: gocmd-nettoyage-code-sans-regression
description: "Supprimer fichiers inutiles, doublons, artefacts et code mort avec inventaire d'usages et non-régression."
---

# Skill — gocmd-nettoyage-code-sans-regression

## Quand utiliser
Supprimer fichiers inutiles, doublons, artefacts et code mort avec inventaire d'usages et non-régression.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Nettoyer le projet sans casser les imports, migrations, recouvrements comptables, scripts de tests ni audits historiques.

## Procédure obligatoire
1. Inventorier fichiers code/docs/data, taille, hash, doublons exacts, caches `.next`, `node_modules`, `tsconfig.tsbuildinfo`, bases sauvegardes et secrets.
2. Analyser graphe imports TS/TSX, `package.json` scripts, `.github/workflows`, tests et références dynamiques Next.js (routes fichiers) avant toute suppression.
3. Classer chaque candidat : inutilisé confirmé, duplicata conservant exemplaire canonique, archive historique, nécessaire runtime, migration à garder, incertain (ne pas supprimer).
4. Ne supprimer que les candidats justifiés, déplacer les anciens rapports uniques vers `docs/historique` sans changer leur sens ni rompre les assertions tests.
5. Inspecter dépendances inutilisées mais ne pas modifier lockfile sans `bun install --frozen-lockfile` et validation depuis ZIP final.
6. Réaliser `git diff --stat`, comparer hashes source pour fichiers non concernés, relancer tests et compilation.
7. Fournir `fichiers_supprimes.csv`, `fichiers_conserves_raison.csv`, nouveaux SHA et procédure de retour arrière.

## Vérifications et critères d'acceptation
Interdiction de supprimer des tables historiques, migrations Prisma, scripts CI, route fichier Next.js ou données métier sous prétexte d'inutilité ; ne pas désactiver un test gênant pour obtenir PASS.

## Livrables attendus
`inventaire_fichiers.csv`, `decision_suppressions.md`, hash avant/après, ZIP propre reproductible.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — conservation des skills
- Inventorier les `SKILL.md` **avant et après** nettoyage, vérifier les références et exécuter `python fsnw/tools/verifier_skills.py`. Ne pas confondre « 20 fichiers présents » et « 20 consignes actualisées ».
- Conserver séparément les sources historiques et les documents de preuve de livraison ; une archive documentaire ne prouve pas que les skills sont cohérents avec le code actuel.
- En cas d'ajustement documentaire, vérifier chaque modification par diff et conserver les 20 skills actifs sans ajout de doublons inutiles.
- Interdire de supprimer une migration, une fixture ou un script parce qu'il paraît ancien : contrôler sa présence dans les chaînes de non-régression et de restauration.
