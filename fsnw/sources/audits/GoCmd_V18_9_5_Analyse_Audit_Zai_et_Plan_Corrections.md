# GoCmd V18.9.5 — Vérification indépendante ciblée du rapport Z.ai

Date : 2 novembre 2026. Base : archive `workspace-...tar` remise par l'utilisateur, contenant `audit_workspace` (code GoCmd), `src/lib/audit-data.ts` (registre Z.ai) et l'archive source. Ce document n'est pas une homologation de production.

## Statut et portée

- Z.ai déclare : 14,2/20, 82 constats, dont 0 P0, 8 P1, 25 P2, 34 P3, 15 Info. La note reflète sa propre méthode : ne pas la comparer directement à une grille pondérée de conformité métier ni à une norme.
- Dans cette passe : inspection indépendante des routes sensibles et des scripts CI/ESLint, contrôle `PRAGMA integrity_check` et `foreign_key_check`, contrôle des comptes `Client` (sans exposer d'identité), exécution locale des tests Python `test_v1895_director_prices.py`, `test_v185_security_and_quality.py`, `test_v1893_catalogue_db.py` : tous PASS.
- Installation Bun, compilation TypeScript complète, build Next et scénarios HTTP *non rejoués par cet examen* ; les PASS correspondants reposent sur les journaux de Z.ai, pas sur notre propre reproduction.

## Constats urgents : règles de confidentialité

### S01 — GET réception fournisseur révèle coûts aux profils non autorisés
**Preuve** : `audit_workspace/src/app/api/goods-receipts/route.ts:15-18` ne contrôle que l'authentification et retourne `supplierOrder` complet, `supplierOrderLine` complet, `material` complet. Ces objets contiennent des champs de coût et prix. Cela contourne le filtrage de `src/app/api/materials/route.ts`.
**Correction** : définir une matrice explicite, par exemple `buyer/approver/finance/admin` pour les coûts ; `receiver/quality/inventory` pour les quantités, lots, dates, références et fournisseurs autorisés. Utiliser `select` Prisma minimal et DTO de réponse : jamais diffuser des objets Prisma bruts.
**Preuve de clôture** : requête HTTP avec comptes `receiver`, `quality`, `inventory`, `sales`, `buyer`, `finance` ; vérifier l'absence récursive de `unitPrice`, `averageCost`, prix de lignes BC et de tout champ financièrement sensible pour les profils non autorisés.

### S02 — GET retours fournisseurs révèle avoirs et données fournisseurs
**Preuve** : `audit_workspace/src/app/api/supplier-returns/route.ts:11` renvoie `supplier` complet et `creditNote.amount` à tout compte connecté.
**Correction** : limiter les détails financiers aux rôles habilités ; permettre au rôle qualité d'accéder aux quantités, raisons et états nécessaires à son travail, sans avoirs ou coordonnées non nécessaires.
**Test** : GET depuis qualité/magasinier ne renvoie ni montant d'avoir ni données de contact non autorisées ; finance accède aux informations utiles.

### S03 — GET sourcing expose les tarifs des offres
**Preuve** : `audit_workspace/src/app/api/p2p/sourcing/route.ts:19-26` retourne `offers.unitPrice` à toute identité authentifiée.
**Correction** : filtrage serveur de lecture par rôle ; DTO dédié aux rôles non habilités, ou 403 si aucune donnée métier nécessaire à leur poste. Ne pas confondre masquage visuel et permission API.
**Test** : GET avec quality/receiver/sales et buyer/finance/approver ; comparer absence/présence de tarifs selon la matrice approuvée SODEPI.

### S04 — Données clients dans le livrable et dans le rapport d'audit
**Preuve** : `audit_workspace/db/custom.db` contient 10 fiches `Client`, dont 2 hors des 8 données de démonstration définies dans le seed. La réalité des identités ne peut pas être établie par l'archive seule. Le registre interactif Z.ai `src/lib/audit-data.ts` reproduit aussi certains noms et une coordonnée.
**Correction** : conserver une sauvegarde privée sécurisée si une enquête métier est nécessaire ; distribuer une base démo **synthétique seulement**, supprimer toute donnée identifiante des rapports et journaux publiés ; reproduire un test qui compare chaque ligne distribuée au seed autorisé.
**Ne pas** purger aveuglément une éventuelle base opérationnelle ni altérer des archives à valeur probante sans protocole convenu.
**Test** : rezipper, réextraire et chercher noms, emails, téléphones et identifiants réels dans DB, textes, captures, artefacts et fichiers Git embarqués.

## Qualité & exploitation : correctifs prioritaires après confidentialité

### Q01 — CI incomplète
**Preuve** : `.github/workflows/ci.yml` lance install figé, Prisma, typecheck, régression et build, mais pas `bun run lint` ni aucune recette HTTP ; `package.json` possède des scripts HTTP distincts.
**Correction** : ajouter lint et des E2E HTTP fiables sur une base SQLite *temporaire et isolée*, avec serveur `next start`, comptes RBAC factices et nettoyage garanti ; inclure tests de prix directeur et de régression des trois leaks de coûts.

### Q02 — ESLint trop permissif
**Preuve** : `eslint.config.mjs` désactive explicitement de nombreuses règles, dont `no-undef`, `no-unreachable`, `react-hooks/exhaustive-deps`, `no-unused-vars`.
**Correction** : réactiver progressivement les règles de sûreté, corriger les violations au lieu d'échouer massivement d'un coup. Différencier code applicatif et tests/scripts.

### Q03 — Conventions monétaires à homogénéiser
**Preuve** : schéma Prisma avec `Float`, `Decimal` et montants en centimes selon les modules ; voir `DB-01` du rapport Z.ai.
**Correction** : norme monétaire unique pour tout nouveau développement (Decimal ou centimes entiers), inventaire des chemins de conversion historiques, tests TVA, crédits, frets et arrondis aux demi-centimes avant migration.

### Q04 — Scripts de migration/backup et démarrage
**Preuve** : `package.json` conserve `db:migrate` (`prisma migrate dev`) sans historique Prisma migrations, alors que les schémas sont aussi gérés par scripts et `db push`. Certains scripts de backup utilisent `shutil.copy2` au lieu de `sqlite3.backup`.
**Correction** : retirer/neutraliser le script dangereux, documenter la migration autorisée, sauvegarder de façon transactionnelle, vérifier le restore et interdire toute migration sur une DB utilisée par un serveur actif. Documenter HTTPS obligatoire et `start:checked`.

## Prix directeur V18.9.5

- **Confirmé dans la source** : rôle `director` explicite et distinct d'`admin` (`src/lib/access-gate.ts:67-72`) ; proposition par rôle commercial, décision par directeur, refus de l'auto-approbation ; historique d'audit et modification des commandes provisoires (`products/[id]/director-price/route.ts`). Des garde-fous tarifaires existent dans les routes devis, commandes et ventes.
- **Tests réellement rejoués dans cette passe** : `test_v1895_director_prices.py` PASS, mais la plupart de ses contrôles sont statiques / base.
- **Non démontré indépendamment** : une recette multi-comptes bout en bout avec API + UI du directeur. Ajouter scénarios proposer → approuver prix différent → convertir devis → livrer → facturer ; tentatives refusées avec admin/approver/quality ; changement de prix ; concurrence ; historiques après refus.
- **Choix métier à confirmer** : une modification de prix spécial est interdite dès qu'un devis, même brouillon, existe (`director-price/route.ts:42-44`) ; peut être trop contraignant pour le travail commercial.

## Périmètre SODEPI non négociable

**Hors périmètre GoCmd :** nomenclatures/BOM, consommations automatiques de MP, MRP, OF industriels, coûts réels de fabrication. **Non obligatoire :** suffixe C/S. Ne jamais les noter comme bugs, ni les ajouter pour embellir les scores.

## Ordre de traitement recommandé

1. Confidentialité S01–S03 et assainissement des livrables S04.
2. Tests HTTP multi-rôles incluant prix directeur, puis intégration CI Q01.
3. Sécuriser déploiement/HTTPS et procédure de migration Q04.
4. Réactiver les règles ESLint de sûreté Q02, stabiliser la chaîne.
5. Plan progressif d'unification monétaire Q03.
6. Recette terrain SODEPI : deux utilisateurs réels, gabarit 51 validé atelier, inventaire, qualité, facturation, sauvegarde-restauration et avis comptable marocain.

## Règle de clôture

Chaque anomalie doit recevoir : fichier/ligne, preuve avant, code modifié, test positif, test d'accès refusé, conservation du comportement utile, exécution CI, preuve sur ZIP final extrait. Un « PASS du build » n'est jamais synonyme d'absence de fuite de données ni de validation métier.
