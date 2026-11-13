# GoCmd / SODEPI — instructions aux agents de code (R13.3 REPRISE)

**Version active unique : R13.3 REPRISE, paquet nettoyé documentairement ; qualification technique conditionnelle, PAS de GO production.**

Commencer par `README.md`, `PLAN_RESTANT_R13_3.md`, `REGLES_METIER.md`, `RUNBOOK.md`, `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, `fsnw/MATRICE_SKILLS.md` ; lire les skills applicables dans `fsnw/skills/` (20 skills). Pour l'audit, lire `fsnw/skills/audit-orchestrator/SKILL.md`.

- P0 historique de corruption SQLite R13.2 : garder **un seul moteur écrivain Prisma**, `node:sqlite` en lecture seule en mode serveur, `serializedSQLiteWrite`, test permanent `r133-dual-engine-corruption.test.cjs` et verrou d'instance.
- Quatre yeux, approbation avant OF, permissions nominatives et traçabilité ne doivent jamais être contournés. GoProd complet (BOM/MRP) hors périmètre.
- Bases de recette et données fictives uniquement pour tous les tests destructifs ; jamais de suppression de données réelles sans autorisation spécifique et sauvegarde validée.
- GEN-DIV demeure bloqué en attente de décision métier ; aucune extension silencieuse de la taxonomie V16.
- UX/UI : aucune modification esthétique sans instruction explicite. Appliquer la phase d'observation et d'autorisation du skill UX.
- Les tests historiques requièrent `AUDIT_FINAL_P51521/`, `QA_P5157_MOIS/`, `PDCA_R5/` et deux références sous `docs/historique/`. **Ne pas supprimer** ces chemins.
- Les rapports d'anciennes campagnes sont conservés dans l'archive historique séparée : ne jamais les utiliser comme preuve de réussite de ce ZIP.
- Vérifier que le nom racine d'archive est désormais `GoCmd_SODEPI_R13_3/`. Pour Windows, adapter la procédure et bloquer tant que la création de la base de production vierge n'est pas qualifiée.
- Toute correction : DMAIC/PDCA, AMDEC, tests réels et contre-audit sur extraction neuve ; garder les logs et un SHA-256.
