---
name: gocmd-acheteur-poste-travail
description: "Contrôler les actions guidées du rôle acheteur sans déclencher d'achat automatique ni confondre achat et fabrication."
---

# Poste de travail acheteur — procédure P5.15.5

## Mission
Vérifier sur une base isolée que le menu « Mes actions achats » est accessible au rôle `buyer` et seulement à lui, sans exposer les coûts, données clients ni contacts fournisseurs dans l'API des tâches.

## Vérifications
1. Base demo enrichie: 64 matières, 12 ruptures achetables, 21 stocks faibles achetables, 7 articles à fabriquer. Ces nombres sont des fixtures, **jamais** codés dans l'API et changent avec les données.
2. Ne présenter le bouton de création DA que si l'article est achetable, non AGGLO, avec fournisseur actif et sans DA active. Le bouton doit ouvrir le dialogue d'achat existant ; validation/approbation restent humaines.
3. Une DA pending déplace l'article en attente de validation ; approved en suivi consultation, ordered/partial ou BC confirmé en suivi réception. Vérifier qu'une DA existante empêche la proposition d'un second besoin automatique.
4. Distinguer une matière fabriquée ou non achetable, afficher uniquement l'information d'atelier, sans bouton de commande fournisseur ; GoProd reste hors périmètre.
5. Contrôler les unités (bloc indivisible, kg/ml à 3 décimales maximum), priorité rupture, recherche/filtres, mobilité et accessibilité clavier.
6. Tester les permissions (buyer et non buyer), le rafraîchissement, l'absence de fuite des prix, les délais sous 10 000 articles, puis exécuter le build Next.js, la recette HTTP multi-utilisateurs et une recette navigateur réelle avant tout feu vert production.
7. Preuves indispensables : SHA de la version, compte testé, données d'entrée, statut HTTP, réponse masquée, capture de l'écran, invariant base avant/après et journal des échecs. Pas de conformité déclarée sur test statique seul.
