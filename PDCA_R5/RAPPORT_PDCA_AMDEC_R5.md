# GoCmd / SODEPI — V2 R5 : PDCA + AMDEC + 20 skills

**Version :** R5 issue de l'archive officielle candidate R4. **Date :** 11 novembre 2026.  **Verdict : NO-GO production.**

## P — PLAN (définir le risque et les conditions d'acceptation)

Périmètre conservé : achats (DA, consultations, offres téléphoniques, BC, BR, qualité, factures), catalogue MP/PF, stocks, finance, ventes (devis, commandes, validation prix), ordres simplifiés, livraison et interface bureau/tablette/mobile. Le programme GoProd BOM/MRP et consommation automatique des matières est **hors périmètre**.

Objectifs de preuve : zéro doublon d’identité MP/PF, zéro FK orpheline, zéro historique fictif dans la DEMO, aucun OF avant approbation indépendante, prix spécial visé par le directeur au niveau de la ligne, absence de fuite inter-rôles et zéro suppression d’une base réelle. Un échec P0 bloque le GO.

Les 24 constats du contre-audit n°2 et 2 nouveaux écarts R5 sont repris dans `REGISTRE_AMDEC_R5.csv`, avec cotation **historique indicative** G/O/D de 1 à 5 (IPR=G×O×D). **Pas d'IPR résiduel artificiel** : probabilité et détection en exploitation ne sont pas mesurées.

## D — DO (changements réellement appliqués en R5)

1. **Workflow OF GEN :** la configuration `requiresPreparation` propre à la ligne pilote l'émission d'OF **après approbation** ; les GEN sans préparation n'en reçoivent pas. Les références catalogue conservent leur comportement historique, sans inventer de règle MRP/BOM.
2. **Quatre yeux :** aucun OF généré par la saisie commerciale ; la génération demeure transactionnelle dans le circuit d'approbation. Les reprises manuelles via `/api/work-orders` rejettent les GEN sans préparation (HTTP 409 attendu, pas validé sur serveur).
3. **Prix/traçabilité :** garde au moment de l'émission de l'OF contre un snapshot technique absent, altéré ou incohérent avec l'unité, le prix et la quantité de la ligne. Ce contrôle est une barrière applicative, **pas un scellement HMAC de base**.
4. **Interfaces :** case à cocher « Fabrication/préparation nécessaire » dans création et édition de ligne GEN ; panneau OF affichant « Aucun OF requis » et masquant l'action de régularisation ; message explicite dans l'API.
5. **BDD DEMO :** recréée sur une COPIE de R4 à partir du seed V2. Une sauvegarde SQLite de la démo précédente a été créée **hors archive**. Matériels/produits/tiers/lots conservés, aucune commande ni pièce historique ; garde anti-reset production active. Aucun autre environnement n'a été touché.
6. **Réservations P6 :** le seed ajoutait `engagedAt NOT NULL DEFAULT CURRENT_TIMESTAMP` sans triggers, ce qui rompait l’origine de l’engagement lors des inserts SQL rétrodatés. Nouveau schéma DEMO : colonne avec triggers de remplissage et immutabilité, 8 scénarios de migration / 80 vérifications réelles, test de reconstruction isolée réparé. Ce changement n’a été appliqué qu’au seed et à la DEMO R5, pas à une base de production.
7. **Qualité :** tests ciblés de sélection OF, protection de snapshots, absence d'OF prématurés, contrôle de la base et matrice de 20 skills ; nouveau contrôle intégré au workflow CI R5.

## C — CHECK (mesures et preuves)

- `npm run test:v2:r5` : tests V2 R4 conservés + 5 scénarios R5 nouveaux + contrôles statiques/SQLite R5 ; résultat enregistré dans le journal de preuve.
- `scripts/run_r5_skill_matrix.py` : 20 skills inventoriés ; 14 scripts ciblés réussis, 6 non testés dans cette matrice (certains audités ensuite sur le ZIP final).
- Tests supplémentaires : `npm run test:cascade:p6`, `npm run test:work-orders:p51521`, `python tests/test_cascade2_engagement_guards.py` et `python tests/test_p51523_demo_reseed.py` réussis sur R5.
- `PRAGMA integrity_check` : `ok` ; `PRAGMA foreign_key_check` : aucune ligne.
- DB livrée : 82 MP, 218 produits (189 PF fixes, 29 liens de négoce), 18 fournisseurs, 135 liens, 64 lots, 10 clients et 9 utilisateurs fictifs ; aucune DA, CMD, OF, facture, BR ou devis historique.
- `node scripts/check_v2_ts_syntax.cjs` : contrôle syntaxique, **pas typage TypeScript**.
- Les tests de fonction et les tests Python SQL ne sont **pas** une preuve de conformité HTTP/Playwright/Windows.

## A — ACT (actions obligatoires avant homologation)

**P0 à clôturer sur l'archive finale :** installation dépendances exactes (Bun 1.3.14 et Node >=24), validation/génération Prisma, compilation TypeScript, lint, `next build`, campagne API multi-rôles (sessions nominatives, révisions prix/GEN/quatre yeux/OF), Playwright sans erreur 320/375/768/1024 px, BL-facture-avoir/stock génériques, sauvegarde/restauration et performances 10k/100k.

**P1 / arbitrages :** dictionnaires techniques hors mousse et conventions de dimensions, alias fournisseurs, GTIN si besoin, FEFO, politique TVA et devis, circuits achat téléphonique multi-fournisseurs, choix définitif des OF sans préparation.

**Terrain :** recette Windows serveur unique, réseau Wi-Fi/tablettes, accès distant TLS, restauration chiffrée indépendante, signatures Métier/Qualité/Finance. Sans ces signatures, version **CANDIDATE**.

### Décision par axe

| Axe | Verdict R5 | Pourquoi |
|---|---|---|
| Logiciel | **Partiel, NO-GO** | Correctifs fonctionnels contrôlés, pas de build/HTTP/E2E complets |
| Données fictives | **Conforme aux contrôles ciblés DEMO** | Reset, inventaire, FK/SQL, lots d'ouverture |
| Sécurité / traçabilité | **Partiel, NO-GO** | Gardes de code, mais pas de tests de révocation HTTP R5 |
| UX/UI | **Implémentation en code non réceptionnée** | Pas de captures/méthodes clavier/tactile sur navigateur |
| Exploitation Windows | **Non testée** | Matériel réseau/service/backup sur site absent |
| Fiscalité / normes | **À arbitrer** | Aucune certification ISO, GS1, comptable ni benchmark revendiqué |

## Livrables

`REGISTRE_AMDEC_R5.csv`, `MATRICE_20_SKILLS.md`, `preuves/skills_matrix.json`, `PLAN_RECETTE_R5.md`, scripts de test R5, projet complet ZIP, correctif autonome ZIP et preuves finales ZIP. Les preuves ne valent que pour les octets identifiés par SHA-256.
