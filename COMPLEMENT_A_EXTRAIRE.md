# Complément GoCmd R13.3 — À extraire à la racine du projet existant

**Source exacte attendue** : `GoCmd_SODEPI_R13_3_PROJET_NETTOYE_ORGANISE.zip` (SHA-256 `d32166507a611164b85f2babc2836ba5656b6361f1dbd9ceef6f447802cdc2c2`).

Ce complément est un **overlay**, sans dossier parent supplémentaire. Si le projet existant contient `package.json` et le dossier `src/`, extraire directement **dans ce dossier** en autorisant le remplacement des fichiers. Il ajoute/modifie uniquement les fichiers indiqués par `MANIFESTE_COMPLEMENT_SHA256.txt`. Il ne contient pas de base de données.

**Précautions :**

1. Arrêter le service GoCmd, puis conserver une sauvegarde du projet et **une sauvegarde SQLite cohérente** avant toute modification.
2. Vérifier la version initiale ; ne pas appliquer cet overlay à R13.2, à une ancienne R13.3 non nettoyée ou à une base de production sans recette qualifiée.
3. Extraire l'archive au niveau de `package.json`, **pas dans `src/` et pas dans un sous-dossier `complément/`**.
4. Conserver les règles métier, migrations, bases et fichiers locaux non présents dans l'overlay.
5. Sous Node 24 : `npm ci`, `npx prisma generate`, `npm run test:qwen:targeted`, `npm run test:types`, `npm run lint`, `npm run build`, puis les recettes HTTP, sécurité, concurrence et Playwright.
6. Tant que l'intégralité des tests n'est pas passée, l'archive reste une **candidate à validation** : **ne pas mettre en production**.

**Retour arrière :** arrêter le serveur, restaurer les fichiers du ZIP nettoyé d'origine sur une copie du projet ; ne pas effacer ni réinitialiser la base. Si des opérations ont été exécutées depuis, traiter les données métier par la procédure de reprise, sans restaurer aveuglément une base ancienne.

Rapports : `RAPPORT_CORRECTIONS_QWEN_2026-11-13.md` et `PLAN_CLOTURE_APRES_QWEN.md`.
