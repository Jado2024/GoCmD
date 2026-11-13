---
name: gocmd-benchmark-fiabilite-simplicite
description: "Comparer les tâches ERP utiles à SODEPI et vérifier normes techniques avec sources, éditions et preuves comparables."
---

# Skill — gocmd-benchmark-fiabilite-simplicite

## Quand utiliser
Comparer les tâches ERP utiles à SODEPI et vérifier normes techniques avec sources, éditions et preuves comparables.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Privilégier tâches réelles et fiabilité/Simplicité/adaptation plutôt qu'une course aux fonctionnalités GoProd.

## Procédure obligatoire
1. Choisir 10–15 tâches SODEPI : création fournisseur et lien matière, DA→BC→BR, comptage, salon en ml, prix spécial, BL partiel, avoir, CSV, qualité, accès multi-rôles.
2. Décrire contexte identique, données d'essai, rôles et contraintes ; dénombrer clics, temps, erreurs et ressaisies.
3. Identifier édition/version réellement testée des concurrents (Odoo, ERPNext, Sage, Dolibarr selon disponibilité) et conserver preuve datée ; ne pas inventer tarifs/performance.
4. Évaluer fiabilité, simplicité et adéquation métier séparément ; aucune simplicité ne compense une erreur financière ou une fuite de droits.
5. Appliquer OWASP ASVS/WCAG 2.2/ISO 25010 seulement en citant exigences contrôlées et preuve ; noter *préparation estimée* distinctement de *conformité*.
6. Exclure les fonctions de fabrication GoProd et suffixe C/S non retenu ; mettre à jour les feuilles historiques avec traçabilité si une grille Excel est utilisée.
7. Garder champ « Non comparé » tant qu'une édition concurrente n'a pas été réellement mesurée.

## Vérifications et critères d'acceptation
Ne pas déduire « 100% normes » de tests automatisés. Les scores internes sont des modèles de pondération explicites, pas des certifications.

## Livrables attendus
`benchmark_taches.csv`, matrice des preuves externes, 3 scores distincts, justification des non-comparés.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.
