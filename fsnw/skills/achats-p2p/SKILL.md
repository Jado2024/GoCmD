---
name: gocmd-achats-fournisseurs-p2p
description: "Auditer fournisseurs, liens matières, demandes achat, BC, BR, sourcing, qualité, factures, paiements et retours."
---

# Skill — gocmd-achats-fournisseurs-p2p

## Quand utiliser
Auditer fournisseurs, liens matières, demandes achat, BC, BR, sourcing, qualité, factures, paiements et retours.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Tester le circuit réel fournisseur et les sécurités des décisions P2P sans inventer une gestion de production.

## Procédure obligatoire
1. Création fournisseur → association à une ou plusieurs matières → prix fournisseur indicatif → qualification / sélection.
2. Demande d'achat → approbation indépendante → BC → révision → nouvelle approbation → BR partiel, BL fournisseur non dupliqué.
3. Réception → lots, lieux, quarantaine → décision qualité → stock disponible limité à quantité acceptée.
4. Facture fournisseur → rapprochement 3 voies, écart bloqué, rejet/correction tracés → approbation distincte → paiement partiel/complet.
5. Retour fournisseur après facturation / après paiement : avoir approuvé, remboursement/imputation et allocation partielle non réutilisable ; vérifier les scénarios 4+3+2 sur avoir 9.
6. Tester concurrence BC/BR, fournisseur supprimé puis recréé, ref unique, quantité dépassée, accès coût par rôle.
7. Vérifier que l'acheteur opère sans exposer des coûts au réceptionnaire/qualité qui n'en ont pas besoin.

## Vérifications et critères d'acceptation
Cas négatifs indispensables : auto-approbation, retour sans avoir, double BL, facture paiement avant approbation, retour déjà consommé, écriture d'un rôle non autorisé. On n'ajoute pas de BOM ni MRP pour expliquer les achats.

## Livrables attendus
`preuves/P2P_scenarios.csv`, journaux HTTP 25+ requêtes au besoin, pièces et références fictives, comparaison stock/finance.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## P5.15.7 — Recette mensuelle de bout en bout (simulation)

Lire `PLAN_PDCA_GOCMD_P5_15_7.md`, puis les résultats `QA_P5157_MOIS`. Avant d'attribuer un devis : la DA doit être approuvée, le fournisseur actif ET qualifié à la date, le devis oral enregistré avec l'heure/le contact/le contenu, et approuvé par l’acheteur puis un responsable distinct ; PDF facultatif pour l’offre téléphonique, et pièces jointes hachées lorsqu’elles existent. L'attribution doit être prise par un autre compte que le créateur de la RFQ, motivée par une comparaison prix/délai. Poursuivre jusqu'au BC, BR, qualité, facture et rapprochement.

Ne jamais assimiler les 33 DA insérées dans une simulation SQL aux 33 mêmes DA validées par les API. Les traces `SIM_*` et le planning horaire sont des éléments **fictifs** ; seuls les tests HTTP multi-comptes constituent une preuve de fonctionnement de l'application.
