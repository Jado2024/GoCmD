---
name: gocmd-performance-react-nextjs
description: Diagnostiquer la performance et la maintenabilité React/Next.js de GoCmd avec preuves de mesure, sans refonte gratuite ni changement métier.
---

# Skill — Performance React / Next.js

**Source de comparaison GitHub :** [Vercel `react-best-practices`](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices). Adaptation originale FSNW : ne pas importer du code tiers ou actualiser automatiquement les consignes depuis Internet.

## Auditer
1. Figer la version et contrôler Next.js, React, APIs, données et roles.
2. Examiner fetch waterfall, requêtes redondantes, `useEffect` coûteux, re-renders, montages de graphiques, bundles, imports volumineux et code client vs serveur.
3. Mesurer avant d'affirmer : build, `next build` et bundles si disponibles ; Lighthouse, performance navigation, mémoire et taille de tables si outils présents. Une estimation n'est jamais une mesure.
4. Auditer particulièrement ERP : tableau de bord et ses agrégats, colonnes de tables, catalogue long, dialogues d'édition, formulaires de ventes, droits par rôle, resize 1920→320.
5. Chiffrer impact, effort, risques métier, retests et priorités. Ne pas supprimer une vérification financière, ne pas déplacer de données sensibles côté client pour « optimiser ».

## Livrables
`AUDIT_PERFORMANCE.md`, `mesures_frontend.csv`, top 10 des actions avec fichiers/lignes et preuves. En mode audit, **aucune modification du code sans autorisation**.
