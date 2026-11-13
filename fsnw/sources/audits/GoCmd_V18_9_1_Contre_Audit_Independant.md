# GoCmd V18.9.1 — Contre-audit indépendant de l'archive livrée

**Date :** 1er novembre 2026  
**Source :** `GoCmd_V18_9_1_Projet_Complet_Audite_Corrige (1).zip`  
**SHA-256 :** `f19030771dcd21c56c8bb5ca3e36392903048dc6c5ff6b9ce6c792eb3c287797`  
**Nature :** contre-audit ciblé de l'intégrité des correctifs V18.9.1, sans modification de l'archive originale. **Ne constitue pas** une certification ou un audit exhaustif d'exécution.

## Contrôles exécutés

| Contrôle | Résultat | Limite |
|---|---|---|
| ZIP (163 fichiers), extraction, `testzip` | PASS | Aucun défaut de structure constaté |
| Base SQLite `PRAGMA integrity_check` | PASS (ok) | Base de démonstration uniquement |
| Base SQLite `PRAGMA foreign_key_check` | PASS (0 violation) | Pas un contrôle de toute la logique métier |
| Base : produits / lots / factures fournisseurs | 189 / 62 / 4 | Correspond à la démonstration livrée |
| `python tests/test_v187_audit.py` | PASS | Réparation du nom historique confirmée |
| `python tests/test_v1891_counter_audit.py` | PASS (44 contrôles) | Majoritairement contrats statiques |
| `npm run test:regression:runtime` | PASS (exit 0) | Ne lance pas `tsc`, `next build`, ni les API HTTP |
| Installation Bun gelée, Prisma generate, TypeScript global, build, E2E HTTP | NON REJOUÉS | Bun/dépendances Next indisponibles dans cet environnement |

## Anomalies et risques résiduels

### F01 — P1 — Fret mal structuré dans le CSV comptable

- **Code :** `src/app/api/p2p/accounting-export/route.ts`, en-tête ligne 12 et ligne FRET ligne 29.
- **Preuve :** l'en-tête contient **15 colonnes**. La nouvelle ligne fret produit **16 champs**. Le texte `FRET` est placé dans la colonne **Quantité**, `1` dans **Prix HT**, le montant du fret dans **Taux taxe %** et **Taxe estimée**, et la mention fiscale dans une seizième colonne sans en-tête.
- **Conséquence :** export impropre à l'import comptable fiable ; les totaux peuvent sembler exacts tout en étant affectés aux mauvais comptes/colonnes.
- **Problème du test :** `tests/http-v1891-remediation.cjs` lignes 143–145 recherche expressément `FRET` en index 8 et additionne les colonnes 12 et 13 ; ce test entérine le décalage. Avec TVA non nulle, additionner taxe et TTC double-compte la taxe, mais le scénario utilise une TVA à 0 %.
- **Solution :** faire figurer le fret dans les 15 colonnes existantes avec une désignation explicite dans une colonne dédiée ou changer le schéma CSV avec une nouvelle colonne **Nature de ligne** pour toutes les lignes ; faire correspondre les valeurs HT, TVA, TTC à leurs en-têtes ; tester 0 %, 20 %, plusieurs lignes et valeurs décimales ; parser le CSV par noms de colonnes, pas par indices codés en dur.
- **Condition de validation :** chaque ligne a le même nombre de champs que l'en-tête, et la somme de la colonne TTC, fret inclus, égale le total de la facture au centime.

### F02 — P1 — Retour impossible sur facture déjà entièrement réglée

- **Code :** `src/app/api/supplier-returns/route.ts` lignes 27–33, `src/app/api/p2p/finance/route.ts` lignes 38–40 et 59–61.
- **Preuve :** le retour d'un lot facturé exige un avoir **approuvé non consommé**. Or une facture déjà réglée n'a plus de solde restant : l'action de création d'avoir refuse toute somme (`AVOIR_SUPERIEUR_SOLDE`).
- **Démonstration dans la base :** les factures 1 et 4 sont intégralement réglées, mais possèdent encore des lots disponibles liés à leurs lignes de réception (notamment lots 56 et 61). Aucun nouvel avoir ne peut être créé sur ces factures via le flux normal.
- **Conséquence :** retour physique après paiement impossible malgré un besoin légitime de remboursement fournisseur.
- **Solution :** concevoir un circuit spécifique **avoir après règlement + créance/remboursement fournisseur**, avec approbation indépendante, compte de remboursement et rapprochement comptable ; ne pas détourner le plafond du solde à payer.
- **Test :** facture totalement payée → anomalie de matière → demande et approbation d'avoir post-règlement → retour → remboursement ou crédit sur transaction ultérieure → soldes et stocks exacts.

### F03 — P1/P2 — Confidentialité des prix fournisseurs contournable

- **Code :** `src/app/api/supplier-orders/route.ts` lignes 19–22, `src/app/api/materials/route.ts` lignes 13–50, `src/app/api/dashboard/route.ts` lignes 130–134.
- **Preuve :** les routes fournisseurs masquent le champ direct `supplierOrderLine.unitPrice` pour les rôles sans accès aux prix, mais retournent l'objet imbriqué `material:true` non filtré ; `Material` contient `unitPrice` et `averageCost`. En plus, `GET /api/materials` renvoie l'objet `material` complet à tout utilisateur authentifié, et les alertes du dashboard diffusent `{...m}`.
- **Conséquence :** les coûts de matières sont accessibles hors rôles achats/finance malgré le filtrage déclaré sur les routes fournisseurs.
- **Solution :** définir une matrice de visibilité des **coûts matières** par rôle et appliquer des DTO explicites ou des `select` Prisma minimaux sur toutes les routes, y compris les imbrications et le dashboard ; tester les réponses HTTP récursivement à la recherche de `unitPrice`, `averageCost`, `cost`.
- **Nuance :** le caractère confidentiel du prix d'une fiche matière doit être confirmé avec SODEPI ; l'incohérence de filtrage reste factuelle.

### F04 — P2 — Rejet qualité toujours impossible après avoir approuvé

- **Code :** `src/app/api/quality-inspections/route.ts` lignes 20–23.
- **Preuve :** le rejet d'un lot `available` lié à une facture `matched`, `approved` ou `paid` lance systématiquement `INVOICED_LOT`, sans vérifier un avoir approuvé. Le message suggère pourtant de créer un avoir avant de rejeter.
- **Conséquence :** les lots non conformes déjà facturés ne peuvent passer par le workflow `reject` même après validation financière. La nouvelle route `supplier-returns` est un autre chemin et ne résout pas la quarantaine qualité.
- **Solution :** formaliser la relation **détection de non-conformité → quarantaine conservatoire → avoir/remboursement → retour ou destruction**, en distinguant isolation physique et correction financière ; ajouter le scénario HTTP correspondant.

### F05 — P2 — Avoir de montant supérieur consommé en totalité par un retour partiel

- **Code :** `src/app/api/supplier-returns/route.ts` lignes 31–39, 74–77.
- **Preuve :** la sélection d'un avoir suffisant marque l'ensemble de l'avoir par `returnId`, sans conserver de montant affecté au retour. Un avoir de 100 MAD peut être marqué utilisé pour un retour de 20 MAD ; ses 80 MAD résiduels ne sont plus utilisables pour un autre retour.
- **Conséquence :** perte de couverture financière pour des retours successifs, et impossibilité de rapprocher rigoureusement la valeur de chaque retour.
- **Solution :** table d'affectation `SupplierReturnCreditAllocation` (`returnId`, `creditId`, `amountCents`) ou affectations équivalentes, avec somme plafonnée par avoir, transaction et clé d'idempotence.

### F06 — P2 — Correction de facture rejetée sous le même numéro impossible

- **Code :** `src/app/api/supplier-invoices/route.ts` et `prisma/schema.prisma` (`SupplierInvoice @@unique([supplierId, invoiceNumber])`).
- **Preuve :** une facture `blocked` rejetée libère la quantité facturable, mais conserve son numéro dans la contrainte d'unicité. Sa ressaisie sous le même numéro est refusée ; le test V18.9.1 contourne ce cas en créant une facture rectifiée sous un nouveau numéro (`FAC-C` au lieu de `FAC-B`).
- **Solution :** décider de la politique documentaire avec la comptabilité : nouvelle facture avec numéro distinct et lien explicite à la facture remplacée, ou cycle de correction traçable sans doublon ; ne jamais supprimer l'historique financier.

### F07 — P2 — CSP encore uniquement déclarative

- **Code :** `next.config.ts`.
- **Preuve :** la règle est envoyée via `Content-Security-Policy-Report-Only`, non `Content-Security-Policy`; elle ne bloque aucune exécution non autorisée. Le `script-src` autorise encore `'unsafe-inline'`.
- **Solution :** mesurer les violations sur les parcours réels, puis appliquer une CSP compatible avec Next.js (nonces/hashes si possible), sans casser le chargement ; surveiller les signalements.

### F08 — P2 — Limites explicitement assumées par la livraison

- `serializedSQLiteWrite` protège un seul processus Node ; ne pas utiliser plusieurs instances d'écriture sans stratégie transactionnelle adaptée.
- Contrôle des connexions erronées en mémoire par processus.
- Absence de recette terrain multi-utilisateur, de validation des documents marocains et de test matériel d'impression.
- Ces réserves ne prouvent pas un bug du mono-processus, mais interdisent une affirmation de validation totale de production.

## Correctifs réellement présents

- Renommage ASCII du document historique ; test V18.7 repasse.
- Colonnes `rejectedBy`, `rejectionReason` présentes dans la base de démonstration ; intégrité SQLite cohérente.
- Saisie de date d'expiration sur les lignes de réception et conservation `receivedAt`/`expiresAt` à la transition des lots.
- Rejet motivé d'une facture bloquée par un autre compte financier, permettant une nouvelle saisie sous une nouvelle référence.
- Nouveau filtre du dashboard sur les clients et totaux commerciaux pour les rôles non commerciaux.
- Comptage de péremption sur l'ensemble des lots au lieu de la seule liste paginée.

## Verdict

**La V18.9.1 améliore réellement la V18.9 mais elle n'est pas prouvée sans défaut.** Le CSV de fret est structurellement incorrect et le processus retour/avoir ne couvre pas les factures déjà entièrement payées. Il faut corriger ces parcours, fixer les tests qui entretiennent le défaut, puis rejouer toutes les portes (Bun gelé, types, build, six recettes HTTP, RBAC, export CSV 0/20 % TVA et scénario post-paiement) depuis une archive propre.
