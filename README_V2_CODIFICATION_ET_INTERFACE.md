# GoCmd / SODEPI — livraison de travail V2 (CANDIDATE, NON HOMOLOGUÉE)

**Date :** 11 novembre 2026  
**Source :** CASCADE4-R2 / `18.9.13-p6.15.30-p6u-cascade4-r2-rc`  
**Base :** exclusivement `db/custom.db`, données fictives DEMO SODEPI  
**Référentiel :** `docs/V2_SPECIFICATION_SOURCE.md` ; AMDEC précédente dans `docs/V2_AUDIT_AMDEC_SOURCE.md`.

## Statut honnête

Cette archive contient du **code modifié**, des **écrans Next/React modifiés**, une **base SQLite DEMO recodifiée** et des **tests ciblés réalisés**. Le résultat n'est **PAS** homologué en production ; les dépendances Next/Prisma/Bun et le runtime Node 24 nécessaires à une compilation/recette de bout en bout n'étaient pas installés dans l'environnement d'audit. L'absence de compilation complète interdit tout verdict « PASS global ».

**Ne jamais placer `db/custom.db` de démonstration en production.** Conserver l'archive d'origine intacte. La convention des attributs hors mousse est **DEMO / provisoire**, à valider par les Achats, la Qualité et le Magasin avant utilisation réelle.

## Modifications effectuées

| Domaine | Réalisation candidate | Limite |
|---|---|---|
| COD-01 | Clé fournisseur normalisée : unicité SQL, code original intact, collision bloquée et retour HTTP 409 | Workflow de dérogation à quatre yeux NON livré |
| COD-02 | Dictionnaire technique `src/lib/article-identity.ts` ; référence et identité canonique des familles tissu, ressorts, fibre, mercerie, emballage, colle, et mousse existante | Dictionnaires métiers provisoires ; tests de concurrence HTTP à faire |
| COD-03 | Identité PF fixe côté serveur, modifications des attributs techniques empêchées pour fiches V2, fiches GEN internes verrouillées | Interface de révision liée à l'ancienne référence NON livrée |
| COD-04 | Protection d'unicité PF, mécanisme historique de produits proches conservé | Recherche de similarité avancée multi-familles non terminée |
| COD-05 | Recherche par référence fournisseur en API matières, sous autorisation achats | Recherche par alias/ancien code transversale à finir |
| COD-06/07 | Identifiant pièce et codes-barres internes conservés ; GTIN non fabriqué artificiellement | Historique d'alias et intégration GS1 conditionnelle non réalisés |
| COD-08 | Index physiques canonique/référence fournisseur ; pagination produit existante | Charges 10k/100k, pagination matière côté serveur non mesurées |
| COD-09 | Modèles `GEN-MAT`, `GEN-MOU`, `GEN-SAL`, `GEN-DIV` dans formulaire ; pas de gabarit stockable partagé | Fiche technique interne par ligne, méthode de transition explicitement admise par la V2 |
| COD-10 | Configuration de ligne autonome, champs structurés et snapshot immuable JSON + SHA-256 | Pas encore de parcours complet de modification d'une commande en brouillon |
| COD-11 | Prix générique soumis au visa directeur de chaque `OrderLine`, quatre-yeux conservés ; ajout de l'UX commandes | Décision de prix actuellement groupée par commande dans l'écran, pas de bouton individuel par ligne |
| COD-12 | OF après approbation, snapshot imprimable, documents BL/facture et étiquettes enrichis pour GEN | Parcours devis GEN non livré (bloqué explicitement), avoir et flux physiques à requalifier par HTTP/E2E |
| Interface | Saisie technique guidée des matières, nouvelle option hors catalogue, détail des configurations ligne, libellés et messages d'erreur | Validation visuelle navigateur, écran mobile, ergonomie 100k à tester |
| DEMO | Reset protégé et déterministe, recodification 82 MP/218 PF, 135 liens fournisseurs, 64 lots, 29 références négoce alignées, 300 correspondances dans CSV | Les valeurs de variantes hors mousse sont **synthétiques**, non relevées physiquement |

## Circuit commande générique

1. Le commercial sélectionne « Hors catalogue · GEN-* », renseigne désignation, specs et dimensions, prix et pièces.
2. **Aucune fiche `Product` n'est créée durant l'ouverture/annulation du formulaire.** Au POST validé, une fiche **interne non catalogue, propre à chaque ligne** (`isOrderScoped`) est créée dans **la même transaction** que CMD + lignes.
3. Cette fiche porte un code interne `INT-GEN-*` pour compatibilité FK, **sans être un SKU commercial permanent**. La ligne présente « Hors catalogue — référence non attribuée » et conserve son snapshot technique.
4. Le directeur (permission `director.prices`, confirmation personnelle et séparation d'identité) valide les prix en attente au niveau de chaque ligne ; un approbateur **différent du commercial** confirme ensuite la commande.
5. Les OF ne sont pas générés avant la confirmation de CMD ; aucune nomenclature GoProd ni consommation automatique MP n'est ajoutée.
6. Référence commerciale neutre sur BL/facture, dimensions et spécifications remontées du snapshot GEN ; aucune mutualisation du stock sous un modèle `GEN-*`.

## Réinitialisation sécurisée : DEMO uniquement

À lancer **à l'arrêt du serveur**, dans l'archive décompressée et identifiée DEMO :

```bash
python scripts/recreer_demo_sodepi_p51523.py --apply --ack DEMO_ONLY
```

Le script :
- refuse tout chemin autre que `db/custom.db` de cette archive et les liens symboliques ;
- refuse si des indicateurs d'environnement signalent la production ;
- si la base existe, exige le marqueur `WarehouseSite.code = 'SODEPI-DEMO'` ;
- construit une nouvelle base temporaire depuis le seed fictif, ajoute le schéma/codification V2, vérifie l'intégrité et remplace atomiquement la base DEMO ;
- exporte `db/recodification_v2_mapping.csv` ; ne conserve pas les commandes et les mouvements d'essai.

**Attention :** un opérateur doit lui-même conserver une sauvegarde indépendante du fichier source avant reset ; ce script ne sauvegarde PAS automatiquement l'ancien fichier DEMO. Aucune autorisation de reset sur une vraie base de production n'est donnée.

## Tests exécutés dans l'environnement d'audit

- 15 tests Python `tests/test_v2_demo_integrity.py` : succès ; contrôles SQLite réels et collisions simulées **en mémoire**.
- 5 tests Node `tests/v2-article-identity.test.mjs` : succès ; générateurs d'identité et codes fournisseur.
- `tests/test_p51523_demo_reseed.py` : succès ; deux régénérations sur une copie et refus sans marqueur DEMO.
- `tests/test_p51523_history_guards.py` : succès.
- `tests/test_security_closure_20261109.py` : succès (tests majoritairement de contrat statique).
- `tests/test_p51521_work_orders_security_contract.py` : succès (20 contrats statiques).
- `tests/c4-lib-contracts.test.mjs` : succès.
- `tests/c4-r2-prices-permission.test.mjs` : succès.
- `tests/c4-rev1-permissions.test.mjs` : succès.
- Analyse syntaxique de **201 fichiers** `.ts/.tsx` avec l'analyseur TypeScript global : **0 erreur de syntaxe**, ce qui n'est **pas un typage `tsc --noEmit`**.

## Gates NON VALIDÉS et risques résiduels prioritaires

**Bloquants pour homologation :**
1. `npm ci`/Bun sur Node 24, `prisma generate`, `tsc --noEmit`, lint, `next build`.
2. Recettes HTTP multi-rôles de tous les circuits, y compris achat/vente/qualité/finance et délégation des permissions ; Playwright desktop/mobile.
3. Vérifier à l'exécution création GEN, rejet de visa prix, refus auto-approbation, OF et facturation, avoir, réservation et mouvements réels sous concurrence.
4. Statuer métier pour les dictionnaires d'identité, les dimensions/conditionnements de chaque famille, l'historique d'alias et les révisions PF.
5. Ne pas activer les devis génériques avant d'avoir le support des snapshots et du visa prix dans les devis.
6. Mesurer la pagination et recherche à 10k/100k, améliorer l'affordance des tableaux sur mobile et stabiliser le tri serveur.

## Reprise de vérification dans l'environnement cible

```bash
# Node >= 24 et dépendances installées (internet / cache requis)
npm ci
npx prisma generate
npx tsc --noEmit
npm run build
npm run test:codification:v2
python tests/test_p51523_demo_reseed.py
```

Les tests HTTP/E2E doivent se dérouler **sur une copie de recette**, puis reconstruire la DEMO propre pour livraison. Ne pas déclarer une homologation sans les preuves des gates ci-dessus.
