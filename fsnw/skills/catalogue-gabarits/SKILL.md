---
name: gocmd-catalogue-richbond
description: "Auditer taxonomie catalogue SODEPI, codification, produits ouate, mousse et géométrie Richbond en mètres linéaires."
---

# Skill — gocmd-catalogue-richbond

## Quand utiliser
Auditer taxonomie catalogue SODEPI, codification, produits ouate, mousse et géométrie Richbond en mètres linéaires.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Tester les règles métier sans inventer les dimensions et conventions de l'atelier, y compris les frontières des gabarits.

## Procédure obligatoire
1. Vérifier familles produits, noyaux 100% mousse/Bonnell/ensachés, mousse pure/mix/agglomérée, finitions sans/topper/alèse mutuellement exclusives.
2. Vérifier catalogue MP et produits vendus ; ouate comme produit vendable **au kg**, pas MP obligatoire, sans consommation automatique ; agglomérée en bloc/plaque, **jamais** rouleau.
3. Vérifier abréviation modifiable, désignation commerciale proposée puis éditable sans changer SKU ; distinguer marque vendue / fabricant effectif.
4. Gabarit 11 : facturer D ; 21/22 = max(D,J), 23 = J+√(T²−L²), 24 = J+√(S²−L²), 31–34 = J ; vérifier S/T hypothénuses, domaines racines et tolérances.
5. Gabarits 41/51 : côtés inclinés à 45°, H totale, règles de géométrie cohérentes ; **faire confirmer le 51 sur plan coté signé**, ne pas forcer une formule ancienne contradictoire.
6. Salon/banquette/gaufrette : facturation `ml`, pièces numérotées L01/L02, total somme de longueurs facturables, refus des unités incohérentes, prix 8,8×235=2068.
7. Tester API, moteur et écran pour édition des cotes, gabarits invalides (D≤J lorsque requis), tarification manuelle interdite pour gabarits automatiques.

## Vérifications et critères d'acceptation
Ne pas exiger suffixe C/S ni une réservation MP, BOM, OF industriels. Une formule mathématique sans attestation métier ne suffit pas à déclarer le gabarit 51 conforme.

## Livrables attendus
`preuves/GAB_matrice.csv`, calculs attendus/dérivés, plan atelier signé si disponible, cas limites et captures UI.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — pièce, ligne et unité
- Dans les lignes vendues au mètre, distinguer `pieceCount`, longueurs unitaires, métrage total de la ligne et métrage imprimé sur chaque étiquette. Interdire l'étiquetage multipliant silencieusement la quantité facturée.
- Rejouer `pieceCount > 1` avec métrage total figé : le total des métrages étiquetés ne peut dépasser celui facturé sans une règle explicite de l'atelier.
- Contrôler l'arrondi des formules techniques, les quantités fractionnaires permises par unité et les frontières du calcul `pointOfReorder`, y compris 0,1 × 3.
