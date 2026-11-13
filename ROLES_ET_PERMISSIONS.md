# Rôles et permissions — GoCmd / SODEPI (P6, 2026-11-11)

> Document officiel. Source de vérité : `src/lib/user-directory.cjs` (table
> `RIGHTS`, contrôlée par `tests/v1898-roles.test.mjs` et
> `tests/audit-api-matrix.cjs` — 543 requêtes réelles). Toute modification du
> code DOIT être répercutée ici et re-testée.

## 1. Modèle d'authentification

- Comptes nominatifs SQLite (`GoCmdUser`), mot de passe **scrypt** (sel 16 octets,
  dérivation 32 octets, comparaison à temps constant), obligatoirement renouvelé
  à la première connexion.
- Sessions révocables (`GoCmdSession`) par cookie `gocmd_session` **HttpOnly,
  SameSite=Lax**, expiration 8 h maximum, révocation immédiate à la déconnexion
  et à la désactivation du compte.
- Verrouillage local (deux limiteurs complémentaires, C4 doc) :
  - `/api/auth/login` (session) : 10 échecs / 5 min par compte, fenêtre **glissante** → blocage 5 min (`Retry-After: 300`) ;
  - accès Basic historique : 12 échecs / 5 min par identifiant → 1 min de blocage ;
  - le reverse proxy DOIT en plus limiter par IP — voir SECURITE.md.
- Le compte partagé de démonstration historique est **strictement en lecture
  seule, sans aucun rôle** : aucun réglage ne peut l'élever.
- Aucune validation par clé partagée : les confirmations sensibles exigent le
  **mot de passe personnel** du directeur (visa tarifaire) — quatre yeux nominal.

## 2. Rôles métier (10)

| Rôle | Intitulé SODEPI | Usage principal |
|---|---|---|
| `buyer` | Acheteur | DA, consultations, offres, BC, matières, fournisseurs |
| `approver` | Responsable achats / approbateur | Validations achats et ventes (quatre yeux) |
| `sales` | Commercial | Devis, commandes clients, livraisons |
| `receiver` | Réceptionnaire | Réceptions fournisseur (BL) |
| `inventory` | Magasinier | Mouvements de stock, préparation d'OF |
| `quality` | Qualité | Contrôles, mises en quarantaine, retours fournisseur |
| `finance` | Comptabilité / finance | Factures fournisseurs et clientes, paiements, avoirs |
| `director` | Direction | Visa tarifaire des prix spéciaux, vue complète |
| `production` | Responsable production | OF de réassort (proposer/approuver/planifier/terminer) |
| `admin` | Administrateur | Gestion des comptes et permissions — **aucune opération métier** |

Un compte peut cumuler plusieurs rôles (ex. `sales` + `approver`) ; le quatre
yeux s'applique néanmoins : **le créateur d'une opération ne peut jamais
l'approuver lui-même** (contrôle serveur, `createdBy ≠ validateur`).

## 3. Permissions granulaires (source : `RIGHTS`)

| Permission | Rôles par défaut | Opération contrôlée (exemples) |
|---|---|---|
| `users.read` / `users.manage` | admin | Administration des comptes |
| `purchases.create` | buyer | POST /api/purchases |
| `purchases.approve` | approver | PATCH /api/purchases/{id} |
| `supplier-orders.create` / `.approve` | buyer / approver | Bons de commande fournisseur |
| `suppliers.manage` | buyer | Fiches fournisseurs |
| `materials.manage` | buyer | Fiches matières (seuils, tarifs de vente) |
| `receipts.create` | receiver | POST /api/goods-receipts |
| `quality.manage` | quality | Contrôles qualité, retours fournisseur |
| `stock.read` | buyer, approver, receiver, inventory, quality, finance, director | Consultation du stock — **appliquée côté serveur sur GET /api/stock-lots et GET /api/movements (C4)** |
| `p2p.overview.read` | idem stock.read | Vues d'ensemble achats |
| `stock.move` | inventory | POST /api/movements, préparation d'OF |
| `stock.count` / `stock.count.approve` | inventory / approver | Inventaires |
| `production.*` (propose, approve, plan, start, finish, close) | production | OF de réassort |
| `products.create` / `products.manage` | sales / approver | Catalogue produits |
| `sales.quotes` / `sales.orders` / `sales.deliveries` | sales | Devis, commandes, livraisons |
| `sales.approve` | approver | Validation quatre yeux des commandes |
| `sales.invoices` / `sales.payments` / `sales.credits` | finance | Facturation cliente |
| `director.prices` | director | Visa des prix spéciaux (confirmation personnelle) — **exigé sur TOUS les circuits tarifaires : prix spéciaux, prix catalogue, tarif de vente matière (C4)** |
| `finance.purchases` / `finance.export` | finance | Factures fournisseurs, exports comptables |
| `costs.read` | buyer, approver, finance | Prix d'achat et CUMP (masqués pour les autres rôles) |
| `clients.read` | sales, finance, approver | Données clients (commandes, répertoire). Les **relevés client** (règlements) restent réservés au rôle finance |

Les permissions sont **désactivables individuellement** par compte (écran
d'administration) : un retrait prend effet immédiatement côté serveur — un
bouton caché n'a jamais constitué une protection. La matrice réelle est
vérifiée par `npm run test:audit:api` (aucun compte / autorisé / interdit /
désactivé / session expirée / permission révoquée / auto-validation).

## 4. Quatre yeux — opérations concernées

- Approbation d'une demande d'achat, d'un BC fournisseur, d'un plan d'attribution.
- Validation d'une commande client en revue technique ou tarifaire.
- Validation des prix spéciaux : **visa directeur avec mot de passe personnel**.
- Approbation des avoirs clients ; règlements (comptes finance distincts).
- Aucun OF n'est créé tant qu'une validation requise est en attente.

## 5. Ce que ce document ne couvre pas

Les règles métier détaillées (seuils, CUMP, FEFO, gabarits, TVA) sont dans
`REGLES_METIER.md` ; les mesures de sécurité techniques dans `SECURITE.md` ;
la procédure de création/modération de comptes dans le `RUNBOOK.md`.
