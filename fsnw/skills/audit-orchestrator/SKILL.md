---
name: gocmd-audit-orchestrator
description: "Orchestrer un audit contradictoire multi-discipline GoCmd, avec preuves, suivi des P0 et décision de recette."
---

# Skill — gocmd-audit-orchestrator

## Quand utiliser
Orchestrer un audit contradictoire multi-discipline GoCmd, avec preuves, suivi des P0 et décision de recette.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Piloter une campagne de bout en bout sur un ZIP/commit figé. Préparer la matrice d'applicabilité à partir de `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis déclencher les skills spécialisés sans confondre leur exécution avec une preuve. Faire relire les conclusions entre disciplines (security↔finance, stock↔vente, géométrie↔UI). **Si la mission est un audit UX/UI seul, la consigne STOP après phase 4 interdit les changements applicatifs même si un autre skill prévoit la remédiation.**

## Procédure obligatoire
1. Isoler le ZIP et calculer SHA-256 ; relever Bun/Node/Prisma/SQLite, base de recette, rôles et limites d'environnement.
2. Ouvrir `fsnw/MATRICE_SKILLS.md`; affecter chaque domaine, les scénarios SC-01/02/05/09 et les contrôles anciens au bon skill.
3. Faire passer `preuve-tracabilite`, `build-ci` et `sqlite-integrite` avant tout test d'API/UX ; arrêter au premier blocage P0 constaté, mais poursuivre la documentation des autres axes sûrs.
4. Exécuter P2P, O2C/prix directeur, stock/qualité, catalogue/gabarits, sécurité, UX et exploitation ; faire exécuter les scénarios avec des rôles réellement distincts sur copie isolée.
5. Demander au skill `nettoyage-code` une liste de suppressions justifiées, non une suppression automatique.
6. Consolider le registre, score probant, couverture et plan d'action. Ré-exécuter les tests après chaque correction et sur le ZIP final reconstruit.
7. Produire quatre verdicts distincts : *logiciel*, *données*, *terrain*, *conformité Maroc*, sans déduire l'un de l'autre.

## Vérifications et critères d'acceptation
Faire échouer le GO si un P0 réellement applicable n'a pas de preuve PASS, si SC-01/02/05/09 n'ont pas de preuve, ou si des secrets/données personnelles sont exposés. Pour les éléments GoProd et C/S supprimé, enregistrer NON APPLICABLE avec justification, pas FAIL.

## Livrables attendus
`preuves/INDEX.md`, `registre_anomalies.csv`, `scores_et_couverture.md`, `rapport_final.md`, `plan_action.md`, archive ZIP finale + SHA256.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## P5.15.7 — Contrôle des preuves et calendrier multi-comptes

Distinguer trois niveaux de preuve dans chaque verdict : (1) scénario/planning hypothétique, (2) transaction SQLite simulée avec intégrité contrôlée, (3) requête HTTP authentifiée puis expérience navigateur observée. Aucune réussite du niveau 2 ne valide automatiquement le niveau 3. Pour le mois de novembre 2026, vérifier les jours fériés marocains du 6 et du 18 ; compter 19 jours ouvrables sur la grille du lundi au vendredi.

Vérifier l'exhaustivité des besoins sous seuil, les validations 4-yeux et les qualifications fournisseurs à la date réelle du scénario. Déclarer NO-GO si compilation/recette API non démontrées, même si toutes les pièces PDF fictives et les contraintes SQLite passent.

## Actualisation CASCADE4-R1 — preuve et contre-audit
- Figer SHA du ZIP **de départ** et du ZIP **de livraison** ; tester le build, les recettes HTTP, Playwright et les migrations sur la version effectivement livrée. Une preuve ancienne n'est pas transposable.
- Décomposer la couverture par *code applicatif*, tests, migrations, sécurité, Windows, terrain et fiscalité. Un grand nombre de PASS ne prouve pas une revue sémantique des fonctions.
- Imposer un contre-audit sur les **permissions individuellement révoquées**, même si le rôle reste autorisé (`stock.read`, `director.prices`), et sur les comptes cumulant commercial/approbateur.
- Inclure les parcours suivants dans la cascade : commande en attente → visa d'un autre compte → OF seulement après validation ; idempotence de création ; détection d'un doublon métier ; réservation concurrente ; avoirs ; métrage et nombre d'étiquettes.
- Distinguer explicitement audit du code, audit des tests par mutation causale et audit de livraison. Ne pas présenter un test d'intégrité SQLite comme une homologation de l'ERP.
- Utiliser `fsnw/REFERENTIEL_CONTROLES_CASCADE4_R1.md` comme matrice technique complémentaire ; ce texte n'autorise aucune modification de règles métier.
