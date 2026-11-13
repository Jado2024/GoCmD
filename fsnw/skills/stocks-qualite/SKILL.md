---
name: gocmd-stocks-qualite-inventaires
description: "Auditer lots, emplacements, FEFO/FIFO, CUMP, qualité, inventaires, retours et cohérence des mouvements."
---

# Skill — gocmd-stocks-qualite-inventaires

## Quand utiliser
Auditer lots, emplacements, FEFO/FIFO, CUMP, qualité, inventaires, retours et cohérence des mouvements.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Contrôler stock matière et preuve de provenance en dehors de toute consommation automatique GoProd.

## Procédure obligatoire
1. Vérifier chaque réception acceptée ↔ lot/placement/mouvement ↔ quantité disponible, quarantaines et retours.
2. Contrôler lot reçus/qualité, conservation des dates `expiresAt`, `receivedAt`, comportement FEFO si péremption renseignée sinon FIFO explicite.
3. Simuler réception partielle et retour, comparer somme de lots à quantités acceptées, libérées et retournées ; aucune quantité négative.
4. Compter un inventaire physique fictif 100→97, motif, double validation, conflit concurrent, historique avant/après ; tester refus et correction justifiée.
5. Vérifier la séparation `receiver` / `quality` / `inventory` / `approver` dans chaque action.
6. Recalculer CUMP en décimales contrôlées, vide de stock, nouvel arrivage, conversion d'unités et arrondis.
7. Tester l'absence assumée de consommation MP sur commandes clients ; ne pas confondre mouvements de stock explicites avec BOM.

## Vérifications et critères d'acceptation
L'affichage FEFO seul ne prouve pas l'application réelle des dates. Le dossier actuel n'établit pas de traçabilité MP→PF industrielle ; ce n'est pas un P0 GoCmd.

## Livrables attendus
`preuves/STK_invariants.csv`, `preuves/QA_decisions.csv`, inventaires signés fictifs, rapport de concordance.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Extension de recette P5.15.4
Pour la revente de matières, lire `articles-negoce-o2c/SKILL.md` : avant chaque diminution du lot, prouver que la quantité réservée reste disponible ; couvrir sortie, retour, quarantaine, inventaire et BL. Comparer quantité physique, réservée et libre ; ne pas additionner des réservations au stock physique.

## Actualisation CASCADE4-R1 — réservations et traçabilité
- Mesurer les dates `createdAt`, `engagedAt`, `updatedAt`, livraison prévue et alertes séparément ; une modification/consommation partielle ne doit pas rajeunir la date initiale d'engagement.
- Vérifier l'invariant quantité réservable = physique moins indisponible (quarantaine, engagements en cours) ; essais simultanés de la **dernière unité**, sur copie jetable et via HTTP.
- Les alertes de vieillissement ne justifient pas une libération automatique d'une commande client ferme. Vérifier permissions et motif de toute libération autorisée.
- Contrôler `stock.read` **après révocation individuelle** et la minimisation des données d'inspection, y compris via mouvements et exports.
- Conserver les deux voies de stock : matières revendues directement et produits finis fabriqués ; ne pas attribuer à GoCmd de consommation automatique GoProd hors périmètre.
