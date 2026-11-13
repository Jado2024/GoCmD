# Évaluation de skills GitHub utiles à GoCmd — 2 novembre 2026

Ce fichier est **un catalogue de références**. Aucun script tiers n'est exécuté et aucun skill de tiers n'est copié dans le ZIP. Les adaptations locales sont originales et respectent les règles métier SODEPI. L'agent peut lire les projets référencés après examen de licence et validation utilisateur.

| Projet | Intérêt concret GoCmd | Qualification / décision |
|---|---|---|
| [Anthropic / skills — webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | Playwright, tests réels, captures et console | Référence **recommandée** pour `tests-navigateur-playwright`. Skill publié avec `LICENSE.txt` Apache-2.0 selon dépôt. Ne pas copier de script sans vérification et avis. |
| [Vercel Labs / agent-skills — react-best-practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) | Performance Next.js / React, chargements, rendu et bundles | Référence **recommandée** pour `performance-react-nextjs`. README du repo annonce MIT mais un ticket GitHub signale l'absence de fichier `LICENSE` ; **pas de copie vendored**. |
| [Vercel Labs / agent-skills — web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Code review UX/accessibilité avec repères `fichier:ligne` | **À consulter manuellement**. Le skill récupère des règles distantes lors de l'exécution : éviter l'injection de consignes via contenu tiers non figé ; pas de chargement automatique. |
| [GuidanceStudio / uxui-audit-skill](https://github.com/GuidanceStudio/uxui-audit-skill) | Audits visuels sur captures (13 dimensions) | Piste supplémentaire, non intégrée : maturité/licence et exactitude à vérifier avant usage réel. |
| [W3C / ARIA Authoring Practices](https://github.com/w3c/aria-practices) | Référence officielle de patterns clavier, rôles et composants ARIA | **Documentation de référence**, pas un skill à exécuter. |

## Règles de sélection et de sûreté
- Préférer mainteneur identifié, licence explicite, fichiers lisibles, absence de secrets/télémetrie/curl|bash cachés et compatibilité avec FSNW.
- Ne jamais copier/exécuter un skill GitHub sans inspecter l'intégralité des instructions, scripts, dépendances, commandes destructives, réseau et licences.
- Toujours garder les **règles SODEPI et le STOP UX après rapport** prioritaires sur les recommandations externes.
- Si l'examen nécessite Internet indisponible, citer le lien officiel et marquer **Non installé** plutôt que simuler l'installation.
