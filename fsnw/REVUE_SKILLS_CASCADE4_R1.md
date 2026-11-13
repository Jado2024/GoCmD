# Relecture FSNW — 20 skills CASCADE4-R1

La précédente opération était un nettoyage documentaire, **pas** une révision exhaustive des procédures. Cette mise à jour complète les critères d’audit des 20 skills conservés sans changer la politique métier approuvée ni le runtime.

| Skill | Action | Ajout de lignes |
|---|---|---:|
| `audit-orchestrator` | Enrichi | 8 |
| `build-ci` | Enrichi | 7 |
| `contre-audit-livraison` | Enrichi | 7 |
| `sqlite-integrite` | Enrichi | 8 |
| `securite-confidentialite` | Enrichi | 7 |
| `ventes-directeur` | Enrichi | 7 |
| `stocks-qualite` | Enrichi | 7 |
| `articles-negoce-o2c` | Enrichi | 6 |
| `finance-maroc` | Enrichi | 6 |
| `catalogue-gabarits` | Enrichi | 5 |
| `exploitation-resilience` | Enrichi | 7 |
| `preuve-tracabilite` | Enrichi | 6 |
| `nettoyage-code` | Enrichi | 6 |
| `tests-navigateur-playwright` | Enrichi | 6 |
| `achats-p2p` | Relu, pas de modification utile démontrée | 0 |
| `acheteur-navigation-complete` | Relu, pas de modification utile démontrée | 0 |
| `acheteur-poste-travail` | Relu, pas de modification utile démontrée | 0 |
| `benchmark-normes` | Relu, pas de modification utile démontrée | 0 |
| `performance-react-nextjs` | Relu, pas de modification utile démontrée | 0 |
| `ux-accessibilite` | Relu, pas de modification utile démontrée | 0 |

## Écarts principaux constatés et traités
1. **Référence de version corrigée :** la politique FSNW renvoie désormais à la version de code inscrite dans `package.json`, sans utiliser V18.9.9 comme cible. Les mentions V18.9.9/V18.9.10 dans les documents UX désignent uniquement des audits historiques. **Aucune règle métier n'a été modifiée.**
2. Les skills ne couvraient pas tous explicitement les contrôles CASCADE4-R1 : approbation systématique avant OF, permissions individuellement révoquées, métrage/étiquettes, avoirs non finis, idempotence, sceaux HMAC, réalité des tâches Windows et contenu du correctif autonome.
3. Aucun nouveau skill redondant n'est créé : **20/20** conservés. La matrice de déclenchement et le référentiel transversal sont complétés.
4. Aucun code applicatif, migration, base SQLite ou fichier de tests du projet n'a été modifié. Les contrôles fonctionnels restent à rejouer si l'on souhaite homologuer le logiciel.
