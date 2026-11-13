---
name: gocmd-contre-audit-et-livraison
description: "Recontrôler tous les correctifs de la dernière version et valider les archives de livraison et les correctifs autonomes avec manifestes et tests rejoués."
---

# Skill — gocmd-contre-audit-et-livraison

## Quand utiliser
Recontrôler tous les correctifs de la dernière version et valider les archives de livraison et les correctifs autonomes avec manifestes et tests rejoués.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Confronter les promesses d'une livraison au contenu réel de l'archive après corrections ou ajout de documentation.

## Procédure obligatoire
1. Extraire la version candidate dans un dossier vierge ; vérifier zip/testzip, chemins et SHA256SUMS, source SHA et manifeste FSNW.
2. Comparer fichiers modifiés/supprimés/ajoutés ; le ZIP correctifs ne doit pas écraser base SQLite sans décision explicite.
3. Rejouer chaque ancien bug à partir de son cas initial **et de son cas inverse** : erreurs TS, lockfile, retours payés, fuite GET, fournisseur UUID, dashboard, prix directeur, gabarit 11, responsive.
4. Exécuter toutes les portes build et tests HTTP disponibles sur base isolée ; ne pas substituer un `grep` à une requête HTTP.
5. Vérifier la procédure d'installation, noms des rôles, absence de secrets, fichiers obsolètes, artefacts et documentation contradictoire.
6. Relire les catégories Non testé/Hors périmètre dans score ; refuser un P0 artificiel BOM/GoProd/C/S et tout P0 applicable non prouvé.
7. Rédiger verdict indépendant, limites, registre résiduel, SHA final et changements par rapport au ZIP précédent.

## Vérifications et critères d'acceptation
Pas de « prêt production » si configuration réseau, fiscalité, sauvegardes et recette terrain ne sont pas validées. Si les outils manquent, rendre un verdict partiel et les étapes non exécutées.

## Livrables attendus
`registre_contre_audit.csv`, `resultats_final.zip` (preuves expurgées), `rapport_verdict.md` + manifestes SHA256.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Actualisation CASCADE4-R1 — archive complète et correctif autonome
- Les livraisons d'audit majeures sont normalement distinctes : projet complet, correctif autonome et dossier de preuves ; un rapport/PDF peut être ajouté. Compter séparément les livrables réellement demandés.
- Le correctif autonome doit contenir les **octets réels** des fichiers annoncés, et non un répertoire `fichiers/` vide. Calculer la différence exacte depuis le ZIP source figé, dont la SHA est enregistrée.
- Appliquer le correctif sur une **extraction neuve** de l'ancienne version et comparer l'ensemble du résultat au projet complet, fichiers et SHA-256 inclus. Vérifier également les suppressions voulues et l'absence de fichiers supplémentaires.
- Vérifier la base démo : catalogues et stocks d'ouverture conservés, aucun historique transactionnel issu des tests, aucun compte réel ou secret ajouté.
- Ne jamais afficher « homologué » pour un build non exécuté, une recette HTTP seulement déclarée, ou un déploiement Windows non réalisé.
