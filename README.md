# GoCmd / SODEPI — R13.3 REPRISE · projet opérationnel nettoyé

**Statut : GO technique conditionnel selon la campagne de reprise du 13/11/2026 ; NON homologué pour la production SODEPI.**

Cette livraison provient **exclusivement** de `GoCmd_SODEPI_R13_3_REPRISE_PROJET_COMPLET.zip` (SHA-256 `1dc791a518b48b6e45e90d0290b68c1dd7becdda39d4847d76dd3c077515b13c`). Le nettoyage ne modifie **aucun fichier applicatif, test, schéma Prisma, migration ni base DEMO**. Les anciens rapports/logs, retirés du paquet opérationnel, sont disponibles dans l'archive historique complémentaire.

## À lire en premier

1. **[PLAN_RESTANT_R13_3.md](PLAN_RESTANT_R13_3.md)** — chantiers prioritaires, critères de clôture, dépendances et décision GO/NO-GO.
2. **[ORGANISATION_PROJET.md](ORGANISATION_PROJET.md)** — arborescence, provenance, inventaire et exclusions de nettoyage.
3. [REGLES_METIER.md](REGLES_METIER.md), [ROLES_ET_PERMISSIONS.md](ROLES_ET_PERMISSIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md) — contrats métier.
4. [SECURITE.md](SECURITE.md), [RUNBOOK.md](RUNBOOK.md), [TESTS.md](TESTS.md) — sécurité, exploitation, validation.
5. [fsnw/README.md](fsnw/README.md) — 20 skills FSNW et politique active.
6. [deploy/windows/PROCEDURE_R13_3.md](deploy/windows/PROCEDURE_R13_3.md) — préparation Windows, **non validée sur site**.

## Arborescence essentielle

| Chemin | Contenu |
|---|---|
| `src/` | Code Next.js, TypeScript, API et logique métier |
| `prisma/` et `db/` | Schéma, migrations/scripts SQL et **base DEMO fictive** `db/custom.db` |
| `scripts/` | Scripts d'installation, de sécurité, de migration, de contrôle et de sauvegarde |
| `tests/` | Régression, HTTP, RBAC, corruption, concurrence, Playwright |
| `deploy/` | Procédures Windows et réseau privé |
| `fsnw/` | 20 skills FSNW, référentiels et outils |
| `docs/` | Documentation métier active et deux références historiques requises par les tests |
| `AUDIT_FINAL_P51521/`, `PDCA_R5/`, `QA_P5157_MOIS/` | **Exceptions de compatibilité historique nécessaires à certains tests** |
| `CHANGELOG.md`, `LIVRAISON_R13_3.md` | Historique technique et livraison de référence |

## Installer pour une recette isolée (Node 24)

```bash
npm ci
npx prisma generate
npm run test:r133:integrity:contract
npm run test:types
npm run lint
npm run build
```

La commande existante pour le contrôle est **`npm run test:r133:integrity:contract`** (voir `package.json`). Les tests HTTP dangereux pour des données réelles doivent être lancés **exclusivement** sur une copie jetable avec les confirmations exigées par les harnais. Pour la campagne complète, consulter `TESTS.md` et le plan.

**Ne jamais** exposer GoCmd directement sur Internet, utiliser `next start` en contournant le starter vérifié, ni installer `db/custom.db` sur un environnement de production. Ne jamais effacer une base de production sur la base de l'autorisation de réinitialiser la DEMO.

## Réserves explicites

- P2P consultations : p95 **5 080 ms** à 50 utilisateurs / 20 000 commandes (sandbox 2 vCPU).
- Liste commandes : p95 **1 687 ms** à 50 utilisateurs / 20 000 commandes, objectif indicatif 1 500 ms **non atteint** dans ce scénario.
- GEN-DIV actuellement suspendu avec HTTP 400 ; décision métier SODEPI indispensable.
- Un 401 intermittent observé sur 600 créations dans une campagne 2 000 commandes / 50 utilisateurs ; non reproduit ensuite dans l'investigation ciblée.
- Déploiement Windows/HTTPS/Tailscale, sauvegardes sur site, base de production initiale et conformité fiscale : **non validés sur le matériel réel**.

Ces chiffres sont issus des **journaux de reprise fournis**, pas de nouveaux benchmarks exécutés durant le présent nettoyage documentaire.

## Nettoyage traçable

Consulter `MANIFESTE_NETTOYAGE.json` et la livraison séparée des **archives historiques**. Aucun fichier métier supprimé. La base de démonstration doit conserver le SHA-256 `65288ab6a380d3b9a7d8f8b3447fe011d01f674eca4c60efc19d310abf06545d`.
