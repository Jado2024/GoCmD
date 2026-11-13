# Organisation et traçabilité de la livraison R13.3 nettoyée

## Version source et portée

- Source : `GoCmd_SODEPI_R13_3_REPRISE_PROJET_COMPLET.zip` — SHA-256 `1dc791a518b48b6e45e90d0290b68c1dd7becdda39d4847d76dd3c077515b13c`.
- Racine désormais nommée `GoCmd_SODEPI_R13_3/` au lieu du nom hérité `GoCmd_SODEPI_V2_R12/` ; les scripts utilisent les chemins relatifs à la racine.
- **Aucun fichier de `src/`, `tests/`, `scripts/`, `prisma/`, `db/`, `fsnw/` ou `public/` modifié ni supprimé**, à l'exception des caches `.pyc` sans valeur source dans `scripts/` et `tests/`.
- Documentation d'accueil/risques/Windows actualisée pour la vraie version R13.3. Leurs originaux figurent dans l'archive historique séparée.
- Les anciens logs, rapports PDCA et livraisons ne sont plus mêlés au ZIP opérationnel. L'historique est exporté séparément, sans effacer la traçabilité.

## Dossiers opérationnels

`src/` code · `prisma/` schéma · `db/` DEMO et données de référence · `scripts/` exécution & migrations · `tests/` recettes · `deploy/windows` & `deploy/network` exploitation · `fsnw/` 20 skills · `docs/` ressources métier.

### Exceptions préservées pour les tests

- `AUDIT_FINAL_P51521/`: assertions `test_p51521_audit_quality.py`.
- `QA_P5157_MOIS/`: `test_p5157_monthly.py` et lanceur mensuel.
- `PDCA_R5/`: sortie attendue par `scripts/run_r5_skill_matrix.py`.
- `docs/historique/README_P5_15_18.md` et `README_V18_5_AUDIT_REMEDIATIONS.md`: tests historiques de présence.

## Opérations de nettoyage

- Supprimés du ZIP opérationnel : caches Python `__pycache__/`, `.pyc`, sorties de compilations, test-results, si présents.
- Déplacés vers **archive historique externe** : anciens rapports PDCA R6-R9/R13.2, audits R11, journaux R13/R13.2, anciennes livraisons et index R10, dossiers versions-anciennes, ancien rapport anti-fuites généré.
- Un dossier de preuves ne constitue pas une exécution de test sur cette nouvelle archive.
- `MANIFESTE_NETTOYAGE.json` donne la liste exacte de tous les chemins préservés, archivés, exclus et les documents modifiés.

## Prudence Windows

La procédure précédente citait `db/production-blank.db`, **absent du projet source**. Le présent paquet ne prétend pas fournir ce fichier et **interdit de le remplacer par `db/custom.db`**. Son provisionnement doit être conçu et validé avant la mise en production. Voir `PLAN_RESTANT_R13_3.md` (P0-OPS-DB).
