# AUDIT 360° INDÉPENDANT — GoCmd V18.9

**Date :** 1er novembre 2026  
**Périmètre :** archive « GoCmd_V18_9_Projet_Complet_Audite_Corrige (1).zip », code applicatif, base SQLite, Prisma, sécurité, achats, qualité, stocks, ventes, finances, interface et livraison.  
**Empreinte SHA-256 :** `1f1af69aba335abdce978dd3462574f35bddff5700ec7a16b796eada28aadb8b`.  
**Méthode :** revue ciblée des chemins critiques, contrôle des contrats et données, exécution des tests possibles sur **copie**. Aucun fichier source de la livraison d'origine n'a été modifié.  
**Précision :** ce rapport constitue un **contre-audit indépendant**, et non une certification de l'absence de tout défaut. Aucun test de navigateur, de build Next.js ou de serveur HTTP n'a pu être exécuté dans cet environnement sans les dépendances.

## 1. Verdict exécutif

**Décision : recette interne possible sous surveillance ; pas d'autorisation de production.** La base est saine et la majorité des tests historiques fonctionne. En revanche, le ZIP transmis fait échouer le script complet de régression sur un problème de nom de fichier ; surtout, trois écarts métier/de confidentialité non couverts sont visibles dans le code.

**Principaux résultats :**

- Archive ZIP lisible, **209 entrées, dont 161 fichiers** ; hash consigné, chemins sûrs.
- Base de démonstration : **189 produits, 55 matières, 62 lots** ; `PRAGMA integrity_check = ok` ; `foreign_key_check` ne relève **aucune** violation.
- `npm run test:regression:runtime` sur la copie **telle qu'extraite : échec (exit 1)** au groupe V18.7 (nom historique dégradé). Sur une seconde copie après **renommage d'un seul fichier documentaire**, la même commande passe avec **exit 0**. Le code applicatif n'a pas été modifié.
- Le `bun.lock` contient une résolution **Next.js 16.4.3** et **Prisma 6.19.3**, mais 26 plages écrites dans `workspaces` diffèrent des plages plus précises de `package.json`. La compatibilité des versions résolues est un bon indice ; **seul Bun 1.3.14 permet de prouver le gel**. Un écart de plage ne signifie pas automatiquement un échec du gel lorsque la version verrouillée reste compatible (documentation officielle Bun).
- Exécution du typage global impossible à interpréter : **les dépendances `next`, `@prisma/client`, `zod`, etc., sont absentes**. La tentative `tsc --noEmit` renvoie donc des erreurs de modules non trouvés et ne constitue pas une preuve de défaut de typage du code livré.

### Échelle utilisée

**P0** : bloque une porte fondamentale de livraison ; **P1** : atteinte significative à la confidentialité ou à la continuité d'un circuit métier ; **P2** : traçabilité, robustesse, expérience ou couverture insuffisante ; **P3** : maintenance/conditionnement/documentation. Chaque niveau distingue les anomalies **reproduites**, **prouvées par lecture et données**, et les **risques à reproduire en HTTP**.

## 2. Registre des constats

### P0-01 — Le ZIP casse la régression initiale sur une extraction Linux (reproduit)

**Preuve :** dans l'archive, le chemin est `docs/historique/README_V18_5_AUDIT_REM├ëDIATIONS.md`, tandis que `tests/test_v187_audit.py:13` exige `docs/historique/README_V18_5_AUDIT_REMÉDIATIONS.md`. Le test échoue avec `AssertionError`. **Reproduction :** sortie 1 sur la copie d'origine ; renommer ce seul fichier dans une copie fait passer la totalité de `test:regression:runtime` (sortie 0).

**Impact :** absence de reproductibilité immédiate des tests depuis le ZIP fourni. **Correction :** réémettre l'archive avec noms UTF-8/Unicode corrects ; ajouter une étape CI qui extrait le **ZIP final** puis exécute la suite. Ne pas corriger le test en supprimant l'assertion sans restaurer le fichier attendu.

### P1-01 — Retour fournisseur bloqué après facture, même avec avoir approuvé (lecture de code + données)

**Preuve :** `src/app/api/supplier-returns/route.ts:20-22` refuse un lot `available` s'il existe une ligne de facture au statut `matched`, `approved` ou `paid`. La requête n'examine **aucun avoir approuvé**. `quality-inspections/route.ts:20-24` applique un garde semblable au rejet qualité. Or `p2p/finance/route.ts` autorise les avoirs sans qu'ils désactivent ou rendent compensée la facture historique. **Quatre lots disponibles** de la base de démo sont liés à des factures concernées.

**Conséquence :** la procédure recommandée « créer un avoir avant le retour » risque de rester impossible. **Correction :** définir le rapprochement entre avoir approuvé, ligne/lot, montant et quantité retournable ; traiter explicitement la compensation et la transition, sans simplement supprimer le garde. **Tests :** facture validée → avoir par Finance A → approbation Finance B → retour qualité (autorisé uniquement sur solde couvert) ; absence d'avoir, avoir refusé, avoir insuffisant, double retour (refus).

### P1-02 — Le tableau de bord contourne les restrictions de lecture des clients (lecture de code + données)

**Preuve :** `src/app/api/clients/route.ts:27-31` et `orders/route.ts:18-23` exigent `sales`, `finance` ou `admin` (sauf compte démo). Mais `dashboard/route.ts:9-11` vérifie seulement l'authentification, puis `:76-97` renvoie les **objets clients complets** des commandes à venir (`client: o.client`), incluant leurs coordonnées. La base contient **quatre commandes actives avec téléphone client renseigné**.

**Conséquence :** un utilisateur autorisé à consulter le tableau de bord mais non le répertoire clients peut récupérer des informations client via `/api/dashboard`. **Correction :** produire un DTO par rôle, masquer coordonnées, notes sensibles et prix selon permissions, puis tester `GET /api/dashboard` avec les comptes qualité, magasin, acheteur et commercial.

### P1-03 — FEFO non opérationnel sur les lots réceptionnés ; ancienneté perdue aux transitions qualité (lecture de code + données)

**Preuve :** `goods-receipts/route.ts:12` ne propose aucun champ `expiresAt` et les créations de lots `:69,78` ne renseignent jamais l'expiration. Les **62 lots** fournis ont une date de péremption `NULL`. Le code FEFO existe (`stock-lots/route.ts:9-16`), mais ne peut classer ces lots que par repli FIFO. De plus, `quality-inspections/route.ts:42` crée une nouvelle ligne de statut sans recopier `receivedAt` ni `expiresAt` depuis le lot source : la libération d'un ancien lot en quarantaine lui donne une **nouvelle date de réception par défaut** et supprime une éventuelle date de péremption renseignée ultérieurement.

**Conséquence :** traçabilité de péremption/ancienneté incomplète ; ordre FIFO potentiellement erroné après libération qualité. **Correction :** saisir et valider facultativement les dates à réception selon type de matière, conserver dates et provenance lors des changements de statut ; distinguer l'historique physique du statut. Ajouter un test avec lot ancien en quarantaine, lot récent disponible puis libération.

### P2-01 — Factures fournisseurs `blocked` sans procédure de résolution

**Preuve :** `supplier-invoices/route.ts:20-38` crée `blocked` en cas d'écart de prix/quantité ; `supplier-invoices/[id]/route.ts` n'offre que `approve` pour une facture `matched` ou `payment` pour `approved/paid`. Le projet ne fournit pas de flux de rectification/annulation contrôlée dans ces routes. **Conséquence :** accumulation possible de documents bloqués, intervention hors logiciel. **Correction :** processus motivé (contestation, pièce rectificative, annulation contrôlée) avec séparation des tâches, conservation de l'historique et re-rapprochement.

### P2-02 — Concurrence SQLite et dédoublonnage clients dépendants d'un processus

**Preuve :** `src/lib/sqlite-write.ts:5-32` utilise une file **en mémoire du processus**. La création client (`clients/route.ts:65-70`) ne possède pas de clé de dédoublonnage insensible à la casse dans le schéma. La transaction protège le chemin local, mais deux processus pourraient exécuter les mêmes vérifications sans verrou métier unique. **Correction :** rester mono-instance pour cette recette, puis imposer contraintes/index et stratégie transactionnelle au niveau base avant multi-processus. Tests en deux processus requis.

### P2-03 — Plafonds monétaires incomplets pour les montants extrêmes

**Preuve :** `supplier-invoices/route.ts:7` accepte jusqu'à 1 000 000 unités à un prix de 1 000 000 000 MAD par unité, et `:31-36` additionne des centimes par nombres JavaScript sans `Number.isSafeInteger(totalCents)` avant la conversion en décimal. Le résultat possible dépasse `Number.MAX_SAFE_INTEGER`. **Correction :** contrôler les montants agrégés avant persistance, utiliser les décimaux exacts/centimes bornés et tester les limites. **Portée :** cas extrêmes, pas un défaut constaté sur la démonstration normale.

### P2-04 — Autorisations de lecture transversales à recadrer

**Preuve :** `dashboard/route.ts` et plusieurs GET achats/stock ne filtrent pas systématiquement les indicateurs de coût, les opérations ni les clients par rôle. Cela peut être un choix d'entreprise, mais contredit au moins la restriction explicite des coordonnées clients (P1-02). **Correction :** matrice formalisée « consulter / créer / modifier / approuver / exporter » par module ; auditer les DTO, pas seulement les menus et les mutations.

### P2-05 — Validation humaine et charge non couvertes

**Preuve :** les scénarios HTTP et les captures sont annoncés par le fournisseur, pas reproduits ici. Les scripts ne prouvent pas l'ergonomie tactile, l'impression sur matériel réel, la restauration après coupure, les responsabilités financières en poste ni une charge multi-utilisateur prolongée. **Correction :** recette terrain sur copies de données, deux utilisateurs finance distincts, tests de charge limités et reprise après incident.

### P3-01 — Artefacts techniques et documentation

**Preuve :** `tsconfig.tsbuildinfo` est présent dans l'archive malgré son exclusion par `.gitignore` ; le rapport V18.9 fourni annonce **285 fichiers** pour un ZIP contenant **161 fichiers réguliers**. Cette discordance demande de préciser le périmètre compté et de produire un manifeste signé de l'archive finale. **Correction :** exclure les caches de compilateur ; publier le manifeste exact des fichiers, versions et hashes.

## 3. Contrôles des modules — matrice 360°

| Domaine | Contrôle réalisé | Conclusion |
|---|---|---|
| Conditionnement & supply chain | SHA-256, ZIP, chemins, manifestes | ZIP valide ; erreur Unicode P0-01 |
| Dépendances et CI | `package.json`, Bun lock, CI, docs Bun | Versions résolues pertinentes ; gel non exécuté ici |
| TypeScript, ESLint, build | Configurations et tentative `tsc` | Impossible à conclure sans modules installés |
| Base Prisma/SQLite | Schéma, intégrité et FK | OK sur la démo fournie |
| Référentiel produits, gabarits 21/24/41/51 | Tests directs, routes de commande | Tests historiques PASS |
| Achats DA / BC / BR | Routes, rôles, états, régression | Régression PASS après correction ZIP ; HTTP non rejoué |
| Réception / qualité / retours | Garde de facturation, transitions lots | P1-01 et P1-03 |
| Stocks / emplacement / FEFO | Données et routes | Lots cohérents ; péremption absente |
| Factures fournisseurs et crédits | Contrats, plafonds, processus | P1-01, P2-01, P2-03 |
| Devis / commandes / BL / ventes | Routes, validations, tests historiques | Tests disponibles PASS, pas de navigateur ici |
| Clients / données personnelles | Permissions comparées, dashboard | P1-02 : accès indirect |
| Sécurité HTTP, origines, secrets | `access-gate`, proxy, config | Défenses présentes ; vérification HTTP à reproduire |
| Multi-processus, performance | File SQLite, schéma, scénarios | Déploiement mono-instance uniquement |
| UX/accessibilité/impression | Analyse des composants et rapports | Recette humaine/matérielle nécessaire |
| Tests et documentation | Runtime sur archive puis copie ajustée | Échec initial, succès ensuite |

## 4. Ce qui a réellement été exécuté

| Contrôle | Résultat indépendant |
|---|---|
| `unzip` / contrôle ZIP | **PASS** — aucun fichier ZIP corrompu |
| Empreinte SHA-256 archive | **Calculée et conservée** |
| Chemins de l'archive | **PASS sécurité des chemins** ; 1 nom Unicode corrompu |
| SQLite `integrity_check` | **PASS : ok** |
| SQLite `foreign_key_check` | **PASS : 0 violation** |
| Données témoin | **189 produits, 55 matières, 62 lots** |
| Runtime sur ZIP original extrait | **FAIL : exit 1, test V18.7 / nom historique** |
| Runtime sur copie avec nom corrigé | **PASS : exit 0, aucun code changé** |
| `tsc --noEmit` sans dépendances | **Non concluant : modules absents** |
| `bun install --frozen-lockfile` | **Non exécuté : Bun indisponible et registre inaccessible** |
| `prisma validate` / `generate` | **Non exécutés : Prisma indisponible** |
| ESLint / Next build / next start | **Non exécutés : dépendances absentes** |
| HTTP métier, sécurité réseau, navigateur et tablette | **Non exécutés ici** |
| Audit des dépendances installé (`bun audit`) | **Non exécuté ici** |

Les résultats « 57 suites, cinq recettes HTTP, build OK » du rapport Z.ai restent des résultats **déclarés par leur auteur** ; ils ne sont pas attribués à cet audit indépendant.

## 5. Ordre de correction recommandé (V18.10)

1. **Reconditionner le ZIP** : corriger le nom accentué, extraire l'archive finale dans un dossier vierge et y relancer la régression.
2. **Protéger les coordonnées client dans le dashboard** avec des DTO et permissions côté API ; écrire une recette négative pour qualité/magasinier.
3. **Corriger la séquence avoir → retour fournisseur** : rapprocher un avoir approuvé des lignes/quantités de stock retournées, sans autoriser de retour non couvert.
4. **Compléter l'expiration et la traçabilité des lots** ; préserver `receivedAt` et `expiresAt` entre `available`, `quarantine`, `returned`.
5. Ajouter une procédure contrôlée pour les factures `blocked` et tester les plafonds monétaires.
6. Réaligner la documentation et le manifeste, supprimer les caches de build de l'archive.
7. Sur une machine équipée de **Bun 1.3.14**, exécuter depuis l'archive corrigée : installation gelée, Prisma, `tsc`, ESLint, régression, build de production, recettes HTTP, audits sécurité et tests navigateur **avec base isolée**.
8. Finir par une recette terrain SODEPI : utilisateurs de chaque service, impression, tablette, validation physique des stocks et des règles comptables.

## 6. Conditions avant production

Pas de mise en production sur la base de ce rapport seul. Conserver une archive immuable, une sauvegarde testée et le manifeste. Confirmer HTTPS/proxy, comptes individuels, permissions de lecture, séparation des tâches et restauration. Les données sont une **démonstration** et la conformité fiscale marocaine reste à valider séparément.

**Verdict définitif de cet audit : la V18.9 est une base de recette utile, mais elle comporte des défauts reproductibles et des faiblesses métier documentées. Le résultat « zéro erreur / prête à produire » n'est pas justifié.**

### Sources de méthode externes

- Bun : https://bun.com/docs/pm/cli/install (sémantique `--frozen-lockfile`, compatibilité des versions résolues)
- Next.js security advisories : https://github.com/vercel/next.js/security/advisories (veille à poursuivre après installation)
