---
name: gocmd-build-et-ci
description: "Auditer installation reproductible npm/lockfile, Prisma, TypeScript, lint, régression, build et CI sans faux PASS."
---

# Skill — gocmd-build-et-ci

## Quand utiliser
Auditer installation reproductible npm/lockfile, Prisma, TypeScript, lint, régression, build et CI sans faux PASS.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Valider la chaîne réellement exécutable de la version GoCmd courante, de l'extraction fraîche à la compilation Next.js et aux recettes isolées.

## Procédure obligatoire
1. Utiliser un dossier temporaire vide, vérifier la version Node.js exigée et le gestionnaire de paquets officiellement utilisé, isoler `.env` sans recopier des secrets.
2. Exécuter séparément les commandes du bloc ci-dessous et conserver chaque code de sortie.
3. Vérifier en priorité `package-lock.json` avec `npm ci` ; si Bun est explicitement utilisé, contrôler aussi `bun.lock`. Refuser toute régénération silencieuse des lockfiles.
4. Lire `.github/workflows/ci.yml` et établir la couverture effective : lint, migrations, typage, tests unitaires, HTTP sur serveur et build.
5. Comparer scripts déclarés dans `package.json` avec fichiers réellement présents et sous-commandes protégées contre les bases réelles.
6. Exécuter recettes HTTP uniquement sur copie DB et serveur local de production ; distinguer statique, tests Node/SQL, HTTP et navigateur.
7. Réexécuter **depuis le ZIP final** après nettoyage ou refactor et fournir logs complets.

## Vérifications et critères d'acceptation
```bash
npm ci
npx prisma validate
npx prisma generate
npm run test:types
npm run lint
npm run test:regression
npm run build
# TEST HTTP seulement si base fictive jetable et comptes distincts :
# npm run test:http:privacy
```
Vérifier `exit 0` indépendamment pour chaque gate ; un warning lint est à reporter même si le code de sortie vaut 0. Interdire tout `db push`/`migrate dev` sur base réelle.

## Livrables attendus
`preuves/build/*.log`, `resultats_gates.csv`, comparaison des jobs CI aux tests réellement exécutés.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — portes de livraison
- Vérifier la version Node exigée par `package.json` et le **runtime réellement exécuté** ; ne pas assimiler un cache de dépendances incomplet à un défaut applicatif.
- Exécuter les scripts réellement déclarés dans `package.json`, notamment `test:regression`, `test:http:all`, `test:http:c4`, `test:c4:fixes`, `test:e2e`, ainsi que le build de production ; journaliser chaque code retour sans le masquer par `tail` ou un pipeline.
- Contrôler que les assertions historiques suivent la règle actuelle : toutes les commandes démarrent en attente de validation et aucun OF n'est généré avant approbation indépendante.
- Ajouter des scénarios de mutation à causalité vérifiée : retrait d'une garde RBAC, d'un contrôle quatre-yeux ou d'un verrou doit provoquer un échec **pour la bonne raison**.
- Exiger une réinstallation et une nouvelle compilation depuis le ZIP final, pas uniquement depuis l'arborescence de travail.
