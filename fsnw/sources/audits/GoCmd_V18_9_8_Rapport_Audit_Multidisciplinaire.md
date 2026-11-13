# GoCmd V18.9.8 — Audit multidisciplinaire, corrections et nettoyage prudent

**Date : 02/11/2026.** **Source :** archive GoCmd V18.9.7 auditée/nettoyée. **Cible :** GoCmd V18.9.8, candidat de recette — **pas homologué ni certifié**.

## 1. Synthèse exécutive et portée

- **Deux anomalies P1 de confidentialité traitées** : agrégats monétaires d'achats visibles sur le tableau de bord (SEC-DASH-01) et consultation de données clients/commandes par un compte partagé de démonstration (SEC-DEMO-01).
- **Une anomalie P2 de confidentialité traitée** : commentaire libre de commande présent dans les échéances publiques du tableau de bord (SEC-DASH-02).
- **Une amélioration P2** : `Cache-Control: private, no-store` + `Vary: Authorization` pour clients, commandes et tableau de bord ; tests multi-rôles ajoutés à la CI HTTP existante.
- **Nettoyage prudent** : quatre doublons de documentation supprimés, quatre notices historiques déplacées dans `docs/historique`, caches Python et TypeScript exclus du ZIP, numérotation actualisée. **Zéro modèle Prisma, migration, test historique ou fonctionnalité métier supprimé sans preuve de non-usage.**

L'absence de BOM, d'ordres industriels, de consommation automatique des MP, de MRP et de suffixe obligatoire C/S est **hors périmètre GoCmd** et n'entre pas dans les non-conformités.

## 2. Matrice des disciplines et conclusions

| Discipline | Revue / preuve accessible | Conclusion / suites nécessaires |
|---|---|---|
| Authentification et RBAC | `src/lib/access-gate.ts`, exécution Node de 7 rôles distincts + compte partagé | Le directeur demeure un rôle explicite ; le compte partagé ne franchit plus les portes de lecture nominatives. Rejouer HTTP Basic derrière HTTPS. |
| Confidentialité des achats et clients | `dashboard/route.ts`, `orders/route.ts`, `clients/route.ts` ; tests dynamiques ACL + contrats statiques | Correctifs P1/P2 présents ; vérifier la réponse JSON réelle par rôle en CI et avec Z.ai. |
| Achat P2P fournisseurs | Routes BC/BR, sourcing et fournisseur, précédentes régressions | Aucun changement dans l'algorithme DA/BC/BR ; essais d'intégration réels à renouveler sur ZIP final. |
| Stock, qualité et traçabilité | Contrôle SQLite, tests historiques de lots/FEFO/CUMP et contre-audit V18.9.7 | Base intègre et contrôles historiques passés avant le dernier groupe interrompu ; contrôle de stock physique et FEFO terrain encore nécessaires. |
| Vente O2C | Routes devis, commandes, BL, factures ; test du gabarit 11 et du salon | Périmètre conservé ; vérifier HTTP de bout en bout sur la version candidate. |
| Prix directeur | `isDirector` évalué réellement avec directeur/admin ; test V18.9.5 | Un admin seul ne devient pas directeur ; validation tarifaire applicative à rejouer en navigateur/HTTP. |
| Finance / TVA / avoirs | Tests historiques V18.9.2 et V18.9.6 ; aucune altération des algorithmes de crédit | Réconciliation, facturation Maroc et cas limites des arrondis nécessitent encore des vérifications. |
| Base de données / migrations | SQLite `integrity_check=ok`, `foreign_key_check` vide, 47 tables | Schéma et données conservés. SQLite multi-processus et reprise d'incident non certifiés. |
| Qualité du code | 89 fichiers TS/TSX analysés syntaxiquement ; CI existante | `tsc` intégral, ESLint et `next build` non reproductibles ici sans installation ; règles ESLint précédemment neutralisées restent à réhabiliter. |
| UX/accessibilité | Adaptation UI du dashboard, null pour valorisation interdite | Aucun prix masqué remplacé par 0 ; graphiques absents sans droit. Navigation, clavier, responsive et contraste à vérifier sur navigateur. |
| Exploitation / sauvegardes | Scripts `start:checked`, `backup_sqlite.py`, en-têtes de réponse privés | Déploiement sous HTTPS, sauvegarde/restauration réelle, seuil de charge à mesurer. |
| Dossier livré / obsolescence | Comparaison SHA-256 V18.9.7 → V18.9.8, doublons, ZIP contrôlé | Code conservé lorsqu'il existe une dépendance potentielle ; archives historiques préservées sans doublons. |

## 3. Registre détaillé des corrections

### SEC-DASH-01 · P1 · Valeur de stock divulguée indirectement
**Avant :** `src/app/api/dashboard/route.ts` masquait `unitPrice` et `averageCost` pour les rôles non autorisés, mais renvoyait `kpi.stockValue`, `byCategory[].value` et les flux journaliers `flow[].in/out` valorisés en MAD à n'importe quel utilisateur authentifié. Le regroupement par catégorie pouvait renseigner des valeurs financières malgré l'interdiction d'accéder aux prix unitaires.

**Après :** application unique de `canSeeMaterialCosts(req)` aux agrégats ; `kpi.stockValue=null`, `byCategory=[]`, `flow=[]` pour les rôles sans habilitation. `DashboardDTO` documente le `null` ; l'interface indique « Accès limité » et ne rend plus les graphiques financiers. Les stocks quantitatifs, alertes et échéances restent accessibles.

**À vérifier :** connexion qualité, commercial, réceptionnaire, magasinier, directeur, acheteur, finance et admin ; confirmer que les JSON interdits ne contiennent pas de MAD, que le prix ne réapparaît pas dans les composants et que les rôles autorisés conservent les graphiques. Aucun masquage purement CSS n'est accepté.

### SEC-DEMO-01 · P1 · Compte partagé / confidentialité client
**Avant :** le compte partagé héritait d'une lecture des commandes et clients via `actor.legacy` et franchissait `hasAnyReadRole`, bien qu'il ne soit pas nominatif. Le dashboard traitait aussi ce compte comme un commercial pour les données clients.

**Après :** suppression de ces exceptions dans `orders/route.ts`, `clients/route.ts`, dashboard et `hasAnyReadRole`; conservation des comptes personnels et du principe de compte démo en lecture restreinte. `Cache-Control: private, no-store` et `Vary: Authorization` sur les réponses concernées.

**À vérifier :** configurer un compte partagé de démonstration sur **base fictive**, sans comptes nominatifs ; GET clients/commandes/P2P à 403, dashboard sans coûts ni coordonnées ; comptes nominatifs sales/finance/director autorisés selon leurs rôles. Ne pas connecter une ancienne base réelle à une démonstration publique.

### SEC-DASH-02 · P2 · Notes libres de commandes
**Avant :** `upcoming[].note` transmettait les commentaires de commande même lorsque `client` et `total` étaient déjà `null`.

**Après :** commentaire masqué aux non-commerciaux (`note: null`). Les identifiants de commande nécessaires à la planification restent visibles.

### QA-HTTP-01 · P2 · Tests de confidentialité insuffisants
**Avant :** `tests/ci-v1896-isolated-http.cjs` vérifiait les documents fournisseurs, mais pas la valorisation du dashboard, ni les refus 403 des clients/commandes.

**Après :** ajouts d'assertions des agrégats absents, notes masquées, GET clients/commandes 403 pour quatre rôles non habilités ; assertions positives des valorisations autorisées et de la lecture commerciale/du directeur. Ce script est déjà appelé par `.github/workflows/ci.yml` **après un build réussi**.

### CLEAN-01 · P3 · Déduplication et archivage
**Avant :** quatre documents strictement identiques étaient présents à la racine et dans `docs/historique`, plus d'anciens rapports racine. **Après :** suppression des copies racine vérifiées identiques par SHA-256, archivage des quatre documents plus anciens, suppression/exclusion des `.pyc`, `__pycache__` et `.tsbuildinfo` ; README de la version courante mis à jour. Les fichiers techniques qui pourraient être liés à des migrations ou à la traçabilité sont conservés.

## 4. Tests vraiment exécutés dans cet environnement

- **Archive de départ** : extraction et copie isolée V18.9.7.
- **Base** : SQLite `PRAGMA integrity_check` = `ok`, `PRAGMA foreign_key_check` = 0 anomalie ; 47 tables.
- **Suite historique V18.9.7 (avant modification)** : `npm run test:regression:runtime`, code retour **0**.
- **V18.9.8** : `npm run test:v1898`, **PASS** : tests Node des rôles (scrypt, Basic Auth, directeur vs admin, compte démo, droits coût), contrats statiques de la réponse API/UI, validation SQLite.
- **Tests v18.9.5, v18.9.6 et v18.9.7** : exécutés séparément sur le code corrigé, **tous exit 0**.
- **Relance historique V18.9.8** : progression jusqu'à v18.9.3 incluse ; **interrompue par la limite de durée de l'environnement** avant la fin. Les groupes v18.9.5 à v18.9.8 ont été réexécutés séparément avec succès. Cette coupure ne vaut **pas** réussite d'un `npm run test:regression` intégral.
- **Syntaxe TypeScript/TSX** : 89 fichiers transpile-analysés avec TypeScript global, **0 erreur syntaxique**. Cela ne remplace PAS `tsc --noEmit` ni une compilation Next.js.
- **Vérification HTTP sur serveur Next**, `bun install --frozen-lockfile`, `prisma generate`, `tsc` global, ESLint, build et tests navigateur : **NON exécutés ici** : Bun et dépendances Next/Prisma absents, registre npm non joignable (`EAI_AGAIN`). Ces portes demeurent obligatoires.

## 5. Risques résiduels à ne PAS masquer

| Importance | Sujet | Preuve de fermeture attendue |
|---|---|---|
| P1 — sécurité | Basic Auth exposée sans HTTPS ; limitation des échecs en mémoire de processus | Test du reverse proxy HTTPS, HTTP externe refusé, limitation par IP et journalisation. |
| P1 — recette | Nouvelle politique clients/commandes/dashboard non rejouée avec Next en HTTP réel | Script CI `ci-v1896-isolated-http.cjs` PASS, plus parcours navigateur par rôle sur base isolée. |
| P1 — exploitation | Sauvegarde, restauration et droits sur la base au poste réel | Sauvegarde vers un support distinct, restauration chronométrée et validée. |
| P2 — concurrence | SQLite mono-processus ; absence de preuve multi-instance et volumétrie | Déploiement mono-instance verrouillé ou tests multi-processus + stratégie DB. |
| P2 — finance | Prix Float et Decimal/centimes coexistent | Tests propriétés multi-lignes et arrondis TVA, validation comptable Maroc. |
| P2 — qualité du code | ESLint contient plusieurs règles désactivées ; code volumineux | Relever les règles par lots, corriger les usages, sans désactiver l'intégration continue. |
| P2 — UX | Accessibilité WCAG 2.2 et pratique tablette / opérateurs | Clavier, zoom/reflow, lecteur d'écran, panel d'utilisateurs SODEPI. |
| Métier à confirmer | Gabarit Richbond 51 | Plan atelier coté avec convention K/L/H signé avant correction de calcul. |
| Juridique | Loi 09-08/CNDP, fiscalité et archivage Maroc | Validation écrite des personnes compétentes ; ne pas déclarer conforme par auto-audit. |

## 6. Instructions de validation sur la V18.9.8

Sur **copie de la base** et machine avec Bun 1.3.14, Node.js 22/24, Prisma et Next :

```bash
bun install --frozen-lockfile
bunx prisma validate && bunx prisma generate
bunx tsc --noEmit
bun run lint
npm run test:regression
bun run build
npm run test:http:privacy  # script CI, serveur local et copie de DB uniquement
```

Ensuite réexécuter les recettes historiques HTTP P2P/O2C/qualité/avoirs/concurrence et le circuit prix directeur en vrais comptes. Après déploiement, vérifier les cas inverses : opérations refusées, double validation, prix modifié après accord, même facture utilisée deux fois, stock périmé, panne réseau et redémarrage.

**Verdict : V18.9.8 est une candidate corrective plus sûre, pas une version “sans bugs” ni certifiée conforme aux normes.** L'objectif reste une fiabilité comparable aux produits professionnels **sur le périmètre GoCmd**, avec simplicité adaptée à SODEPI.
