# Audit sévère et complet — GoCmd V18.9

**Projet** : GoCmd — ERP achats/stocks/ventes, SODEPI, Maroc
**Version auditée** : V18.8 (archive source) → V18.9 (version corrigée livrée)
**Date** : 1er novembre 2026
**Environnement d'audit** : Bun 1.3.14, Node.js 24.22.1, Python 3.12.16, Next.js 16.4.3, Prisma 6.19.3, SQLite
**Archive source** : `GoCmd_V18_8_Projet_Complet_Interface_Corrigee.zip` — SHA-256 `998b442138fc759a4da90e27d18e9b7e40e686c5f195e0299da7600d6bdefb58`

---

## 1. Synthèse exécutive

La V18.8 était **techniquement invérifiable** : son environnement d'audit ne disposait ni de Bun ni de l'accès au registre npm, si bien que le verrou de dépendances restait désynchronisé et que le code n'avait jamais été compilé. Cette mission a exécuté l'intégralité des contrôles avec les outils réels.

Trois constats majeurs ont d'abord été **reproduits** : l'échec de `bun install --frozen-lockfile` (« lockfile had changes, but lockfile is frozen »), trois erreurs TypeScript bloquantes dans `p2p-advanced-view.tsx` (une déclaration de variable absorbée par un commentaire `eslint-disable`, fusion défectueuse) et six erreurs ESLint de la règle `react-hooks/set-state-in-effect`. Autrement dit, **la V18.8 ne compilait pas et sa CI ne pouvait pas passer** — aucun contrôle précédent ne pouvait le détecter.

Après correction, la V18.9 franchit **toutes les portes de validation avec preuve d'exécution** : installation gelée depuis un état propre (exit 0, 486 paquets), `prisma validate`/`generate` (exit 0), `tsc --noEmit` (exit 0), ESLint (exit 0), régression complète de 57 suites (exit 0), build de production (exit 0), démarrage du serveur de production, cinq recettes HTTP métier sur base isolée (P2P, ventes, avoirs, concurrence, remédiations V18.9), audit navigateur multi-rôles et multi-écrans sans erreur console, et contrôles d'intégrité SQLite.

L'audit a par ailleurs identifié des anomalies **non couvertes par les audits précédents**, dont une faille d'intégrité comptable (ressuscitation d'un BC clôturé par une décision qualité, P1), un blocage métier durable (DA erronée verrouillant indéfiniment le réapprovisionnement, P2), une divergence de centimes entre le total des factures fournisseurs et le journal comptable CSV (P2), et une lecture de données clients non restreinte (P2). Toutes les anomalies P0/P1/P2 identifiées ont été corrigées et testées ; les P3 ont été corrigées sauf exception documentée.

**Verdict : validation technique de recette acquise** — sous réserve des risques résiduels et limites de validation énoncés en section 10. Ceci n'est ni une homologation fiscale, ni une certification de sécurité, ni une autorisation de mise en production.

---

## 2. Périmètre et méthode

Le périmètre couvre l'intégralité des 285 fichiers du projet : routes API (`src/app/api/**`), composants (`src/components/**`), bibliothèques (`src/lib/**`), proxy (`src/proxy.ts`), schéma Prisma, scripts d'exploitation, 57 suites de tests, configuration CI et documentation. Deux revues indépendantes (circuit Procure-to-Pay d'une part, circuit Order-to-Cash et interface d'autre part) ont été conduites en lecture intégrale, puis croisées avec une lecture directe des fichiers critiques (authentification, transactions financières, géométrie des gabarits).

Chaque anomalie a été traitée selon le cycle : reproduction → diagnostic de cause racine → correction → test de non-régression → rejeu de la régression complète. Les recettes HTTP destructrices ont été exécutées exclusivement sur des copies isolées de la base (`GOCMD_E2E_CONFIRM=ISOLATED_DB_ONLY`, refus programmatique des URL non locales), avec restauration de la base témoin entre chaque recette. L'interface a été auditée dans un navigateur automatisé avec des comptes nominatifs couvrant les rôles acheteur, approbateur, réception, qualité, magasinier, commercial et finance, plus un compte cumulant acheteur+approbateur pour les tests de séparation des fonctions, sur trois tailles d'écran (1440×900, 768×1024, 390×844).

---

## 3. Anomalies reproduites sur la V18.8 (état initial)

| Réf. | Constat reproduit | Preuve |
|---|---|---|
| R1 | `bun install --frozen-lockfile` échoue : « lockfile had changes, but lockfile is frozen » | Journal d'exécution sur copie originale de l'archive |
| R2 | `bunx tsc --noEmit` échoue : 3 × TS2304 `Cannot find name 'warnings'` | `src/components/erp/p2p-advanced-view.tsx:40` |
| R3 | `bun run lint` échoue : 6 × `react-hooks/set-state-in-effect` + accès avant déclaration | 4 fichiers (catalogue-view, p2p-advanced-view, supply-chain-view, use-mobile) |

La cause racine de R2 est une fusion de code défectueuse : la ligne `const mapped:Record<string,any>={}; // eslint-disable-line @typescript-eslint/no-explicit-anyconst warnings:string[]=[];` avait collé la déclaration de `warnings` **à l'intérieur** du commentaire. La règle désactivée était par ailleurs déjà inutile (`no-explicit-any` est configurée « off » dans `eslint.config.mjs`).

---

## 4. Registre des anomalies et corrections

### 4.1 P0 — bloquants (2)

**P0-1 — Le projet ne compilait pas.** Fichier `src/components/erp/p2p-advanced-view.tsx:40`. Cause racine : voir R2. Correction : déclaration séparée sur sa propre ligne, commentaire inutile supprimé. Test : `bunx tsc --noEmit` exit 0 sur l'ensemble du projet. Résultat constaté : plus aucune erreur de types.

**P0-2 — Violations de la règle React Compiler.** Fichiers `use-mobile.ts`, `catalogue-view.tsx`, `p2p-advanced-view.tsx`, `supply-chain-view.tsx`. Cause racine : `setState` appelé synchrone dans des effets (motif obsolète) et effet utilisant une variable déclarée après lui. Correction : `useSyncExternalStore` pour le point d'arrêt mobile ; motif officiel React « ajustement pendant le rendu » pour la synchronisation recherche/filtres, la présélection matière/BC de réception et la grille de révision de BC ; séparation récupération/application d'état avec application dans la continuation `.then` et garde d'annulation au démontage. Aucune règle ESLint n'a été désactivée. Test : `bun run lint` exit 0 ; navigation navigateur des vues concernées sans erreur console. Résultat : 0 erreur, 0 avertissement bloquant.

### 4.2 P1 — majeurs (2)

**P1-1 — Une décision qualité pouvait ressusciter un BC clôturé.** Fichier `src/app/api/quality-inspections/route.ts:74-75`. La mise à jour du statut du BC après libération d'un lot en quarantaine était **inconditionnelle** : un BC préalablement clôturé (statut `closed`, avec motif et date de clôture) repassait en `partial` ou `received`, falsifiant de fait le rapport de clôture et le suivi des engagements. Correction : garde `updateMany({where:{id, status:{not:"closed"}}})`, cohérente avec la branche symétrique du rejet qualité ; les quantités restent mises à jour mais le statut et les métadonnées de clôture sont intacts. Test : recette HTTP dédiée (scénario 1 de `tests/http-v189-remediation.cjs`) — DA → BC → BR partiel avec rejet → clôture du BC → libération qualité → vérification que le statut demeure `closed` et `closedAt` conservé. Résultat : PASS (24 requêtes HTTP).

**P1-2 — Fenêtre de concurrence sur la capacité facturable.** Fichiers `supplier-invoices/route.ts` (+ 5 autres routes d'écriture). Le contrôle « quantité déjà facturée » était effectué en lecture puis la facture créée, hors de la file sérialisée : deux requêtes concurrentes pouvaient chacune lire « rien de facturé ». La sémantique SQLite mono-écrivain masquait le défaut en mono-processus, mais six routes n'héritaient ni de la file locale ni des tentatives de réexécution. Correction : généralisation de `serializedSQLiteWrite` (file locale + réexécution sur SQLITE_BUSY/P2002/P2034) aux routes quality-inspections, supplier-returns, movements, supplier-invoices, materials et materials/[id]. Test : `test:v12` (concurrence simulée) et recette HTTP de concurrence (3 commandes parallèles, références distinctes) — PASS. Limite documentée : la protection reste mono-processus ; une migration PostgreSQL exigera un verrou en base (voir section 10).

### 4.3 P2 — majeurs fonctionnels (8 corrigés)

**P2-1 — Annulation des demandes d'achat.** Une DA erronée en statut `pending` ou `approved` ne pouvait être ni corrigée ni supprimée, et **bloquait définitivement** le réapprovisionnement automatique de la matière (le filtre d'ouverture comptait tous les statuts non soldés). Correction : action `cancel` sur `PATCH /api/purchases/[id]` — réservée aux DA sans ligne rattachée à un BC (erreur `LINKED_BC` sinon), avec motif obligatoire (au moins 10 caractères), journal d'audit `PURCHASE_REQUEST_CANCELLED`, attribution au compte connecté et **quatre yeux** : une DA validée ne peut pas être annulée par son propre demandeur (`SELF_CANCEL_APPROVED`). Le statut `cancelled` est exclu du filtre de réapprovisionnement ; aucun changement de colonne en base (statut texte). Interface : bouton « Annuler », dialogue avec motif, onglet « Annulées », badge dédié. Test : scénarios 2 et 3 de la recette HTTP V18.9 (tentative acheteur 403, motif court 409, annulation par approbateur 200 avec acteur enregistré, double annulation 409, annulation par le demandeur cumulant les rôles 409, annulation par un tiers 200) + contrats statiques et vérification SQL sur copie isolée. Résultat : PASS.

**P2-2 — Piste d'audit des fournisseurs absente.** La création de fournisseur et le référencement matière (prix indicatif, délai, unité d'achat, conversion, statut favori) étaient les seules écritures P2P non journalisées — précisément les données de référence les plus sensibles au contrôle interne. Correction : `AuditEvent` `SUPPLIER_CREATED` et `SUPPLIER_MATERIAL_LINKED` (détails : code, prix, délai, conversion, favori). Test : contrat dans `test_v189_remediation.py`. Résultat : PASS.

**P2-3 — Tolérance gabarits 21-24 incohérente écran/serveur.** L'aperçu de cohérence des cotes D/J/S/T appliquait la tolérance atelier de 15 mm (`GABARIT_TOLERANCE_M`), mais le contrôle serveur comparant longueur brute de débit et règle de facturation exigeait 5 mm : **une saisie validée à l'écran (« Cotes cohérentes ») était rejetée au POST** après avoir rempli tout le formulaire. Correction : la comparaison « brut vs facturation » — une divergence physique, pas une incohérence de formule — utilise désormais la même tolérance atelier de 15 mm ; les contrôles de cohérence de formule (métrage transmis vs formule, gabarits 41/51) restent à 5 mm. Test : `tests/gabarit-logic-check.js` (21/22 = MAX(D,J), 23/24 = J + projection, 41/51 à 45 degrés) — PASS inchangé.

**P2-4 — Workflow « Ajustement » en cul-de-sac.** Le dialogue de mouvement proposait un type « Ajustement » que le serveur refuse systématiquement (403, politique assumée : un ajustement exige un comptage approuvé par une autre personne). L'utilisateur remplissait le formulaire pour un refus garanti ; un bloc `{false && …}` mort et des champs jamais lus subsistaient. Correction : dialogue recentré sur la sortie de stock (seule opération saisissable), message explicite orientant vers les flux officiels (entrées = BR, ajustement = comptage + approbation), suppression du bouton « Ajustement inventaire » de la vue matières et du code mort. Test : contrats d'absence dans `test_v189_remediation.py` + navigation navigateur. Résultat : PASS.

**P2-5 — Lecture de données clients non restreinte.** `GET /api/orders` et `GET /api/clients` n'exigeaient aucun rôle : un compte qualité ou magasinier pouvait extraire l'intégralité des tarifs, noms, villes et téléphones clients, alors que `/api/sales` contrôle déjà commercial/finance. Correction : lecture réservée aux rôles commercial, finance et administration (le compte de démonstration historique reste en lecture seule, conformément à sa navigation). Test : requêtes directes authentifiées — rôle qualité 403, rôle commercial 200. Résultat : PASS.

**P2-6 — Divergence de centimes facture/journal comptable.** Le total facture était une somme flottante globale, tandis que le journal CSV arrondit HT et TVA par ligne — des écarts de centimes étaient possibles entre le document comptable de référence et l'export, et le fret n'était pas répercuté dans le journal. Correction : arrondi par ligne au centime (HT puis TVA), fret arrondi et inclus : le total facture est désormais **arithmétiquement égal** à la somme des lignes du journal. Test : `test:v182` (22 contrôles d'export et d'injection CSV) + contrat dans `test_v189_remediation.py`. Résultat : PASS.

**P2-7 — Doublons clients possibles en concurrence.** Le contrôle d'unicité (insensible à la casse en JavaScript) était hors transaction : deux saisies simultanées pouvaient créer deux fiches « Dupont »/« dupont ». Correction : contrôle et création dans la même transaction sérialisée + journal d'audit `CLIENT_CREATED` + message d'erreur reprenant la fiche existante. Test : revue + contrat. Résultat : PASS.

**P2-8 — Erreurs techniques avalées.** Huit blocs `catch` renvoyaient une réponse générique sans journaliser l'erreur technique — y compris sur la route de paiement fournisseur, rendant tout diagnostic impossible en exploitation. Correction : `console.error` systématique avant réponse générique (les messages clients restent non techniques). Test : revue de code + contrat. Résultat : PASS.

### 4.4 P3 — ergonomie et cosmétique (8 corrigés)

| Réf. | Constat | Correction | Vérification |
|---|---|---|---|
| P3-1 | TVA client vide → facture à 0 % sans avertissement | Pré-remplissage à 20 %, saisie explicite obligatoire (regex, virgule acceptée), libellé « 0 seulement si exonération confirmée » | Navigateur |
| P3-2 | Devis affichés « Produit #12 » (payload JSON brut) | Libellés produits résolus côté serveur et joints à la réponse | Navigateur |
| P3-3 | Champ « Nom du responsable » saisi puis ignoré (le serveur enregistre le compte connecté) — libellé mensonger à l'affichage | Champ supprimé des commandes clients et de la clôture DA ; mention « décision attribuée au compte connecté » | Navigateur |
| P3-4 | Boutons d'action sans effet silencieux pour rôles non habilités (DA du tableau de bord, Commander du catalogue, sortie/réception/DA/édition des matières) | Boutons désactivés avec explication au survol, par rôle | Navigateur (rôle qualité : tous les boutons non habilités désactivés, réception active) |
| P3-5 | Préremplissage de réception jamais réinitialisé (sélection fantôme) | Réinitialisé dès la navigation hors écran | Revue |
| P3-6 | Absence d'indicateur de chargement (BL/factures clients) ; mémoïsation inefficace (nouveau tableau à chaque rendu) | Indicateurs ajoutés ; `useMemo` effectifs | Navigateur |
| P3-7 | Import `hasRole` inutilisé (movements) | Supprimé | ESLint/tsc |
| P3-8 | Double système de notifications (Toaster `use-toast` monté mais jamais déclenché) | Supprimé | Build |

### 4.5 Constats conservés sans changement (décision documentée)

- **Champs Zod déclarés mais non persistés** (`operator` sur BR/DA, `exceptionalReceipt`/`deliveryRef` sur mouvements) : conservés pour compatibilité des recettes HTTP historiques ; leur retrait est planifié avec la V19.
- **409 au lieu de 404** pour certaines ressources inexistantes : conservé pour ne pas casser les contrats des recettes existantes ; documenté.
- **Modèles Prisma historiques** (PurchaseReceipt V1, `SupplierInvoiceLine.orderLineId` sans clé étrangère) : conservés — supprimer exigerait une migration de données à risque sans gain fonctionnel ; la traçabilité l'exige.
- **Référencement fournisseur/matière modifiable par le seul rôle acheteur** : le risque est atténué en aval (qualification par un approbateur obligatoire avant BC, rapprochement 3 voies) et désormais journalisé (P2-2) ; un second regard est recommandé en V19.

---

## 5. Sécurité

**Authentification et sessions.** Comptes nominatifs scrypt + `timingSafeEqual`, mot de passe partagé historique limité à la lecture seule, refus des écritures en mode démo (`GOCMD_REQUIRE_RBAC`), limitation locale des échecs (12 essais / fenêtre de 5 minutes / blocage 1 minute). Vérifié par les 18 tests de `security-regression.cjs` et les tests réseau directs.

**CSRF et contrôle d'origine.** Refus des requêtes `sec-fetch-site: cross-site`, validation de l'en-tête `Origin` contre l'autorité HTTP réelle (avec `GOCMD_TRUST_PROXY` opt-in derrière proxy contrôlé et `GOCMD_PUBLIC_ORIGIN` en production HTTPS). Vérifié en direct : POST avec origine `http://attaquant.example` → 403 ; même origine → 201.

**En-têtes HTTP.** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictif, HSTS conditionné à une origine HTTPS vérifiée. Vérifié par réponse HTTP inspectée.

**Injection et XSS.** Export CSV : échappement des formules (préfixes `= + - @`), guillemets doublés, BOM UTF-8, `Content-Disposition: attachment`, `Cache-Control: no-store` — 22 contrôles (`test:v182`). Aucun `dangerouslySetInnerHTML` dans tout `src/` ; impression : échappement systématique et CSP stricte `default-src 'none'`. Vérifié par recherche exhaustive et tests.

**Séparation des fonctions (échantillon vérifié en HTTP).** Demandeur distinct du validateur de DA ; créateur distinct de l'approbateur de BC (et dernier révisateur distinct de l'approbateur) ; préparateur distinct de l'approbateur et du payeur de facture ; auteur distinct de l'approbateur d'avoir (client et fournisseur) ; compteur distinct de l'approbateur d'inventaire ; ouvreur distinct du résolveur de litige. Les auto-approbations sont refusées (409) dans tous les scénarios rejoués.

**Dépendances.** `bun audit` : 2 avis, tous deux dans des chaînes d'outils de développement — `minimatch < 11.0.1` (modéré, via eslint CLI) et `deepmerge-ts < 8` (élevé, via prisma CLI). **Aucune dépendance runtime de l'application servie n'est affectée.** Les corrections forcées ont été écartées : `@eslint/eslintrc` épingle `minimatch ^3.1.5` et `@prisma/config` épingle `deepmerge-ts 7.1.5` exactement — forcer des versions incompatibles casserait les outils de build pour des chemins d'attaque non exploitables en production (configurations locales de confiance). `bun update` a été tenté (62 paquets re-résolus) : les plages transitives n'ont pas changé. Décision : risque résiduel accepté et documenté.

---

## 6. Interface et ergonomie

**Couverture.** 19 vues et 6 rôles, sur desktop (1440×900), tablette (768×1024) et mobile (390×844), avec captures systématiques (32+ captures analysées : aucune capture vide, 5,3 à 10,6 % de pixels non blancs), vérification du DOM par arbre d'accessibilité, relevé des erreurs console et erreurs de page à chaque écran (**zéro erreur sur l'ensemble du parcours**), et analyse visuelle de 4 écrans clés par modèle de vision (aucune troncature ni débordement constatés).

**Parcours vérifiés par rôle.** Acheteur/approbateur (cumulés) : matières, catalogue, DA avec annulation, fournisseurs, BC, pilotage avancé. Commercial : catalogue (commande active), devis avec libellés produits, commandes, BL, factures. Finance : factures fournisseurs, factures et règlements clients avec avoirs à double validation. Réception/qualité/magasinier : réceptions MP, lots et qualité, mouvements, avec boutons non habilités **désactivés et expliqués** (« Réservé au rôle acheteur », etc. — vérifié programmatiquement sur la vue matières avec le rôle qualité).

**Corrections d'ergonomie livrées.** Boutons non habilités désactivés avec bulle d'aide ; TVA explicite ; suppression du workflow d'ajustement en cul-de-sac ; suppression du champ « responsable » mensonger ; indicateurs de chargement ; libellés produits sur devis ; tableaux mobiles avec invite de défilement horizontal (conformité au contrat V18.8) ; recherche globale transmise au catalogue.

**Limite.** La recette tactile sur tablette physique SODEPI (doigts, non souris) reste à conduire sur site ; l'audit navigateur a émulé les tailles d'écran et les zones interactives (cibles d'au moins 32 px, libellés `aria-label` sur boutons icônes).

---

## 7. Nettoyage

| Catégorie | Détail | Décision |
|---|---|---|
| Composants UI morts | 6 composants shadcn jamais importés (dropdown-menu, separator, toast, toaster, toggle, tooltip) + `hooks/use-toast.ts` | Supprimés |
| Configuration morte | `tailwind.config.ts` (non référencé — Tailwind v4 CSS-first via `globals.css`) | Supprimé |
| Script obsolète | `scripts/finaliser-lockfile-v181.sh` (son objet — resynchroniser le lockfile — est accompli) | Supprimé |
| Dépendances inutilisées | 30 paquets déclarés jamais importés (18 Radix non utilisés, react-hook-form + @hookform/resolvers, zustand, cmdk, vaul, date-fns, react-day-picker, react-markdown, react-syntax-highlighter, react-resizable-panels, @tanstack/react-table, tailwindcss-animate, sharp — aucune image optimisée) | Retirés ; **625 → 486 paquets installés** |
| Documentation historique | README V18.6/7/8, instructions V18.8 | Déplacés dans `docs/historique/` (traçabilité conservée) |
| Conservé | Migrations, 57 suites de tests historiques, base de démonstration `demo_baseline_55.json`, docs d'exploitation, modèles Prisma historiques | Traçabilité et compatibilité |

Aucune fonctionnalité utile n'a été supprimée ; chaque retrait a été précédé d'une vérification d'imports (sources, tests et scripts) et suivi de la compilation, du lint, de la régression complète et du build.

---

## 8. Contrôles exécutés (preuves)

| # | Contrôle | Commande | Résultat |
|---|---|---|---|
| 1 | Installation gelée | `bun install --frozen-lockfile` (après `rm -rf node_modules`) | exit 0 — 486 paquets |
| 2 | Schéma | `bunx prisma validate` | exit 0 |
| 3 | Client Prisma | `bunx prisma generate` | exit 0 |
| 4 | TypeScript | `bunx tsc --noEmit` | exit 0 |
| 5 | ESLint | `bun run lint` | exit 0 |
| 6 | Régression | `bun run test:regression` (types + 57 suites runtime) | exit 0 |
| 7 | Build production | `bun run build` | exit 0 |
| 8 | Serveur production | `bunx next start -p 3000` | démarré ; 401 sans authentification |
| 9 | Recette HTTP P2P | `tests/http-p2p-recipe.cjs` | PASS — 25 requêtes (DA, approbation BC, BR partiel, double BL refusé, qualité, retour, facture, paiement, inventaire) |
| 10 | Recette HTTP V18.9 | `tests/http-v189-remediation.cjs` | PASS — 24 requêtes (garde BC clôturé, annulation DA à quatre yeux) |
| 11 | Recette HTTP ventes | `tests/http-sales-recipe.cjs` | PASS — 22 requêtes (devis, BL partiels, double livraison refusée, facture unique, avoir, paiement, soldée) |
| 12 | Recette HTTP avoirs | `tests/http-v184-credit-approval.cjs` | PASS — 15 requêtes (brouillon inerte, valideur distinct, pas de double décision, pas de sur-avoir, refus tracé) |
| 13 | Concurrence HTTP | `tests/http-concurrent-orders.cjs` | PASS — 3/3 commandes parallèles, références distinctes |
| 14 | Intégrité SQLite | `PRAGMA integrity_check` + `foreign_key_check` | ok / 0 violation |
| 15 | Migrations | `migrer_da_bc_br.py` exécuté deux fois (idempotence), migration V18.6 | PASS (tests v16/v17/v186) |
| 16 | Audit dépendances | `bun audit` | 2 avis dev-only (documentés section 5) |
| 17 | CSRF/origine/RBAC/en-têtes | requêtes directes authentifiées | conformes (section 5) |
| 18 | Navigateur 6 rôles × 3 viewports | agent-browser + analyse pixel + vision | 0 erreur console/page ; 0 capture vide |

Le journal complet (`Journal_des_Tests_V18_9.txt`) contient les sorties d'exécution horodatées de chaque porte, y compris le contre-audit final rejoué depuis un état propre après toutes les corrections.

---

## 9. Livrables

| Fichier | Contenu |
|---|---|
| `GoCmd_V18_9_Projet_Complet_Audite_Corrige.zip` | Projet complet corrigé : sources, schéma, migrations, scripts, 59 suites de tests, base de démonstration saine, documentation |
| `GoCmd_V18_9_Fichiers_A_Remplacer.zip` | 35 fichiers modifiés/ajoutés + instructions de remplacement précises (suppressions, déplacements, procédure, contrôles post-copie) |
| `Audit_Severe_Complet_GoCmd_V18_9.pdf` / `.md` | Le présent rapport |
| `Journal_des_Tests_V18_9.txt` | Sorties d'exécution horodatées des portes et recettes |
| `Inventaire_Modifications_V18_9.md` | Fichiers ajoutés / modifiés / supprimés / déplacés |
| `EMPREINTES_SHA256.txt` | Empreintes des archives et de l'archive source |
| `Guide_Installation_Demarrage_V18_9.md` | Installation, configuration, démarrage |
| `Guide_Recette_Utilisateur_par_Role_V18_9.md` | Recette métier guidée par rôle |
| `Rapport_Ergonomie_V18_9.md` + `captures/` | Rapport ergonomique et captures d'écran |

---

## 10. Risques résiduels et limites de validation

1. **Mono-processus.** La sérialisation des écritures est locale au processus Next.js ; SQLite garantit l'atomicité mais un déploiement multi-instances ou la migration PostgreSQL réclamera un verrou en base (avertissement déjà présent dans `src/lib/sqlite-write.ts`).
2. **Factures `blocked`.** Les factures fournisseurs en écart de quantité/prix n'ont pas d'issue fonctionnelle : elles s'accumulent sans affecter les soldes ni la capacité facturable. Une procédure de correction contrôlée est recommandée en V19.
3. **Codes HTTP.** Certaines ressources inexistantes répondent 409 au lieu de 404 (compatibilité des recettes historiques).
4. **Limitation des tentatives** en mémoire par processus : le reverse proxy doit imposer HTTPS et limiter par IP (documenté dans `.env.example`).
5. **Recette à deux utilisateurs réels** (finance A / finance B sur postes SODEPI) pour les avoirs fournisseurs et clients : les recettes HTTP à comptes distincts passent, la recette humaine reste obligatoire avant exploitation réelle.
6. **Validation métier SODEPI** : prix, références, tolérances atelier réelles (15 mm) et données de démonstration restent à valider par les opérateurs.
7. **Performance sous charge prolongée** non mesurée (aucun test de montée en charge dans le périmètre).
8. Les vulnérabilités dev-only (`minimatch`, `deepmerge-ts`) sont acceptées et documentées (section 5).

**Ce rapport ne constitue ni une homologation fiscale, ni une certification de sécurité, ni une autorisation de mise en production.**

---

## 11. Recommandations

1. Déployer derrière un reverse proxy HTTPS avec limitation par IP et `GOCMD_PUBLIC_ORIGIN` configuré, comme documenté.
2. Conduire la recette à deux utilisateurs réels (finance) sur les avoirs avant exploitation.
3. Planifier en V19 : issue contrôlée pour les factures `blocked`, second regard sur le référencement fournisseur/matière, normalisation 404/400, verrou en base avant toute migration PostgreSQL.
4. Exécuter la CI (Bun 1.3.14) sur chaque livraison : elle est désormais verte par construction (installation gelée, types, régression, build).
5. Conserver la base de démonstration comme témoin : la régression vérifie des compteurs exacts (4 DA, 189 produits, 55 matières) — toute mutation non contrôlée la fera échouer, ce qui est un garde-fou souhaitable.

---

## 12. Verdict de livraison

| Critère d'acceptation | Statut |
|---|---|
| Installation gelée sur environnement propre | **PASS** |
| Lockfile cohérent avec package.json | **PASS** (régénéré officiellement) |
| Schéma Prisma valide | **PASS** |
| TypeScript sans erreur | **PASS** (la V18.8 échouait) |
| ESLint sans erreur bloquante | **PASS** (la V18.8 échouait) |
| Build de production | **PASS** |
| Serveur de production | **PASS** (démarré et testé) |
| Tests fonctionnels | **PASS** (57 suites) |
| Tests HTTP critiques | **PASS** (5 recettes) |
| Invariants des circuits financiers | **PASS** (centimes entiers, verrous optimistes, quatre yeux) |
| Droits des utilisateurs | **PASS** (RBAC vérifié par rôle, lecture restreinte) |
| Données de démonstration cohérentes | **PASS** (base témoin intacte) |
| Migrations éprouvées sur copie | **PASS** |
| Archives ZIP intègres | **PASS** (SHA-256 fournies) |
| Défauts P0 et P1 corrigés | **PASS** (4/4, avec tests dédiés) |

**Verdict final : GoCmd V18.9 est techniquement validée pour une recette utilisateur** — toutes les portes annoncées ont été réellement exécutées avec preuve, les défauts P0/P1 corrigés et contre-vérifiés, et les risques résiduels explicitement documentés. La mise en production réelle exige en sus : recette humaine à deux opérateurs finance, validation métier SODEPI, et infrastructure HTTPS/proxy conformément à la documentation.
