---
title: "GOCMD / SODEPI — Doctrine de codification des articles"
subtitle: "Matières, produits finis, références fournisseurs et articles génériques hors catalogue"
date: "11 novembre 2026"
---

> **Statut : spécification fonctionnelle consolidée pour développement et validation métier — non implémentée.** Base examinée : GoCmd CASCADE4-R2, `18.9.13-p6.15.30-p6u-cascade4-r2-rc`. Ce document intègre les constats COD-01 à COD-08, l'audit des articles génériques et **la décision déjà autorisée de repartir de zéro sur les seules données fictives de démonstration**. Il n'effectue lui-même aucune suppression ni migration.

# 1. Décisions validées et limites

## 1.1. Décisions à respecter

1. **Une logique commune pour toutes les références d'articles fixes** : identifiant interne, référence stable, famille, type, attributs techniques distinctifs, identité canonique et unités. La grammaire des segments peut varier par famille.
2. **Un même article physique garde une seule identité**, qu'il soit achetable, stockable, vendu directement ou utilisé en interne. Le négoce ne duplique pas la matière ni son stock.
3. **Les articles occasionnels non fixes doivent être commandables sans nouveau code catalogue permanent et sans nomenclature (BOM)**. Leur description et configuration sont propres à la ligne de commande ; les modèles `GEN-*` sont des aides de saisie et ne constituent pas des SKU de stock.
4. **Le commercial crée une commande en attente de validation.** Le directeur habilité valide le prix spécial au niveau de la ligne ; un responsable distinct approuve ensuite la commande. **Aucun OF avant cette approbation.** Après approbation, les OF simplifiés nécessaires sont générés ; aucune consommation automatique de MP ni MRP/BOM GoProd.
5. **Base DEMO : remise à zéro et repeuplement expressément autorisés.** Les 82 matières, 218 produits, 135 liens fournisseurs, 64 lots, 18 fournisseurs, 10 clients et 9 comptes sont l'inventaire *initial*, non une obligation de conservation fichier par fichier. On peut les corriger, recodifier, remplacer et recréer avec des données fictives cohérentes. La base livrée doit repartir sans anciennes commandes ni mouvements de test, avec lots d'ouverture représentatifs.
6. **Base réelle de production : aucune suppression, aucun renommage massif ni réinitialisation sans autorisation distincte**, sauvegarde contrôlée et plan de migration audité.
7. **Pas de coûts d'approche dans le CUMP pour le moment** : montant incorporé = 0 MAD. Ce chantier n'est pas couplé à la codification.

## 1.2. Ce qui reste à arbitrer avant de coder

- Dictionnaire précis des attributs *distinctifs* de chaque famille (qualité, couleur, grammage, composition, dimensions, etc.).
- Noms définitifs des familles et des préfixes (`MP` conservé comme *référentiel matière*, et non « obligatoirement acheté », ou changement vers `MAT` sur la nouvelle démo).
- Seuil d'immutabilité d'une fiche PF : recommandation, dès sa première commande enregistrée/confirmée, selon qualification métier.
- Quand une référence fournisseur identique désigne légitimement plusieurs conditionnements : règles et validation d'exception par le responsable Achats.
- Politique d'alias courts et nécessité commerciale éventuelle des GTIN GS1.
- Cas rares nécessitant une revue technique humaine avant approbation de commande.

# 2. Vocabulaire et objets : ne pas les confondre

| Objet | Exemple | Usage autorisé | Interdit |
|---|---|---|---|
| ID technique interne | `Material.id=341` ou `OrderLine.id=921` | Clé étrangère et traçabilité | Comme référence commerciale imprimée |
| Référence d'article **fixe** | `MP-MOU-PUR-HR-D35-...` ou `PF-MAT-...` | Achat, stock, vente, documents | Changer après usage sans révision |
| Modèle de famille | `MOU-HR`, `MAT-BON` | Préremplir attributs, filtrer | Mouvement de stock sans variante |
| **Modèle générique** | `GEN-MAT`, `GEN-MOU`, `GEN-SAL`, `GEN-DIV` | Saisie d'une ligne hors catalogue | Stock commun / prix unique / nomenclature partagée |
| Ligne générique | Ligne CMD n°3 : « Matelas 175 × 195 × 28 cm » | Prix, configuration, unités, validations, OF et traçabilité propres | Réutiliser le même `productId` stockable pour toutes les configurations |
| Référence fournisseur | `F-0098/XL` | Correspondance `(fournisseur, article, unité)` | Remplacer la référence SODEPI |
| Lot / pièce | LOT-..., code étiquette pièce | Traçabilité d'une quantité ou pièce physique | Confondre avec l'identité de variante |
| Alias commercial | `HR35-GRI` | Recherche et lecture d'étiquette | Être la seule clé de traçabilité |

**Libellé unique dans l'interface : « Référence article ».** Le code interne des tables (`Material.ref`, `Product.sku`) peut rester inchangé pour compatibilité. Pour une ligne générique, afficher plutôt « Hors catalogue — référence non attribuée » et conserver un identifiant de ligne invisible mais permanent.

# 3. Contrat commun de codification des articles fixes

## 3.1. Règles invariantes

- Code en majuscules sans accents ; segments du dictionnaire gouverné ; ordre des segments fixé par famille ; dimensions explicites avec unités définies.
- Tous les attributs techniques **qui distinguent réellement deux variantes** entrent dans l'identité canonique, même s'ils ne tiennent pas dans le SKU court. Les attributs distinctifs renseignés doivent être reflétés dans la désignation complète.
- Prix, fournisseur, emplacement, quantités, seuil de stock, statut C/S et numéro de lot **ne sont pas des attributs identitaires**.
- Le suffixe numérique n'autorise jamais deux clés identitaires identiques : il ne sert qu'à distinguer des codes lisibles ayant la même base abrégée, pour **deux identités différentes**.
- L'unicité globale est logique à l'article physique : la même référence autorisée dans `Material` et le `Product` lié de négoce représente **un seul article**, pas deux collisions indépendantes.
- Les références utilisées sont immuables ; un changement technique distinctif crée une nouvelle variante ou une révision. Les libellés et textes administratifs peuvent évoluer avec audit.
- L'identité doit être calculée côté serveur dans la transaction, et vérifiée par un index ou un registre d'identités, y compris sous concurrence.

## 3.2. Grammaire cible et exemples (à valider famille par famille)

**Matières :** `MP-<FAM>-<TYPE>-<ATTRIBUTS_TECHNIQUES>-<DIMENSIONS>[-<NNN>]`.

**Produits finis :** `PF-<FAM>-<MODELE>-<VARIANTE_TECHNIQUE>-<DIMENSIONS>[-<REV>]`.

`MP` signifie ici « référentiel matières », **pas « article obligatoirement acheté »**. Une mousse agglomérée fabriquée en interne peut donc être dans `Material` avec `isManufactured=true`. Si SODEPI préfère `MAT` pour lever l'ambiguïté, le changement est réalisable dans la **nouvelle base de démo**, après validation d'une convention unique.

| Famille | Exemple de référence fixe proposé | Caractéristiques cruciales |
|---|---|---|
| Mousse pure | `MP-MOU-PUR-HR-D35-GRI-BLC-FER-LG200-LR140-HT100` | Nature, type, densité, fermeté, couleur, format, 3 dimensions bloc |
| Mousse agglomérée | `MP-MOU-AGG-D80-PLQ-LG200-LR100-EP5` | Nature, densité, qualité, format plaque/bloc, dimensions |
| Tissu | `MP-TIS-COUT-PES-BLE-PIQ-L160-Q250` | Nature, composition, couleur, piquage, laize, grammage si distinctif |
| Ressorts | `MP-RES-ENS-LG200-LR160-HT18-DIA2` | Technologie, dimensions, hauteur, diamètre de fil si distinctif |
| Feutre / fibre | `MP-FIB-FEU-PES-Q800-L200` | Type, composition, grammage, largeur, épaisseur si distinctive |
| Mercerie | `MP-MER-ZIP-NYL-BLA-LG60` | Type, matière, longueur/largeur/calibre, couleur |
| Emballage | `MP-EMB-HOU-PEBD-LG210-LR170-EP40UM` | Format, matière, dimensions, épaisseur et marquage si distinctif |
| Colle | `MP-COL-AQU-FUT-CAP200KG` | Chimie, grade, conditionnement, capacité si identité différente |
| Matelas fini | `PF-MAT-BON-160X200X25-STD` | Modèle, noyau, dimensions, hauteur, finition, variante |
| Oreiller fini | `PF-ORE-FIB-60X40-STD` | Technologie/garnissage, dimensions, variante |

**Attention aux unités :** `DIA2` signifie 2,0 mm si l'unité est le mm ; `DIA20` ne doit pas servir à exprimer « 2,0 mm » sans convention explicite. Pour l'épaisseur d'emballage, `EP40UM` = 40 micromètres ; pour mousse plaque, `EP5` = 5 cm selon la fiche famille (la description doit montrer l'unité). Ne jamais fusionner des unités ambiguës dans une même clé.

## 3.3. Identité canonique (COD-02)

Clé déterministe versionnée, construite à partir de valeurs **typées, normalisées et dans leur unité de référence** ; exemple : `v1|TIS|nature=COUT|composition=PES|couleur=BLE|pique=PIQ|laize_cm=160|grammage_gm2=250`.

Utiliser idéalement une sérialisation non ambiguë (objet JSON canonique, clés ordonnées, valeurs typées), éventuellement hachée pour indexer, plutôt qu'une simple concaténation de textes contenant potentiellement `|` ou `=`. Toute nouvelle version de schéma doit détecter les correspondances avec les anciennes versions et ne pas permettre de créer artificiellement des doublons.

La mousse conserve sa règle existante validée comme base de référence, puis les autres familles reçoivent une empreinte de même niveau d'exigence. Pour chaque famille, la liste des attributs distinctifs doit être validée par les Achats, Qualité et Magasin.

# 4. Matrice des familles à confirmer (COD-02)

| Famille | Champs requis par défaut | Distinctifs à confirmer | Particularités |
|---|---|---|---|
| MOU | Nature, type, densité, format, dimensions | Couleur, fermeté, résilience, qualité, grade | Bloc L × l × h ; plaque L × l × ép. ; rouleau l × ép. (+ L si fixe). **Agglomérée jamais en rouleau.** |
| TIS | Nature, piqué, laize, composition, couleur | Grammage, qualité, motif, finition | Stock en rouleau/plateau selon activité ; distinguer unité stock et unité achat |
| RES | Bonnell/ensachés, L, l | Hauteur, fil, ressorts, zones, qualité | Stock à l'unité pour carcasses achetées |
| FIB | Nature (feutre, fibre PES, ouate), composition, unité | Grammage, laize, épaisseur, qualité | Ouate peut être fabriquée et vendue au kg |
| MER | Type, spécification utile | Matière, couleur, calibre, dimensions | Conditionnement fournisseur non distinctif par défaut |
| EMB | Type, matière, dimensions | Épaisseur, marquage, conditionnement | Logo client peut justifier un article propre |
| COL | Famille chimique, grade, conditionnement/capacité | Viscosité et autres critères de qualité | Valider si fût et cartouche = variantes ou unité d'achat seulement |
| PF | Famille, modèle, configuration, dimensions | Composition, finition, fermeté, options structurantes | Aucun changement silencieux après usage ; révision formalisée |

**Exigence de cohérence :** le tableau ci-dessus est une **fiche d'atelier**, pas une décision automatique sur tous les attributs. Avant le développement, chaque famille doit recevoir un dictionnaire stable : code, libellé, unité canonique, précision, ordre, caractère obligatoire et caractère distinctif.

# 5. Références fournisseurs, alias et identification (COD-01, 05, 06, 07)

- `SupplierMaterial` existe et porte déjà `supplierSku`, unité d'achat, conversion et conditions fournisseurs. On conserve la relation plusieurs fournisseurs → une matière.
- Normaliser les codes fournisseurs pour comparer (casse, accents, blancs) **sans détruire la valeur originale**. Ne pas effacer les zéros initiaux ni la ponctuation sans validation achats.
- Une collision de code chez un même fournisseur doit produire une alerte bloquante ou une demande d'exception **validée séparément** ; audit complet de l'exception. Une collision ne doit pas être silencieusement ignorée dans un index partiel.
- Recherche multi-références dans les listes habilitées : référence SODEPI, désignation, alias actif/ancien, code fournisseur et éventuellement code-barres ; filtrer les références fournisseurs selon le RBAC.
- Alias commercial court optionnel, modifiable avec historique ; le scan doit résoudre la **référence complète**, pas seulement un texte ambigu.
- GTIN GS1 **seulement en cas de besoin de distribution** validé ; identifiant officiellement attribué, non dérivé du SKU. Les codes-barres internes restent possibles sans GTIN.

# 6. Produits finis standards et révisions (COD-03)

- Conserver l'ID interne stable de chaque fiche durant sa vie ; protéger les champs d'identité physique lorsque la fiche a servi à une commande ou autre document métier significatif.
- Un changement de modèle, dimensions, structure, noyau, composition, fermeté ou finition identitaire crée une **nouvelle référence ou révision liée à la précédente** ; l'ancienne reste consultable dans l'historique.
- Une correction de nom commercial, photo, texte, prix ou seuil de stock peut rester administrative avec journal d'audit et autorisations applicables.
- La commande et l'OF conservent le **snapshot figé de la configuration exacte**, même si le catalogue évolue ensuite.
- Les produits spéciaux référencés conservent leur code technique serveur si un référencement est expressément demandé ; similarité exacte/proche et justification d'une création distincte (COD-04).

# 7. Articles génériques sans référence permanente : circuit distinct (COD-09 à COD-12)

## 7.1. Trois choix dans « Nouvelle commande »

| Choix | Référence catalogue permanente | Description/configuration | Prix et validation |
|---|---|---|---|
| **A. Article standard** | Oui, existante | Fiche + dérogation contractuelle autorisée | Prix catalogue, visa si exception |
| **B. Variante ponctuelle de modèle existant** | La référence du modèle comme origine seulement | **Snapshot autonome** des dimensions et options de la ligne | Prix spécifique de la ligne, visa directeur |
| **C. Article générique hors catalogue** | **Non** | Désignation et fiche technique libre structurée | Prix spécifique de la ligne, visa directeur |

Les codes `GEN-MAT` (matelas), `GEN-MOU` (mousse spéciale), `GEN-SAL` (salon) et `GEN-DIV` (divers) sont des **types de saisie** gouvernés. Ils ne sont pas des articles stockables, ne possèdent aucun CUMP commun, et leur utilisation ne crée **aucune nouvelle référence permanente**.

## 7.2. Champs d'une ligne générique

Champs obligatoires selon type : type `GEN-*`, désignation libre explicite, quantité, unité, prix unitaire MAD, dimensions (si pertinent), caractéristiques de fabrication/finition, consignes, besoin de fabrication ou préparation, auteur, date et identifiant de ligne immuable. Mettre en évidence les informations manquantes avant validation.

Les spécifications et le prix approuvé sont **propres à cette ligne**, jamais à l'objet `GEN-MAT` partagé. Calculer une empreinte de la configuration pour signaler une commande similaire, mais ne pas bloquer une seconde commande commerciale légitime ; justification tracée si nécessaire.

## 7.3. Workflow obligatoire

1. Le commercial choisit A, B ou C et complète la commande.
2. GoCmd vérifie les champs, l'unité, les dimensions, les doublons possibles et la cohérence technique de premier niveau.
3. Pour un prix spécial, le directeur habilité `director.prices` **distinct du commercial** autorise le prix de la ligne, avec motif, valeur et trace ; toute modification du prix/configuration invalide le visa concerné.
4. La commande reste `pending_validation` jusqu'à approbation par un responsable distinct du créateur, avec contrôles serveur et transaction atomique.
5. **Aucun OF avant validation**. Après approbation, produire les OF simplifiés nécessaires aux lignes à fabriquer/préparer, en recopiant le snapshot contractuel ; ne pas exiger BOM/MRP/consommation automatique.
6. Livraisons, étiquettes, factures et avoirs reprennent la **désignation, l'unité, les dimensions et le prix figés de chaque ligne**, sans lire un modèle générique courant comme vérité contractuelle.
7. Une pièce ou un stock physique créé pour une commande générique porte un identifiant de traçabilité **propre** (ligne/OF/pièce/lot) ; jamais de stock fusionné sous `GEN-MAT`.

## 7.4. Architecture recommandée et solution transitoire

**Cible préférée :** `OrderLine.kind = CATALOG | GENERIC`, `productId` facultatif uniquement pour `GENERIC`, `genericTemplateId`, `technicalSnapshotJson`, `technicalSnapshotHash`, `priceApproval*`, `descriptionSnapshot`, `unitSnapshot`, `qty`, `unitPrice`. Adapter explicitement routes devis/commande, doublons, OF, stock physique, documents, BL, facture, avoir, RBAC et sérialisation transactionnelle.

**Alternative de transition :** créer **dans la même transaction que la commande** une fiche technique interne unique *par ligne*, masquée du catalogue ; elle peut garder un identifiant interne pour les flux dépendant de `productId`, sans demander de SKU commercial permanent. Interdire la réutilisation de cet objet par une autre ligne et sa promotion automatique. **Ne pas créer un produit partagé `GEN-MAT` stockable.**

Le choix architectural exact doit être validé par des tests d'intégration : le modèle actuel exige `OrderLine.productId`, et le circuit spécial crée une fiche `Product` et un SKU dès la saisie.

# 8. Réinitialisation et repeuplement de la base de DÉMONSTRATION — DÉCISION VALIDÉE

## 8.1. Ce qui change par rapport à l'ancienne doctrine

La précédente proposition COD-01 à COD-08 indiquait de **ne renommer aucune des 82 matières / 218 produits** et de procéder uniquement par migration additive. **Cette restriction ne s'applique plus à la base de démonstration fictive, puisque SODEPI a autorisé sa réinitialisation.**

En conséquence, pour la démo :

- On **peut supprimer puis recréer** les 82 matières, 218 produits, 135 correspondances fournisseurs, 64 lots et autres données fictives si c'est la méthode la plus fiable ; ces chiffres deviennent un **point de comparaison**, pas une cible impérative.
- On **peut attribuer de nouvelles références cohérentes** aux articles déjà présents, corriger les familles et les caractéristiques, fusionner les doublons fictifs et remplacer les exemples incohérents.
- On **peut reconstruire les comptes fictifs et les stocks d'ouverture** et repartir à zéro sur les transactions de démonstration, tout en gardant assez de données pour tester les circuits achats, ventes, stocks et les rôles.
- On doit produire une **table de correspondance avant/après** lorsque cela aide à vérifier les cas d'essai : ancienne référence, nouvelle référence, famille, identité canonique, motif, action (`conservée`, `recodée`, `fusionnée`, `recréée`). Ce journal sert à l'audit, pas à rendre les anciennes références obligatoires.
- Les règles d'unicité, d'absence de duplication négoce et de cohérence des identités s'appliquent **au nouveau jeu de données**, à recréer proprement.

**Aucun effacement d'une base de production.** Ne jamais utiliser cette autorisation pour des clients réels, des commandes réelles ou une base non formellement identifiée `DEMO`.

## 8.2. Séquence de reconstruction sécurisée

1. **Geler et identifier** le fichier SQLite fictif source ; calculer SHA-256, confirmer le marqueur et le chemin de la base `DEMO` ; exporter une sauvegarde ZIP immuable.
2. **Construire un dictionnaire famille/attributs** approuvé ; figer les règles de validation et les unités avant de créer les nouvelles fiches.
3. **Générer un seed déclaratif** versionné et déterministe (sans exposer de secrets) : fournisseurs, matières, liens fournisseurs, produits, liens de négoce, comptes de test, clients et lots d'ouverture.
4. **Réinitialiser uniquement la copie démo** explicitement autorisée ; appliquer Prisma migrations, contrôles de contraintes, puis le seed sous transactions atomiques.
5. Vérifier **0 doublon d'identité canonique**, 0 collision globale non liée, 0 référence fournisseur ambiguë non approuvée, 0 anomalie de conversion, 0 FK orpheline et 0 stock négatif incohérent.
6. Vérifier les cas métier : mousse pure/agglomérée, textile, ressort, feutre, ouate, colle, mercerie, emballage, matelas PF, négoce, produits spéciaux et modèles `GEN-*`.
7. Vérifier **0 transaction historique fictive** dans l'archive livrée (commandes, OF, factures, réceptions issues des essais), sauf choix documenté de fournir une base de recette distincte ; conserver les lots d'ouverture.
8. Rejouer achats depuis la DA, consultations, BC, réception qualité, ventes standards et génériques, visas prix, quatre yeux, OF après approbation, livraison/facture, puis **reconstruire à nouveau** la base DEMO propre pour la livraison.
9. Fournir SHA-256, version du seed, inventaire reconstitué, journal des codes avant/après, captures de tests, résultats CI et commande reproductible de reset DEMO avec garde de sécurité.

**Garde logicielle obligatoire** : l'outil de reset doit refuser de s'exécuter si l'environnement n'est pas explicitement `DEMO`, si le chemin ou l'empreinte de la base ne correspond pas au périmètre autorisé, ou si un indicateur de production est présent. Ne jamais réinitialiser sur simple détection d'une base SQLite.

# 9. Plan de remédiation codification (COD-01 à COD-12)

| Code | Travail | Priorité | Résultat attendu |
|---|---|---|---|
| COD-01 | Unicité normalisée des références fournisseurs + exceptions validées | P2 | Aucune ambiguïté fournisseur silencieuse |
| COD-02 | Générateur et identité canonique par famille | P2 | Variantes physiquement distinctes reconnues |
| COD-03 | Protection / révision des PF et MP utilisés | P2 | Historique technique fiable |
| COD-04 | Recherche de produits spéciaux similaires | P2/P3 | Alerte motivée sans interdire les vraies répétitions |
| COD-05 | Recherche par codes fournisseurs | P3 | Recherche multi-références sous RBAC |
| COD-06 | Alias commerciaux et étiquettes | P3 | Lecture simple, scan sans ambiguïté |
| COD-07 | GTIN / GS1 si exigence commerciale | Conditionnel | Identifiants GS1 seulement quand nécessaires |
| COD-08 | Mesures 10k/100k et optimisation sur preuve | P3 | Pagination et recherche performantes mesurées |
| **COD-09** | Modèles de saisie `GEN-*` non stockables | **P2** | Pas de SKU permanent créé pour un article ponctuel |
| **COD-10** | Ligne générique autonome et snapshot complet | **P2** | Spécification indépendante du catalogue |
| **COD-11** | Visa directeur **par ligne** + approbation indépendante | **P2** | Aucun détournement d'un prix générique partagé |
| **COD-12** | OF/étiquetage/BL/facture/avoir et traçabilité génériques | **P2** | Pas d'OF prématuré, pas de BOM obligatoire, aucune fusion physique |

**Séquence recommandée :** décider dictionnaires familles et type de ligne générique → concevoir modèle et contrats API → réécrire seed DEMO → développer COD-01/02/03 puis COD-09/10/11/12 → intégrer recherche et UX → tester complètement → seulement ensuite optimiser et envisager GS1.

# 10. Recette minimale obligatoire

| N° | Scénario | Résultat attendu |
|---|---|---|
| T01 | Deux mousses strictement identiques sous deux refs | Une seule identité, création doublon refusée/proposée existante |
| T02 | Mousse : différence fermeté ou dimension | Nouvelle référence valide |
| T03 | Agglomérée rouleau | Rejet |
| T04 | Tissu même identité / deux fournisseurs | Une seule matière + deux liens fournisseurs |
| T05 | Même code fournisseur pour deux MP chez le même fournisseur | 409 ou exception approuvée et auditée |
| T06 | Collision code matière / PF sans lien | Rejet |
| T07 | Négoce lié à une MP | Même référence, un seul stock physique |
| T08 | Changer composition PF déjà utilisé | Nouvelle révision, pas de PATCH silencieux |
| T09 | `GEN-MAT` deux commandes aux dimensions différentes | Deux snapshots distincts ; pas de SKU permanent |
| T10 | Abandon de création d'une ligne générique | Aucune fiche produit orpheline |
| T11 | Modification du prix après visa | Visa précédent invalidé |
| T12 | Directeur sans permission `director.prices` | 403 au contrôle protégé |
| T13 | Commercial tente d'approuver sa commande | 403, aucun OF |
| T14 | Génération OF pour générique fabriqué | Après approbation uniquement, sans BOM |
| T15 | Facture / BL / avoir de deux GEN de même famille | Caractéristiques et prix propres à chaque ligne |
| T16 | Deux commandes identiques réellement voulues | Avertissement, confirmation motivée, pas de doublon technique |
| T17 | Dix créations simultanées d'une même identité | Une seule fiche valide ; conflits contrôlés |
| T18 | Reset DEMO sur chemin de production | Refus explicite sans altération |
| T19 | Reconstruction DEMO deux fois de suite | Jeu déterministe, intégrité OK, aucun résidu des tests |
| T20 | 20 skills FSNW et tests CI sur archive finale | Contrôles verts ou défauts documentés ; jamais PASS fictif |

**Gates de livraison :** TypeScript, lint, build Node 24, migrations Prisma sur base neuve, tests unitaires, HTTP multi-rôles, Playwright, concurrence SQLite, sauvegarde/restauration, vérification de l'archive reconstruite et recette Windows sur site. La version reste candidate tant que ces validations n'ont pas été exécutées.

# 11. Benchmark et références de comparaison (source documentaire de l'audit préalable)

- **Odoo 19** : gabarits, attributs et variantes ; séparer le modèle de la variante stockable — https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/products/variants.html
- **ERPNext** : codification des articles et variantes selon des attributs — https://docs.frappe.io/erpnext/item-codification ; https://docs.frappe.io/erpnext/item-variants
- **Business Central** : articles, variantes et références croisées fournisseur/client — https://learn.microsoft.com/en-gb/dynamics365/business-central/inventory-how-use-item-cross-refs
- **SAP Business One** : fiche article avec usages achat/vente/stock — https://learning.sap.com/courses/managing-logistics-in-sap-business-one/creating-item-master-data-and-item-groups-in-sap-business-one
- **Sage X3** : catégories et gouvernance des fiches articles — https://online-help.sagex3.com/erp/12/en-us/Content/FCT/GESITM.htm
- **GS1** : spécifications générales, à appliquer uniquement si besoin de GTIN validé — https://ref.gs1.org/standards/genspecs/

Cette comparaison décrit des **fonctionnalités documentées**, pas une homologation, une certification ISO ou un benchmark mesuré du temps de traitement chez les concurrents.

# 12. Traçabilité du document et décision de déploiement

**Entrées utilisées :** proposition Queen COD-01 à COD-08 transmise dans la conversation, audit CASCADE4-R2 de codification (9 constats), complément « articles génériques » (10 constats), schéma Prisma et règles métier de l'archive `GoCmd_CASCADE4_R2_PROJET_COMPLET_AUDIT_CODIFICATION_MAJ.zip`.

**Évolution majeure de cette version :** la contrainte « ne jamais changer les 82 références MP et les 218 SKU PF » est remplacée, **pour la démo seulement**, par la décision de reset/recréation contrôlée. En revanche, la doctrine de protection de l'historique s'applique toujours à de vraies données transactionnelles.

