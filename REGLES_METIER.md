# RÈGLES MÉTIER — GoCmd / SODEPI P5.15.23 RC

**Document de synthèse.** La référence doctrinale intégralement prioritaire est
`fsnw/POLITIQUE_SODEPI_ACTUELLE.md` ; le détail écran → API → permission →
transaction → tables → test figure dans `AUDIT_FINAL_P51521/MATRICE_DOMAINES.csv`
(34 règles). En cas de divergence, la politique prime.

## Doctrine (extraits structurants)

1. **Fiabilité avant richesse.**
2. **Frontière GoCmd/GoProd** : les **OF simplifiés** liés automatiquement à chaque commande commerciale validée appartiennent à GoCmd. Les nomenclatures/BOM, OF industriels détaillés, MRP, calcul des besoins et consommation automatique des MP restent du ressort de GoProd.
3. **Suffixe C/S non obligatoire** ; SKU stable indépendant de la provenance.
4. **Prix spéciaux : visa directeur incontournable** — le prix exact d'un
   produit absent du catalogue doit être approuvé par un `director` distinct ;
   `approver`/`admin` ne remplacent pas le directeur ; toute modification
   tarifaire révoque le visa ; décisions historisées.
5. **Non exécuté = Non testé.**

## Circuit achats (P2P)

```
DA (création/validation) → consultation fournisseurs → offres (écrites PDF
ou téléphoniques tracées) → comparaison multicritère → plan d'attribution
approuvé par un responsable → BC (approbation 4 yeux) → réception (BL unique,
partielle autorisée) → contrôle qualité (quarantaine, acceptation/refus,
retours) → stock transactionnel → facture (rapprochement 3 voies) → paiement
(SEP-002, compte distinct, double paiement refusé)
```

- **DA approuvée requise** avant toute consultation (`DA_NOT_APPROVED`).
- **Offre téléphonique** : fournisseur, interlocuteur, date/heure, article,
  quantité, prix/devise, délai, conditions, compte rendu, acheteur —
  validée par l'acheteur **puis** par son responsable avant usage (traces
  obligatoires, jamais de faux devis).
- **Attribution multi-fournisseurs** possible, plan justifié dans le
  comparateur, approuvé par un responsable distinct de l'acheteur.
- **Contrat actif ≠ BC automatique** : le responsable choisit de retenir une
  source ou d'attendre ; le BC conserve sa propre approbation indépendante.
- **Plafond contractuel** (`CONTRACT_AWARD_REQUIRED`) vérifié à la création,
  à la **révision** et à l'**approbation** du BC (DEF-A-01 corrigé).
- **Réception partielle** autorisée ; BL unique ; quarantaine puis
  acceptation/refus ; réintégration après contrôle qualité ; retours
  fournisseurs tracés.
- **Rapprochement 3 voies** BC/réception/facture ; avoirs ; paiements
  partiels ; **double paiement refusé** ; séparation achats/finance.

## Catalogue

- Une même référence peut être **achetée, stockée, utilisée en interne et
  revendue** (les fonctions achat/vente ne sont pas exclusives).
- Familles métier conservées : mousses pures/agglomérées, matelas,
  banquettes/gaufrettes, salons, ressorts Bonnell/ensachés, textiles, feutres/
  fibres/ouate, mercerie, colles, emballages.
- Codification : nature + type technique + densité + fermeté + couleur +
  dimensions selon format (bloc L×l×h ; plaque L×l×épaisseur ; rouleau
  largeur×épaisseur, longueur si fixe) ; désignation proposée
  automatiquement, modification contrôlée ; **prix, quantités, fournisseurs,
  emplacements exclus de l'identité permanente**.
- Ouate : produit **fabriqué vendable au kg** ; mousse agglomérée **jamais**
  en rouleau ; marque commercialisée ≠ fabricant réel ; topper ET alèse
  simultanés interdits.

## Ventes

- Banquettes, gaufrettes, salons facturés **au mètre linéaire** (pièces
  L01/L02… + métrage cumulé). Exemple doctrine : 8,8 ml × 235 MAD/ml.
- **Gabarits Richbond** : 11 = cote D ; 21/22 = max(D,J) ; 23/24 = calcul
  pythagorien (T/S, L) ; 31–34 = J ; 41/51 = pentes 45°, cote H totale,
  convention K/L — le **51 exige le plan atelier signé** avant conformité.
- Produit hors catalogue : prix proposé par le commercial, **visa directeur
  obligatoire**, distinct de la validation ordinaire de commande (voir
  doctrine §4).
- Réservations et revente (O2C) : voir skill `articles-negoce-o2c`.

## Stocks

- Invariants : aucun stock négatif non autorisé ; mouvements historisés ;
  CUMP correct ; traçabilité des ajustements ; **FEFO** applicable aux
  périssables (NULLS LAST — ordre SQLite corrigé et testé) ; réceptions
  partielles et retours cohérents.
- Aucune correction d'incohérence **en modifiant silencieusement** les
  données : passer par un ajustement tracé.

## Finance

- Rapprochement trois voies ; écarts gérés ; avoirs ; exports comptables
  cohérents ; solde client = factures − paiements − avoirs approuvés
  (invariant vérifié chaque mois de la simulation, exact à 0 c).
- TVA : paramètre centralisé restant à décider (DEF-V-03, résiduel AMDEC).

## Limites assumées (décisions SODEPI attendues)

DEF-A-02, DEF-A-03, DEF-A-04, DEF-V-01/02/03/04/05 : évolutions métier
documentées dans l'AMDEC, **non corrigées sans décision explicite SODEPI**
conformément à la doctrine (pas de modification arbitraire des règles).

## OF simplifiés / impression (décision du 08/11/2026)

- Une ligne commerciale à fabriquer peut générer un OF, après vérification
  par le responsable ; jamais pour la revente de matières sans transformation.
- Référence OF distincte de la référence CMD, liée au document d'origine.
- Une pièce physique = une étiquette ; 8 étiquettes A4/page (2 colonnes × 4).
- Salon : mélanger pièces droites et gabarits Richbond ; dessin **indicatif**
  uniquement pour les pièces à gabarit, avec données J/D/L/S/T/B/P/K/H/W disponibles.
- Matelas : aucune représentation géométrique, seulement dimensions, noyau,
  composition et finition quand ces attributs existent.
- OF approuvé par un autre responsable que son créateur ; ni impression
  ni lancement de production depuis un OF brouillon.
- Nomenclatures, mouvements matière et calculs des coûts : GoProd, hors périmètre.
- Une décision sur les règles métier ne vaut pas homologation production.

## Règle SODEPI confirmée — CMD et OF automatiques (08/11/2026)

La saisie commerciale utilise le catalogue existant ou le circuit d'ajout de produit spécial déjà prévu. Elle n'impose aucun choix préalable « stock / achat / fabrication ».

- Toute commande commercialement validée possède une référence CMD unique et **un OF en brouillon par ligne commerciale**, indépendamment de la provenance de la marchandise.
- Une ligne « salon 9 pièces » reste **un OF de 9 pièces**, et non 9 OF ; 8 étiquettes A4 sur la première page, une sur la deuxième.
- Pour une revente de bloc acheté ou de tissu, l'OF contient la quantité/unité et une étiquette de préparation sans dessin ni pièce fictive ; le magasin conserve le contrôle réel des lots et mouvements au moment de la livraison.
- Pour les matelas, les étiquettes ne comportent aucun dessin ; les dessins des pièces à gabarit restent réservés aux gabarits concernés.
- Les commandes spéciales en attente d'approbation ne produisent leurs OF qu'après approbation effective ; l'OF est soumis à un contrôle distinct à quatre yeux.
- Aucune création d'OF ne représente une production, une réservation ni un débit de stock.
- Les OF rattachés à une CMD doivent être terminés avant de livrer une commande soumise au nouveau circuit ; annulation et réactivation sont justifiées et historisées.

Cette règle ne modifie pas le périmètre séparé de GoProd.


## Addendum — Ventes, stocks finis et retours (VEN, 08/11/2026)

- **Règle inchangée :** choix du produit du catalogue ou saisie spéciale, validation de la commande, numéro CMD unique et OF créés automatiquement **pour toutes les lignes**. Aucun choix achat/stock/fabrication imposé au commercial.
- L'OF **n'est ni une réception ni un mouvement de stock**. La préparation d'un OF stock vérifie la disponibilité ; le BL débitera ensuite réellement le lot.
- **Matelas finis** déjà disponibles : même référence commerciale qu'un matelas à fabriquer. Stock dédié par lots de produits finis (unité `u`), réception magasin et libération par une autre personne habilitée à la qualité. À la livraison, le BL débite le lot, affecte des identifiants de pièces et mémorise les lots utilisés.
- **Documents émis** : les nouvelles CMD, devis, BL et factures figent les désignations, SKU, unités et montants pertinents. Les anciennes pièces sans photographie ne peuvent pas être reconstruites rétroactivement si le catalogue a déjà changé.
- **Retours physiques** : demande liée à un BL, contrôle des quantités et identifiants, réception distincte, décision qualité. Un matelas retourné reste en quarantaine avant libération de son lot. Aucun avoir ou remboursement n'est émis automatiquement.
- La sortie d'une matière achetée, comme la sortie d'un matelas fini, est distincte de l'écriture commerciale. Le stock ne change jamais à la seule création de la CMD ou de l'OF.
- **Limites RC** : la réservation automatisée des lots de matelas finis et le réapprovisionnement partiel stock/fabrication restent à compléter ; les retours de matières revendues ne sont pas encore réintégrés automatiquement. La décision de rembourser une facture intégralement réglée reste comptable.

## Réservation matelas finis — P5.15.23
La saisie commerciale reste inchangée : CMD validée → OF automatiques. Quand un OF est validé en préparation stock fini, ses matelas sont réservés sur des lots physiques FEFO sans diminuer le stock ; au BL, les lots réservés sont débités en une seule transaction. Une suspension libère les réservations et exige une nouvelle préparation après reprise. Aucun OF historique ne reçoit de réservation fictive.
