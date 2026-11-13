# FSNW — Bibliothèque active de 20 skills GoCmd / SODEPI

**Version associée : CASCADE4-R1 (candidate de recette non homologuée).** Les 20 procédures `skills/*/SKILL.md` sont conservées ; aucun skill n'a été supprimé sans preuve de non-usage. Elles sont utilisées par l'équipe d'audit, pas chargées par le runtime Next.js.

## Ordre de lecture

1. `POLITIQUE_SODEPI_ACTUELLE.md` : règles métier prioritaires.
2. `MATRICE_SKILLS.md` : choix des compétences nécessaires ; pour un audit global, ouvrir `skills/audit-orchestrator/SKILL.md`.
3. Le ou les skills appropriés : sécurité, achats, stocks, ventes, finances, UX, Playwright, SQLite, maintenance, exploitation, qualité.
4. Pour une mission UX seule, suivre `skills/ux-accessibilite/SKILL.md` et `references/PROTOCOLE_AUDIT_UX_UI_ERP.md` ; observation, puis STOP avant correction.

## Organisation conservée

- `skills/` : **20 skills** dédiés, tâches distinctes.
- `templates/` et `tools/` : modèles et vérificateurs utiles, non destructifs.
- `sources/` : références **historiques épinglées par manifeste SHA-256**. Ces fichiers ne prouvent pas la validité de CASCADE4-R1 et ne doivent pas remplacer la politique actuelle.
- `RESSOURCES_GITHUB_VERIFIEES.md` : références, sans dépendances téléchargées.

Vérification de structure et du manifeste :

```sh
python fsnw/tools/verifier_skills.py
```

Cette vérification ne remplace ni `npm run build`, ni les essais HTTP/Playwright, ni une recette Windows chez SODEPI. Les anciennes notes de nettoyage et d'intégration sont conservées dans l'archive historique séparée.


## Révision CASCADE4-R1 des consignes
La bibliothèque reste à **20 skills**. Une revue éditoriale et technique complète de leurs contenus a conduit à l'enrichissement ciblé des skills concernés. Lire `REVUE_SKILLS_CASCADE4_R1.md` pour le détail et `REFERENTIEL_CONTROLES_CASCADE4_R1.md` pour la matrice d'invariants à tester. Les règles métier ne sont pas modifiées par cette documentation.
