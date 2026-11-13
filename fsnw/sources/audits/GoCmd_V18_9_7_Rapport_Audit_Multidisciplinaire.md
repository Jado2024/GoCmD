# Contre-audit multidisciplinaire — GoCmd V18.9.7

**Date : 2 novembre 2026** · **Base auditée : archive V18.9.6** · **Sortie : correctifs V18.9.7**

## Méthode et niveau de preuve

L'archive source V18.9.6 a été **extraite** et inspectée : routes Next.js, RBAC, Prisma, intégrité SQLite, CI, tests historiques, documentation et packaging. Les tests runtime et la base ont été exécutés depuis l'archive extraite. Après modifications, le même ensemble de tests a été ré-exécuté et une validation supplémentaire est imposée sur le ZIP reconstruit.

**L'environnement présent dispose de Node 22 et Python 3.13, mais pas de Bun ni du jeu de dépendances Prisma/Next installé.** Il n'est donc **pas possible de garantir ici** `bun install --frozen-lockfile`, `prisma generate/validate`, `tsc --noEmit` intégral, `next build`, HTTP end-to-end ou tests navigateur. Ne jamais transformer un test statique PASS en preuve de recette HTTP PASS.

## Synthèse par discipline

| Discipline | Résultat constaté | Limite / action |
|---|---|---|
| Sécurité / RBAC | Les contrôles GET de V18.9.6 sont présents ; **2 fuites supplémentaires dans des POST qualité** corrigées en V18.9.7. | Rejouer avec comptes de différents rôles, vérifier les montants réellement absents de JSON. |
| Achats et fournisseurs | P2P, fournisseur↔matière et retours conservés. **Code `FRN-count+1` susceptible de collision après suppression** corrigé. | Tester en HTTP création après suppression et deux créations simultanées. |
| Stocks, qualité et traçabilité | Lots, quarantaine, comptages à quatre yeux, transferts et FEFO présents ; invariants SQLite réussis dans le jeu livré. | Refaire SC-05 terrain et gestion FEFO sur lots périmés ; pas de consommation automatique MP attendue. |
| Ventes et prix directeur | Workflow `director` explicite, commerciaux et validateurs distincts ; tests de régression historiques PASS. | Tester modification prix en parallèle, 2 profils et passage devis→commande→BL→facture réel. |
| Finance / calculs | Crédits fournisseur consommés partiellement en transaction et vérifications présentes, mais les API de qualité exposaient des centimes d'avoirs. | Réconciliation comptable et TVA Maroc à valider ; mélange Float/Decimal toujours présent. |
| Base SQLite / migration | `PRAGMA integrity_check=ok`, `foreign_key_check` vide, référentiel de démo préservé. | Multi-processus et reprise sur incident non certifiés ; migrations testées exclusivement sur copies. |
| Qualité code / CI | Régressions runtime PASS, contrôle TypeScript de syntaxe disponible. CI prévoit compilation et un test RBAC GET isolé. | ESLint contient de nombreuses règles off ; tests HTTP métiers complets non lancés dans la CI. |
| UX / déploiement | Ergonomie contrôlée au moins statiquement ; pas de changement des composants UI dans ce correctif. | Tests mobiles réels, accessibilité WCAG, conformité sécurisée HTTPS/reverse proxy non établis. |

## Registre des problèmes corrigés

### SEC-QA-01 — P1 — Montants financiers dans la réponse de contrôle qualité
- **Preuve de V18.9.6 :** `src/app/api/quality-inspections/route.ts` calculait `financialCorrection.invoicedCents` et `creditCoverageCents` puis renvoyait `result` directement via `NextResponse.json(result)`. La route exigeait `quality`, mais non `finance`.
- **Impact :** divulgation du montant de factures et des avoirs fournisseur à un agent qualité sans habilitation financière.
- **Correction :** la réponse est un DTO filtré selon `canSeeMaterialCosts(req)` ; un agent qualité ordinaire ne voit que `{required:true}`. Le montant demeure traçable dans l'événement interne et n'est pas nécessaire à l'affichage de quarantaine.
- **Test attendu :** rejet d'un lot lié à une facture avec un compte quality uniquement, inspecter *toutes* les clés JSON, vérifier absence de `invoicedCents` et `creditCoverageCents` ; vérifier la présence du drapeau et la transition stock.

### SEC-QA-02 — P1 — Allocation des avoirs divulguée dans la réponse du retour fournisseur
- **Preuve V18.9.6 :** `src/app/api/supplier-returns/route.ts` renvoyait directement les objets `creditAllocations` (avec `creditId`/`amountCents`) et `allocatedCents` alors que seul le rôle `quality` était requis.
- **Correction :** pour un acteur quality-only, `creditAllocations=[]`, `allocatedCents=null`, avec référence et nombre d'avoirs traités conservés. Le plan d'affectation reste enregistré en base dans la transaction ; finance conserve accès au détail autorisé.
- **Tests attendus :** retours successifs 4+3+2 unités financés par un avoir, vérifier réponses quality sans montants, puis lire la comptabilité en finance et prouver que le reste passe exactement à zéro. Double retour / avoir insuffisant doit être refusé.

### SUP-REF-01 — P2 — Référence fournisseur après suppression
- **Preuve V18.9.6 :** `src/app/api/suppliers/route.ts` calculait `FRN-` + `(await tx.supplier.count())+1`. Après suppression de la dernière fiche, la prochaine création pouvait réutiliser un code existant ou un code historique.
- **Correction :** référence UUID aléatoire tronquée à 16 hexadécimaux, contrainte `UNIQUE` de la base conservée, aucune altération des références existantes.
- **Tests attendus :** création répétée, suppression sur copie uniquement, simultanéité, unicité et validation du lien fournisseur/matière.

### DOC/QA-01 — P3 — Documents périmés et tests prouvant une fuite
- **Preuve :** README racine empilait sept versions ; anciens prompts et journaux au même niveau que le dossier courant. La recette `http-v1892-remediation.cjs` exigeait explicitement que la réponse quality contienne les valeurs financières.
- **Correction :** README réduit à la version en cours, anciennes notices déplacées sous `docs/historique/` ; tests F04/F05 adaptés, manifeste SHA régénéré.

## Problèmes et risques restant ouverts — non présentés comme corrigés

| Réf. | Niveau | Constat / limite | Action mesurable |
|---|---|---|---|
| OPEN-01 | P1 exploitation | Basic Auth exige du HTTPS de bout en bout ; mécanisme IP limité au proxy, blocage mémoire par processus. | TLS confirmé, proxy verrouillé, test d'accès HTTP refusé, limites IP et journaux. |
| OPEN-02 | P1 validation | Nouveau circuit qualité/retour non rejoué en HTTP dans cet environnement. | Exécuter recette `http-v1892-remediation.cjs` sur serveur production local et base isolée, plus `test:http:privacy`. |
| OPEN-03 | P2 robustesse | SQLite sérialise les écritures dans un processus ; pas d'engagement multi-instance. | Recette multi-processus ou déploiement mono-instance explicite, verrouillage/DB adaptés. |
| OPEN-04 | P2 qualité | De nombreuses règles ESLint désactivées ; le `lint` précédent avait un warning. | Réactivation contrôlée par lots, mesurer erreurs / corriger sans neutraliser CI. |
| OPEN-05 | P2 test | CI exécute le test de confidentialité GET, mais pas toutes les recettes financières POST E2E. | Ajouter recette isolée sécurisée et reproductible à CI après validation préalable. |
| OPEN-06 | P2 finance | Prix/quantités historiques encore en JS Float tandis que d'autres montants sont Decimal / centimes. | Inventaire des conversions et tests de centimes/TVA multi-lignes. |
| OPEN-07 | Validation atelier | Gabarit Richbond 51 : convention K/L/H non signée. | Valider plan coté et formule de facturation auprès de l'atelier SODEPI. |
| OPEN-08 | Juridique | Loi 09-08/CNDP et documents fiscaux Maroc non validés. | Responsable données et expert-comptable marocain avec critères écrits. |
| OPEN-09 | UX et terrain | Tests réels de deux personnes, scanners, imprimantes, 320 px, WCAG incomplets. | Recette terrain avec preuves d'usage, temps, erreurs et supports physiques. |
| OPEN-10 | Référentiel | Agrégats de valeurs de stock du dashboard encore accessibles hors achats/finance ; ce droit était laissé à arbitrer SODEPI. | Décider confidentialité des agrégats ; si interdits, adapter DTO ET UI avant production. |

## Périmètre explicitement non applicable

**Ne pas ouvrir de P0** sur nomenclatures/BOM, ordres de fabrication industriels, consommation automatique MP, MRP, réservation des MP ou suffixe obligatoire C/S. Ces fonctionnalités ne font pas partie de GoCmd à ce stade ; elles relèvent de GoProd ou de décisions métier ultérieures.

## Conclusion

**V18.9.7 corrige des fuites vérifiables à la lecture du code et préserve les régressions existantes.** Il reste une *candidate de recette* : seule l'exécution de la compilation Next.js, de la vraie batterie HTTP (avec réponses qualité redacted), des tests terrain, et des validations fiscales / de sécurité peut permettre de décider d'une mise en exploitation. Aucun score de conformité réglementaire ou déclaration « zéro bug » n'est justifié par les preuves disponibles.
