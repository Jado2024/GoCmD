# GoCmd V18.9 — Contre-audit indépendant et registre détaillé des anomalies
**Date : 1er novembre 2026**  |  **Objet : archive réellement transmise**  |  **Méthode : lecture ciblée du code, tests et SQLite, sans modification de l’archive originale.**

## 1. Identification et verdict
- Archive auditée : `GoCmd_V18_9_Projet_Complet_Audite_Corrige (1).zip` (SHA-256 `1f1af69aba335abdce978dd3462574f35bddff5700ec7a16b796eada28aadb8b` ; 522,277 octets ; 161 fichiers).
- Base de démonstration : 189 produits, 55 matières, 62 lots, 4 factures fournisseurs, 10 clients.
- `PRAGMA integrity_check` : **ok** ; `PRAGMA foreign_key_check` : **0 violation**.
- Test sur archive extraite : **échec** à `test_v187_audit.py`, lié à un nom de fichier historique mal encodé ; régression `test:regression:runtime` : **exit 1**.
- Sur copie de travail avec **renommage du seul document mal encodé** : régression `test:regression:runtime` **exit 0**, jusqu’aux tests V18.9 inclus.
- Node : disponible ; Bun : **absent dans cet environnement**. TypeScript global, installation gelée, build, serveur et recettes HTTP **non exécutés ici**. Les résultats annoncés par Z.ai ne sont pas comptés comme reproduits.
**Verdict : non conforme en l’état au critère de reproductibilité depuis l’archive, et non autorisé pour une mise en production. Les tests fonctionnels disponibles sont cependant réussis après correction du nom de fichier, sans modifier le code métier.**

## 2. Matrice consolidée
| Niveau | Nb | Signification |
|---|---:|---|
| P0 | 1 | Bloquant livraison/test |
| P1 | 5 | Risque métier / confidentialité prioritaire |
| P2 | 7 | Robustesse et sécurité |
| P3 | 4 | Maintenance et cohérence |
| GATE | 1 | Validation externe / terrain |

## 3. Fiches de constats détaillées et solutions
### A-01 — [P0] Archive : chemin Unicode erroné, régression non reproductible
**Localisation :** `docs/historique/README_V18_5_AUDIT_REM├ëDIATIONS.md ; tests/test_v187_audit.py:13`  
**Niveau de preuve :** PROUVÉ PAR EXÉCUTION
**Constat / preuve :** Le ZIP contient le nom avec caractères mal décodés (« REM├ëDIATIONS »), alors que le test V18.7 recherche « REMÉDIATIONS ». `python tests/test_v187_audit.py` retourne exit 1 / AssertionError. La commande de régression runtime s’arrête sur ce même test.
**Conséquence :** Le pipeline annoncé PASS n’est pas reproductible immédiatement depuis cette archive, alors que la CI exécute la régression. Le problème relève de la livraison, pas de la logique des calculs métier.
**Solution recommandée :** Renommer le document dans le dossier source avec le bon Unicode, reconstruire le ZIP en UTF-8, puis vérifier la liste des entrées ZIP sur Windows/Linux. Ne pas affaiblir le test pour masquer le problème.
**Test d’acceptation :** Décompresser le ZIP neuf dans un dossier vide ; `python tests/test_v187_audit.py` et `npm run test:regression:runtime` doivent retourner exit 0 sans renommage manuel.

### A-02 — [P1] Retour fournisseur : circuit avoir puis retour bloqué
**Localisation :** `src/app/api/supplier-returns/route.ts:20–23, 59–66 ; src/app/api/p2p/finance/route.ts:33–47`  
**Niveau de preuve :** CONFIRMÉ PAR LECTURE CROISÉE + DONNÉES
**Constat / preuve :** Le retour d’un lot available lié à une ligne facturée matched/approved/paid échoue systématiquement sur `hasInvoice`, même si un avoir a été approuvé depuis. À l’inverse, l’avoir financier peut être créé sans `returnId`, ou avec un retour déjà existant. Aucun rapprochement entre avoir approuvé et quantité à retourner n’est vérifié au moment du retour. Quatre lots disponibles de la base démo sont liés à une facture.
**Conséquence :** Les retours qualité sur marchandises facturées peuvent rester impossibles, ou être traités par un avoir non lié sans permettre le retour physique. Le suivi des quantités et des soldes risque d’être découplé.
**Solution recommandée :** Définir un workflow explicite en deux phases : « autorisation de retour » liée à la facture/ligne/lot et à une quantité, puis sortie physique du lot ; approbation financière de l’avoir liée à cette autorisation. Vérifier les quantités cumulées, le statut de facture et prévenir la double utilisation. Préserver les écritures comptables et le journal.
**Test d’acceptation :** Créer une facture approuvée, émettre une autorisation puis approuver un avoir, retourner partiellement le lot ; obtenir un retour accepté une seule fois. Cas adverses : sans autorisation, avoir insuffisant, autre fournisseur, double retour, avoir rejeté et facture déjà soldée.

### A-03 — [P1] Tableau de bord : divulgation de fiches clients à des rôles non habilités
**Localisation :** `src/app/api/dashboard/route.ts:9–21, 76–97 ; src/app/api/clients/route.ts:24–38`  
**Niveau de preuve :** CONFIRMÉ PAR LECTURE CROISÉE
**Constat / preuve :** Le dashboard autorise toute personne authentifiée (`accessGate(req)` sans rôle), charge `client:true` pour les commandes actives, puis renvoie `client:o.client` avec l’objet complet. Le répertoire clients `/api/clients` exige pourtant sales/finance/admin. Le dashboard diffuse aussi des données tarifaires des commandes et des matières.
**Conséquence :** Un compte qualité/magasinier/acheteur peut potentiellement récupérer par API les noms, villes, téléphones et tarifs clients, au-delà de ses attributions.
**Solution recommandée :** Créer un DTO minimal par rôle ; pour les rôles non commerciaux, retirer `client` et les prix ou ne renvoyer que des KPI agrégés. Employer `select` Prisma et non `include:true`. Ajouter des tests RBAC en lecture pour chaque type de compte.
**Test d’acceptation :** GET /api/dashboard connecté avec quality ou inventory : réponse sans téléphone, ville ni prix client ; avec sales/finance : informations strictement nécessaires seulement. Vérifier aussi les champs intégrés dans `alertsList`.

### A-04 — [P1] Traçabilité lots : date de péremption non saisie et métadonnées perdues en transition
**Localisation :** `src/app/api/goods-receipts/route.ts:12, 59–79 ; src/app/api/quality-inspections/route.ts:37–43 ; src/app/api/supplier-returns/route.ts:24–27 ; prisma/schema.prisma:391–409`  
**Niveau de preuve :** CONFIRMÉ PAR LECTURE + BASE
**Constat / preuve :** La table StockLot contient `receivedAt` et `expiresAt`, mais la validation de la réception n’accepte pas de date d’expiration. Les lots créés n’ont pas `expiresAt`. Les upsert de changement available/quarantine/returned ne recopient ni `receivedAt` ni `expiresAt` lors d’une création de lot destination. Les 62 lots de démonstration ont une date d’expiration NULL.
**Conséquence :** Pour les matières à durée de vie limitée, le FEFO est inopérant sans dates. Une libération qualité peut donner au lot une nouvelle ancienneté artificielle et effacer des informations nécessaires aux alertes et à la traçabilité.
**Solution recommandée :** Ajouter à la ligne de BR les champs applicables `receivedAt`/`expiresAt` et les afficher selon la famille de matière ; préserver explicitement ces champs lors des transitions. Prévoir politique « péremption obligatoire » par type de matière et contrôles cohérents sur les dates.
**Test d’acceptation :** BR de colle avec date : vérifier persistance et priorité FEFO ; quarantaine → libération → retour : les dates et provenance restent identiques. Matière sans péremption : cas `null` accepté si la politique le prévoit.

### A-05 — [P1] Factures fournisseur bloquées : aucun parcours de correction du rapprochement
**Localisation :** `src/app/api/supplier-invoices/route.ts:24–40 ; src/app/api/supplier-invoices/[id]/route.ts:7–24 ; src/components/erp/p2p-control-view.tsx:86`  
**Niveau de preuve :** CONFIRMÉ PAR LECTURE CROISÉE
**Constat / preuve :** En cas d’écart quantité ou prix, la facture est enregistrée avec status=blocked. La route de modification de facture n’offre que `approve` (exige matched) et `payment` (exige approved/paid). L’interface montre l’écart mais aucun assistant de correction ou d’annulation contrôlée.
**Conséquence :** Facture définitivement immobilisée ; risque de recréer un document concurrent ou de perdre la trace de la correction fournisseur.
**Solution recommandée :** Mettre en place un dossier d’écart : correction de facture (nouvelle révision, sans écrasement), litige ouvert, facture rectificative ou annulation formelle, re-rapprochement serveur et approbation indépendante. Décider des effets sur la quantité facturable.
**Test d’acceptation :** Scénarios : écart de prix, écart de quantité, facture rectifiée, abandon motivé, refus auto-validation, contrôle des soldes et historique avant/après.

### A-06 — [P1] Journal comptable achats : frais de transport absents des lignes exportées
**Localisation :** `src/app/api/supplier-invoices/route.ts:31–38 ; src/app/api/p2p/accounting-export/route.ts:13–24`  
**Niveau de preuve :** CONFIRMÉ PAR CALCUL ET LECTURE
**Constat / preuve :** Le total enregistré ajoute `Math.round(freightAmount*100)` aux montants des lignes. L’export `accounting-export` n’émet que les lignes de facture, aucune ligne « transport/fret ». La somme exportée peut donc être inférieure au total de facture. La base de démonstration ne met pas ce défaut en évidence : frais de transport à zéro sur les 4 factures.
**Conséquence :** Les rapprochements comptables et les contrôles d’intégration dans un logiciel tiers peuvent présenter un écart systématique du montant du fret.
**Solution recommandée :** Ajouter une ligne de fret distincte au journal et une ligne d’ajustement si nécessaire, ou modifier le format pour exposer total des lignes, frais, taxes et total du document. Centraliser une fonction de calcul partagée et exporter en centimes exacts.
**Test d’acceptation :** Créer facture de 100 MAD de ligne + 20 MAD de fret, TVA 0 : total en base 120 ; somme des écritures CSV égale à 120 ; reconcilier plusieurs lignes et TVA au centime.

### A-07 — [P2] Montants extrêmes : dépassement de l’entier sûr JavaScript possible
**Localisation :** `src/app/api/supplier-invoices/route.ts:7, 23–36 ; src/lib/supplier-invoice-balance.ts:6–15`  
**Niveau de preuve :** REPRODUIT ARITHMÉTIQUEMENT
**Constat / preuve :** Les plafonds d’entrée qty=1 000 000 et unitPrice=1 000 000 000 autorisent `qty*price*100 = 10^17`, supérieur à `Number.MAX_SAFE_INTEGER`. En Node, `10^17 + 1 === 10^17`. La route n’applique pas de garde `Number.isSafeInteger(totalCents)` avant la conversion en décimal ; la fonction `moneyToCents`, elle, refuse ensuite ces ordres de grandeur.
**Conséquence :** Perte de précision théorique à la création, puis risque d’erreur/indisponibilité dans les fonctions de solde et d’export sur des valeurs extrêmes. Ce cas est hors volumes usuels mais doit être impossible par validation.
**Solution recommandée :** Valider le plafond total et chaque ligne en centimes sûrs avant écriture ; utiliser Decimal/BigInt pour les quantités/prix si les plafonds métier le justifient. Harmoniser les maximums avec les ventes et le domaine financier.
**Test d’acceptation :** Tester limite acceptable, dépassement, 200 lignes, grandes quantités et taux maximum ; aucune facture hors limites ne doit être insérée.

### A-08 — [P2] Unicité des clients insensible à la casse garantie seulement dans le processus
**Localisation :** `prisma/schema.prisma:90–97 ; src/app/api/clients/route.ts:60–72`  
**Niveau de preuve :** CONFIRMÉ PAR SCHÉMA ET CODE
**Constat / preuve :** Le nom client est `@unique`, ce qui produit un index SQLite sensible à la casse dans la base livrée. L’application compare `toLowerCase()` dans une transaction sérialisée uniquement au sein d’un processus. Un autre processus pourrait contourner cette protection et créer deux graphies de même nom.
**Conséquence :** Doublons clients et dispersion des commandes dans une future architecture multi-processus, en plus de l’ambiguïté des homonymes légitimes.
**Solution recommandée :** Ajouter une colonne normalisée avec index unique adapté, ou un index SQLite `COLLATE NOCASE` après nettoyage des collisions. Valider la règle métier : idéalement la clé client ne devrait pas être seulement le nom.
**Test d’acceptation :** Deux requêtes concurrentes sur deux processus créant « Dupont » et « dupont » : un seul enregistrement et réponse contrôlée ; mêmes noms de personnes distinctes correctement identifiés par référence.

### A-09 — [P2] Lectures achats : autorisations trop larges
**Localisation :** `src/app/api/suppliers/route.ts:10–11 ; src/app/api/supplier-orders/route.ts:10–11 ; src/app/api/purchases/route.ts:24–25`  
**Niveau de preuve :** CONFIRMÉ PAR LECTURE
**Constat / preuve :** Plusieurs GET fournisseurs, BC et DA vérifient seulement une authentification valide, sans restreindre par rôle. Ils peuvent exposer prix et conditions commerciales au personnel de services sans besoin métier.
**Conséquence :** Risque de confidentialité interne et de diffusion accidentelle des tarifs et négociations fournisseurs.
**Solution recommandée :** Formaliser une matrice RBAC lecture/écriture par module ; filtrer les champs sensibles avec DTO ou requêtes `select`, et empêcher les lectures non autorisées côté serveur (pas seulement masquer les onglets).
**Test d’acceptation :** Matrice de tests : quality/sales/inventory/receiver/buyer/finance/admin sur GET suppliers, supplier-orders, purchases et leurs éléments liés.

### A-10 — [P2] Transactions : sérialisation uniquement locale au processus Node
**Localisation :** `src/lib/sqlite-write.ts:1–31`  
**Niveau de preuve :** RISQUE ARCHITECTURAL CONFIRMÉ
**Constat / preuve :** La variable `lastWrite` est en mémoire du worker et ne synchronise pas deux workers, serveurs ou conteneurs ; SQLite conserve son verrou d’écrivain, mais la file de l’application cesse d’être globale.
**Conséquence :** En multi-instance : conflits SQLITE_BUSY, délais et risques de concurrence dans les opérations dont l’invariant ne s’appuie pas sur une contrainte/une garde SQL.
**Solution recommandée :** Verrouiller la topologie à une instance tant que SQLite est utilisé. Pour multi-instance, migrer sur SGBD adapté avec transactions et verrous en base ; ajouter tests de charge et multi-processus avant bascule.
**Test d’acceptation :** Tester le même flux (paiements, réceptions, factures et numérotation) avec deux processus distincts, et vérifier simultanément stock, soldes, version et unicité.

### A-11 — [P2] Réessais inutiles sur violations d’unicité définitives
**Localisation :** `src/lib/sqlite-write.ts:7–21`  
**Niveau de preuve :** CONFIRMÉ PAR CODE
**Constat / preuve :** `P2002` est toujours classé retryable. Une collision permanente sur un numéro fournisseur, un nom ou une autre contrainte SQL sera réessayée jusqu’à cinq fois avec temporisations, bien qu’une nouvelle tentative ne puisse pas la résoudre.
**Conséquence :** Réponses de conflit inutilement lentes, surtout en situation de doublons métier ; bruit dans les journaux.
**Solution recommandée :** Retenter uniquement les collisions de référence générée ou les erreurs transitoires de verrou. Pour les autres P2002, retourner un 409 intelligible immédiatement. Conserver la preuve du code Prisma à l’origine du conflit.
**Test d’acceptation :** Créer volontairement un numéro de facture dupliqué et mesurer le délai de réponse ; vérifier qu’aucune nouvelle transaction n’est tentée après un P2002 permanent.

### A-12 — [P2] Alertes et exports limités à un nombre fixe d’enregistrements
**Localisation :** `src/app/api/stock-lots/route.ts:6–16 ; src/app/api/p2p/overview/route.ts:9–17, 21–27 ; src/app/api/p2p/accounting-export/route.ts:9–12`  
**Niveau de preuve :** CONFIRMÉ PAR CODE
**Constat / preuve :** L’API lots charge au maximum 200 éléments et calcule `expiredLots` exclusivement dans ces 200. Les vues achats utilisent 500/2 000/3 000 enregistrements et le journal comptable 5 000 sans pagination ni indication d’incomplétude.
**Conséquence :** Des lots périmés anciens ou des documents au-delà du plafond peuvent disparaître silencieusement des alertes, statistiques ou exports.
**Solution recommandée :** Séparer agrégation/alertes globales de la pagination d’affichage ; rendre les exports paginés ou streamés, ajouter totalCount et indicateur de troncature. Ne jamais faire dépendre une alerte de sécurité stock du `take` UI.
**Test d’acceptation :** Créer >200 lots dont le plus ancien est périmé : le lot doit figurer dans les alertes ; exporter >5 000 écritures : contrôler le nombre total et l’absence de trous.

### A-13 — [P2] CSP générale absente
**Localisation :** `next.config.ts:5–20 ; src/app/api/sales/print/route.ts`  
**Niveau de preuve :** CONFIRMÉ PAR CONFIGURATION
**Constat / preuve :** Le durcissement global inclut X-Frame-Options, nosniff, Referrer-Policy et HSTS conditionnel, mais aucune Content-Security-Policy générale n’est définie. La route d’impression dispose d’une CSP propre.
**Conséquence :** Protection de défense en profondeur contre certaines injections et chargements non autorisés incomplète ; cela ne démontre pas l’existence d’une XSS exploitable.
**Solution recommandée :** Déployer d’abord CSP Report-Only sur les pages avec inventaire des ressources légitimes ; ensuite adopter une CSP compatible Next avec nonces/hashes, sans considérer `unsafe-inline` comme une CSP stricte.
**Test d’acceptation :** Vérifier HTML, scripts, styles, impressions, étiquettes et composants dynamiques sous CSP appliquée ; aucune erreur console ni fonctionnalité bloquée.

### A-14 — [P3] Lockfile : déclarations de plages non harmonisées
**Localisation :** `bun.lock:workspaces[""].dependencies ; package.json:dependencies`  
**Niveau de preuve :** CONSTAt DOCUMENTAIRE — PAS UN ÉCHEC BUN PROUVÉ
**Constat / preuve :** Les contraintes textuelles du workspaces Bun et celles du manifeste diffèrent pour 26 dépendances. Les versions résolues vérifiées de Next.js, Prisma, React et Zod restent conformes aux versions minimales déclarées. Aucun essai `bun install --frozen-lockfile` n’a été réalisé ici, Bun étant absent.
**Conséquence :** Lecture compliquée pour les prochains mainteneurs et audits ; une divergence textuelle n’est pas une preuve de gel invalide.
**Solution recommandée :** Sur machine Bun 1.3.14, effectuer le gel à partir du ZIP original ; si et seulement si nécessaire, régénérer officiellement le lockfile avec Bun, puis relancer l’intégralité des tests.
**Test d’acceptation :** `bun install --frozen-lockfile` sur répertoire propre retourne exit 0 et ne modifie aucun fichier ; version effectivement résolue documentée.

### A-15 — [P3] Artefact de compilation intégré au ZIP
**Localisation :** `tsconfig.tsbuildinfo ; .gitignore:*.tsbuildinfo`  
**Niveau de preuve :** CONFIRMÉ PAR INVENTAIRE
**Constat / preuve :** Le fichier `tsconfig.tsbuildinfo` est livré alors qu’il s’agit d’un cache local de compilation, normalement exclu du dépôt par `.gitignore`.
**Conséquence :** Archive moins propre, risque de confusion dans les contrôles de provenance ; ce n’est pas un défaut métier direct.
**Solution recommandée :** Supprimer les caches de la préparation ZIP (sans modifier le code) ; produire l’archive à partir d’un manifeste explicite.
**Test d’acceptation :** Liste des entrées ZIP sans .tsbuildinfo, .next, node_modules, .env ni bases temporaires.

### A-16 — [P3] Codes HTTP de ressources absentes non uniformes
**Localisation :** `src/app/api/*/route.ts ; routes P2P et validations négatives`  
**Niveau de preuve :** ÉCART DÉJÀ DOCUMENTÉ
**Constat / preuve :** Certaines routes retournent HTTP 409 pour une ressource inconnue là où 404 serait approprié ; le comportement est parfois préservé pour compatibilité de tests historiques.
**Conséquence :** Clients API et interface moins clairs sur la cause exacte (document absent vs conflit métier).
**Solution recommandée :** Centraliser la taxonomie des erreurs : 400 validation, 401 auth, 403 autorisation, 404 absent, 409 conflit réel ; mettre à jour les tests en même temps.
**Test d’acceptation :** Matrice des cas négatifs sur toutes les routes : codes et messages conformes à la catégorie.

### A-17 — [P3] Tables historiques V1 à maintenir ou archiver prudemment
**Localisation :** `prisma/schema.prisma:241–266 (PurchaseReceipt, PurchaseReceiptLine)`  
**Niveau de preuve :** DETTE STRUCTURELLE DOCUMENTÉE
**Constat / preuve :** Les anciens modèles restent présents dans le schéma. Leur suppression sans étude de migration pourrait compromettre des données historiques ou des tests d’intégrité.
**Conséquence :** Complexité et risques d’erreur lors de futures migrations.
**Solution recommandée :** Réaliser une analyse des usages, liens historiques et données ; archiver avec preuve et migrer seulement après validation. Ne pas faire de `DROP TABLE` automatique pendant une simple opération de nettoyage.
**Test d’acceptation :** Migration répétable, testée sur copie de données historiques, avec comptages et contrôle de clés avant/après.

### A-18 — [GATE] Conformité fiscale marocaine et recette terrain non homologuées
**Localisation :** `Documents de simulation, exports achats, configuration d’exploitation ; contrôle réglementaire externe requis`  
**Niveau de preuve :** RÉSERVE D’EXPLOITATION — PAS UNE FAILLE PROUVÉE
**Constat / preuve :** Les exports affichent « A VALIDER PAR COMPTABLE MAROC ». L’audit technique ne confirme ni les mentions légales exactes applicables à SODEPI ni le régime de TVA. Il manque également la recette humaine sur les postes, lecteurs code-barres et imprimantes réels, et les sauvegardes/restaurations de production.
**Conséquence :** Une validation purement informatique ne suffit pas pour émettre des factures fiscales ni exploiter l’ERP industriel en réel.
**Solution recommandée :** Valider avec la comptabilité marocaine les identifiants/mentions/taux/processus réellement applicables ; conserver facturation officielle dans l’outil approprié tant que non homologué. Réaliser recette terrain, test de restauration et plan de reprise.
**Test d’acceptation :** PV signé métier/finance/DSI, modèles documentaires approuvés, exercices de sauvegarde/restauration et tests d’impression réels.

## 4. Plan de correction V18.10
**Lot 0 — Fiabiliser la livraison (obligatoire)** : A-01 ; réemballer ; régression depuis le ZIP et Bun gelé sur poste équipé.
**Lot 1 — Risques métier** : A-02, A-03, A-04, A-05, A-06 ; scénarios API adverses ; passage contrôlé des données.
**Lot 2 — Robustesse** : A-07 à A-13 ; tests numériques, RBAC en lecture, alertes complètes, CSP Report-Only et topologie mono-instance documentée.
**Lot 3 — Maintenance** : A-14 à A-17 ; risques de migration maîtrisés ; sans suppression destructive.
**Gate métier et légal** : A-18 ; validation par SODEPI et comptable, sauvegarde/restauration et impression physique.

## 5. Scénarios de non-régression proposés
| ID | Scénario | Résultat attendu | Constat |
|---|---|---|---|
| T01 | Archive vierge | Test V18.7 et régression complète sans renommage | A-01 |
| T02 | Retour facturé | Avoir approuvé, autorisation de retour, retour partiel, double retour refusé | A-02 |
| T03 | RBAC dashboard | Quality/inventory sans coordonnées client ; sales voit minimum requis | A-03 |
| T04 | Lot périssable | Dates à la BR ; conservation après quarantaine/release/retour ; FEFO | A-04 |
| T05 | Facture bloquée | Prix faux, litige, correction contrôlée, re-rapprochement, validation | A-05 |
| T06 | Fret et TVA | 100 MAD + 20 MAD fret = 120 MAD au journal et en base | A-06 |
| T07 | Nombre extrême | Montant au-delà des centimes sûrs rejeté avant écriture | A-07 |
| T08 | Clients doublons | Deux processus, noms égaux malgré différences de casse | A-08 |
| T09 | RBAC approvisionnement | Matrix lecture GET de fournisseurs/DA/BC par rôle | A-09 |
| T10 | Multi-processus | Écritures parallèles sur paiements et lots, intégrité finale | A-10 |
| T11 | P2002 définitif | Doublon numéro facture, rejet immédiat sans 5 retries | A-11 |
| T12 | Pagination lots | 201+ lots, ancien lot expiré toujours signalé | A-12 |
| T13 | CSP effective | Exercices UI, étiquettes, impression, Report-Only puis appliquée | A-13 |
| T14 | Fiscal et terrain | PV métier, impression, sauvegarde et restauration complète | A-18 |

## 6. Limites et précautions
- Aucun correctif logiciel n’a été apporté dans cette mission. L’original ZIP est inchangé ; seul le dossier d’extraction de contrôle a été utilisé pour le test alternatif.
- Les constats classés « confirmé par lecture » désignent une logique source vérifiée, pas un scénario HTTP reproduit ; les risques architecturaux sont explicitement distingués des dysfonctionnements observés.
- Le rapport ne remplace ni une revue de sécurité exhaustive, ni des tests de charge, ni une homologation fiscale, ni une recette terrain.
- Les noms de fichiers et numéros de ligne correspondent à **l’archive fournie**, pas à une version future.
