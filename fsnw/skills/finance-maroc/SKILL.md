---
name: gocmd-finance-fiscalite-maroc
description: "Auditer cohérence des factures, TVA, avoirs, centimes, export CSV et applicabilité des obligations marocaines."
---

# Skill — gocmd-finance-fiscalite-maroc

## Quand utiliser
Auditer cohérence des factures, TVA, avoirs, centimes, export CSV et applicabilité des obligations marocaines.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Vérifier la justesse financière en MAD, distinctement de la validation juridique par un professionnel.

## Procédure obligatoire
1. Vérifier montants HT/TVA/TTC, taux explicites selon type d'opération, Decimal, centimes et arrondis cohérents jusqu'aux CSV.
2. Rejouer facture fournisseur 3 voies, fret, rapprochement, rejets, avoirs partiels après paiement et remboursement/imputation ; empêcher double crédit.
3. Rejouer facture client, BL partiels, avoir, encaissement partiel, réservations financières et statuts (paid/settled) sans solde négatif.
4. Valider exports comptables : nombre identique de colonnes par ligne (`FRET` compris), ordre en-têtes, protections formule CSV, concordance écritures/totaux.
5. Examiner mentions sur factures, ICE/IF/RC et obligations applicables selon régime de SODEPI, loi 09-08/CNDP et durées de rétention, avec source officielle datée ; qualifier « À confirmer » si données manquantes.
6. Vérifier confidentialité financiers et journal quatre yeux des approbations/avoirs.
7. Obtenir avis expert-comptable/juriste marocain avant toute déclaration de conformité légale.

## Vérifications et critères d'acceptation
Ne jamais auto-homologuer fiscalement, imposer par défaut TVA 20% à tout produit, ni appliquer RGPD/NF525/FEC français sans fait déclencheur. Les anciens rapports sont des hypothèses, pas des validations.

## Livrables attendus
`preuves/FIN_factures.csv`, `preuves/FIN_export.csv`, `conformite_maroc_a_confirmer.md`, avis du référent autorisé.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — calculs défensifs
- Avant tout avoir, tester quantité originale nulle, quantité négative, `NaN`, `Infinity`, identifiants de lignes en doublon et cumul des avoirs après paiement. Un montant non fini doit provoquer un refus explicite et aucune écriture financière.
- Tester les conversions MAD → centimes de façon **unique et stricte** ; comparer `sales-credit-lines`, `supplier-credit-coverage` et les exports. Éviter les conversions flottantes incohérentes et les pertes de centimes par allocation de taxe.
- Contrôler le point de réordre et les unités achat/vente cohérentes avec le catalogue, sans inventer un barème fiscal ; TVA et coût du fret restent des arbitrages à valider par SODEPI/comptabilité.
- Protéger les prix et coûts par permissions effectives, y compris retrait individuel des droits de visa tarifaire.
