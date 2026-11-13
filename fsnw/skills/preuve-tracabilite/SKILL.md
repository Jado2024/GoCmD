---
name: gocmd-preuves-et-reproductibilite
description: "Figer une version et produire des preuves datées, rejouables, exactes, sans divulguer de secrets."
---

# Skill — gocmd-preuves-et-reproductibilite

## Quand utiliser
Figer une version et produire des preuves datées, rejouables, exactes, sans divulguer de secrets.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Définir l'empreinte de la version auditée, isoler les ressources et enregistrer ce qui est prouvé plutôt que prétendu.

## Procédure obligatoire
1. Calculer le SHA-256 du ZIP, ouvrir son manifeste et valider CRC, chemins relatifs et absence de doublons d'entrées.
2. Inventorier versions exécutables, dépendances, variables de configuration (noms sans valeurs secrètes), schéma, migrations et empreinte de la base de recette.
3. Donner un ID stable à chaque constat (ex. SEC-DASH-01), lier fichier:ligne et requête/résultat avec horodatage et hash.
4. Capturer l'input, attendu, obtenu, rôle, contexte, status HTTP, code retour shell, SQL de lecture, screenshot masqué si pertinent.
5. Distinguer QUATRE états : Conforme, Partiel, Non conforme, Non testé ; expliquer toute non-applicabilité.
6. Vérifier que le rapport ne réutilise pas les PASS/notes des audits plus anciens comme preuves actuelles.
7. Mettre l'index des preuves à jour à chaque nouvelle compilation ou changement de SHA.

## Vérifications et critères d'acceptation
Un `grep`, une capture d'ancienne version, un test de syntaxe, un build ou un rapport fournisseur ne prouvent pas à eux seuls l'exécution fonctionnelle. Retirer tout mot de passe, identifiant personnel, token, copie DB sensible des livrables.

## Livrables attendus
`fsnw/templates/fiche_constat.md`, `fsnw/templates/registre_anomalies.csv`, `preuves/INDEX.md`, SHA du ZIP + empreintes des preuves.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — solidité de la preuve
- Tenir un compteur distinct pour *fichiers inventoriés*, *fonctions examinées sémantiquement*, *scénarios uniques*, *exécutions*, *assertions* et *passes d'audit*. Un million de répétitions n'est pas un million d'audits indépendants.
- Un test de mutation détecte le défaut ciblé uniquement si l'échec est **causal** : montrer le comportement sain avant, le défaut après mutation, puis le retour au sain après restauration.
- Pour l'audit des journaux : vérifier suppression du dernier scellé, re-scellage après altération, rollback de checkpoint, ordre des événements et validation approfondie ; préciser les limites lorsque le même administrateur contrôle base, clé et preuves.
- Consigner l'empreinte du ZIP complet, les fichiers du correctif autonome et la preuve de reconstruction **octet par octet**, puis rejouer les tests sur l'archive finale extraite.
