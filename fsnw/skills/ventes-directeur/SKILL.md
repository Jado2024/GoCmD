---
name: gocmd-ventes-prix-directeur-o2c
description: "Auditer devis, commandes, salon en ml, BL partiels, factures, avoirs et approbation des prix spéciaux par le directeur."
---

# Skill — gocmd-ventes-prix-directeur-o2c

## Quand utiliser
Auditer devis, commandes, salon en ml, BL partiels, factures, avoirs et approbation des prix spéciaux par le directeur.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Démontrer la cohérence commerciale-financière O2C et l'impossibilité de contourner la validation tarifaire directeur.

## Procédure obligatoire
1. Client → catalogue → devis → acceptation → commande → approbation → BL partiel → facture → encaissement/solde.
2. Vérifier salon L01..L04 total 8,8 ml et 8,8×235=2 068 MAD, types d'unités, conservation dimensions, réédition et arrondi.
3. Produit spécial absent : commercial propose 235 MAD/ml ; directeur distinct fixe 245 MAD/ml ; visa horodaté et tarif exact imposé avant devis final/commande, puis approbation ordinaire distincte.
4. Négatifs : approver/admin non director → 403, commercial directeur auto-validation → refus, prix modifié après visa → retrait du visa, mutation PATCH historique → refus, commande non visée → blocage.
5. Tester commande avec prix trafiqué, double livraison parallèle, BL partiel, facture unique, retours/avoirs et paiements partiels sans dépassement.
6. Vérifier l'identité produit stable (SKU) à travers renommage et prix, références pièces/BL/factures et trace historique.
7. Vérifier les textes UI et messages d'erreur pour que le commercial comprenne « demande de validation directeur » sans ressaisie.

## Vérifications et critères d'acceptation
Un statut commercial `production` n'est **pas** un ordre de fabrication industriel GoProd. Le prix directeur est obligatoire pour les produits spéciaux, même en l'absence d'une commande. Tester HTTP + UI + base, pas seulement grep.

## Livrables attendus
`preuves/O2C_cases.csv`, `preuves/Director_prices.csv`, captures UI masquées, assertions SQL des approbations et paiements.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Extension de recette P5.15.4
Pour un article acheté et revendu, déclencher également `articles-negoce-o2c/SKILL.md` : réservation sans sortie, contrôle du stock libre, BL partiels idempotents, clôture du reliquat, séparation vente/stock/finance. Rejouer les tests HTTP et non de simples assertions de lecture du code.

## Actualisation CASCADE4-R1 — commande et OF
- Toute commande client créée par un commercial commence par un état d'attente de validation. Une approbation indépendante est requise **même pour une commande standard** ; aucun OF simplifié automatique ni réservation/expédition de commande non approuvée.
- Le visa `director.prices` d'un prix exceptionnel est **distinct** de l'approbation commerciale. Refuser le directeur dont la permission est individuellement révoquée ; interdire le visa de sa propre proposition lorsque la séparation des tâches l'exige.
- Distinguer un rejeu technique avec la même clé d'idempotence d'une nouvelle commande similaire ; tester 201/200 rejoué, 409 corps différent, blocage de référence client dupliquée, et confirmation motivée d'une nouvelle commande réellement distincte.
- Les pièces facturées en mètres linéaires doivent conserver la même quantité totale dans les étiquettes : `pieceCount` ne peut pas multiplier le métrage facturé par inadvertance.
- Pour avoirs partiels : refuser `NaN`, infini, quantité originale nulle ou négative, doublons d'identifiants de lignes et montants supérieurs au solde autorisé.
