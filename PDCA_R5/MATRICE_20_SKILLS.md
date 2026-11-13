# GoCmd R5 — Grille FSNW : 20 skills, état probant

**Attention :** `PASS_CIBLE` signifie qu’un script pertinent a réussi sur la copie R5. Cela ne signifie pas que le skill complet a été exécuté, ni une homologation. Les preuves de chaque commande, codes de retour et extraits de sorties figurent dans `preuves/skills_matrix.json`.

| Skill | État observé | Limite |
|---|---|---|
| `audit-orchestrator` | PASS_CIBLE | Script ciblé, non HTTP |
| `preuve-tracabilite` | PASS_CIBLE | Script ciblé, non HTTP |
| `build-ci` | NON_TESTE | Node 24 / Bun / packages indisponibles : lint, tsc, build non exécutés |
| `sqlite-integrite` | PASS_CIBLE | Script ciblé, non HTTP |
| `securite-confidentialite` | PASS_CIBLE | Script ciblé, non HTTP |
| `achats-p2p` | PASS_CIBLE | Script ciblé, non HTTP |
| `stocks-qualite` | PASS_CIBLE | Script ciblé, non HTTP |
| `ventes-directeur` | PASS_CIBLE | Script ciblé, non HTTP |
| `catalogue-gabarits` | PASS_CIBLE | Script ciblé, non HTTP |
| `ux-accessibilite` | PASS_CIBLE | Script ciblé, non HTTP |
| `tests-navigateur-playwright` | NON_TESTE | Aucun serveur compilé ni navigateur E2E exécuté |
| `performance-react-nextjs` | NON_TESTE | Pas de charge p95/100k mesurée |
| `finance-maroc` | PASS_CIBLE | Script ciblé, non HTTP |
| `exploitation-resilience` | PASS_CIBLE | Script ciblé, non HTTP |
| `benchmark-normes` | NON_TESTE | Comparaison externe et normes non réétudiées sur cette R5 |
| `nettoyage-code` | NON_TESTE | Contrôle du ZIP dans le contre-audit de livraison |
| `contre-audit-livraison` | NON_TESTE | Contrôle du ZIP dans le contre-audit de livraison |
| `articles-negoce-o2c` | PASS_CIBLE | Script ciblé, non HTTP |
| `acheteur-poste-travail` | PASS_CIBLE | Script ciblé, non HTTP |
| `acheteur-navigation-complete` | PASS_CIBLE | Script ciblé, non HTTP |

**Bilan provisoire :** 14/20 scripts ciblés réussis ; 6 axes sans script représentatif exécuté. Les contrôles de livraison et nettoyage font l’objet de vérifications séparées dans le dossier de preuves final.
