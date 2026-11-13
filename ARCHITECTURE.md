# ARCHITECTURE — GoCmd / SODEPI P5.15.23 RC

Documentation de la RC P5.15.23. Les chiffres historiques d’inventaire ci-dessous peuvent évoluer ; le dépôt fait foi.

## pile technique

| Composant | Version | Rôle |
|---|---|---|
| Next.js | ^16.4.3 (App Router, build `--webpack`) | framework applicatif, pages et API |
| React | ^19.3.1 | rendu client |
| TypeScript | ^5.9.3 (`tsc --noEmit` en CI) | typage strict |
| Prisma / @prisma/client | ^6.19.3 | ORM |
| SQLite (journal DELETE, `busy_timeout=5000`, `foreign_keys=ON`) | base unique `db/custom.db` | persistance |
| Tailwind CSS | ^4.3.3 + shadcn/ui (New York) + Lucide | interface |
| Zod | ^4.6.7 | validation des entrées |
| Bun | install/lockfile ; Node ≥ 24 pour serveur et scripts utilisant node:sqlite | exécution |

## Structure du code

```
src/app/                 App Router — écrans (login, poste de travail par rôle)
src/app/api/             routes et endpoints HTTP (inventaire à générer du code)
  admin, auth, clients, dashboard, goods-receipts, materials, me, movements,
  orders, p2p (12 sous-domaines), products, purchases, quality-inspections,
  sales, stock-lots, supplier-invoices, supplier-orders, supplier-returns,
  suppliers
src/lib/                 bibliothèques métier (accès, catalogue, gabarits,
  géométrie, p2p, facturation valorisée, exports, erreurs API…)
src/proxy.ts             CSP à nonce par requête (pattern officiel Next.js)
prisma/schema.prisma     modèles Prisma (utilisateurs, sessions, audit, catalogue,
  achats DA/consultations/offres/contrats/BC/BR, stocks lots/mouvements,
  ventes, finance, qualité)
prisma/sql/              migrations SQL officielles (non idempotentes — à
  contrôler avant réapplication)
scripts/                 40+ scripts : migrations versionnées, garde de schéma,
  sauvegarde SQLite, initialisation comptes, vérifications de livraison
tests/                   tests automatisés (voir TESTS.md)
fsnw/                    doctrine métier + 20 skills d'audit (voir
  fsnw/POLITIQUE_SODEPI_ACTUELLE.md, fsnw/MATRICE_SKILLS.md)
```

## Principes structurants

1. **Toute règle métier est contrôlée côté serveur** (routes API + librairies) ;
   l'UI ne fait qu'afficher. Aucune décision de sécurité ou de prix ne repose
   sur le client.
2. **Transactions Prisma** (`$transaction`) pour chaque écriture multi-tables
   (approbations, réceptions, factures, paiements, mouvements de stock).
3. **Séparation des tâches à quatre yeux** fondée sur l'identité de l'auteur
   (`SELF_APPROVAL` 403), même en cumul de rôles.
4. **SQLite durci (R13.3)** : journal `DELETE` obligatoire et vérifié au
   démarrage (`WAL` refusé depuis P5.15.28), `busy_timeout=5000`,
   `foreign_keys=ON`, sérialisation des écritures par Prisma et verrou
   mono-instance. Le garde `refuse-unsafe-schema-change.cjs` interdit
   `prisma db push` accidentel.
5. **Audit trail** : événements d'audit en base (`GoCmdAccessAudit`,
   `AuditEvent`), journalisation des décisions sensibles (attributions,
   approbations, visas tarifaires).
6. **Erreurs API contractuelles** : codes métier stables traduits en messages
   utilisateur explicites (p2p-api-errors.ts).

## Limites assumées (hors périmètre GoCmd — doctrine §2)

**Les OF simplifiés (CMD → OF automatique → préparation / étiquettes / suivi)** existent dans GoCmd, y compris pour les articles revendus. **Les OF industriels détaillés**, BOM/nomenclatures, MRP, calcul des besoins MP, consommation automatique des MP, coûts réels et traçabilité de transformation MP→PF relèvent de GoProd. La P5.15.23 ajoute la réservation ferme par lot des matelas finis, sans débit avant BL.
