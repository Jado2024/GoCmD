# SÉCURITÉ — GoCmd / SODEPI P5.15.23 (candidat à recette)

Contrôles réellement implémentés dans le code livré. Référence doctrinale :
`fsnw/POLITIQUE_SODEPI_ACTUELLE.md` §7 (sécurité) et §9 (production & droit).

## Authentification et comptes

- Comptes **nominatifs** en base (`GoCmdUser`) : scrypt + sel, comparaison
  `timingSafeEqual` (`src/lib/access-gate.ts`).
- Sessions en base (`GoCmdSession`, hash SHA-256), cookie **httpOnly**, durée
  8 h, **révocables** (déconnexion immédiate vérifiée par les tests six-mois).
- Limiteur local d'échecs : 12 échecs / 5 min → blocage 60 s par identifiant
  (un reverse proxy doit en plus limiter par IP — DEF-S-06/07 documenté).
- Renouvellement de mot de passe forcé quand requis (`mustChangePassword`).

## Rôles et permissions (RBAC serveur)

- 10 rôles : `buyer`, `sales`, `approver`, `receiver`, `inventory`, `quality`,
  `finance`, `admin`, `director`, `production`.
- Un compte peut **cumuler** des rôles ; les permissions restent par action
  (`users.read/manage`, `purchases.create/approve`, etc.), contrôlées **côté
  serveur** sur chaque route.
- **Séparation des tâches à quatre yeux** fondée sur l'identité de l'auteur :
  `SELF_APPROVAL` 403 sur DA, BC, révisions de BC, factures, avoirs, paiements
  (SEP-001/002) ; l'attribution d'un devis exige un responsable distinct de
  l'acheteur (AUTO_ATTRIBUTION) ; un contrat ne peut pas être approuvé par son
  créateur (AUTO_APPROBATION_CONTRAT).
- Le rôle `admin` pur **n'accède pas** aux fonctions métier sensibles sans
  rôles métier explicites (DEF-S-02 corrigé : `p2p/awards`, `p2p/sourcing`).
- Le visa des **prix spéciaux** exige le rôle `director` distinct (doctrine §4) ;
  une modification tarifaire révoque le visa ; décisions historisées.

## Protection des données

- Aucune divulgation de prix, coûts, avoirs, agrégats MAD ou données clients à
  un rôle non habilité, **y compris par JSON imbriqué, endpoint de liste,
  exports ou messages d'erreur** — vérifié par la matrice API (421 requêtes,
  0 fuite, `tests/audit-api-matrix.cjs`).
- Compte démo partagé : lecture sans données nominatives.
- Validation des entrées par Zod/DTO sur les routes sensibles ; messages
  d'erreur contractuels sans divulgation d'internalités.

## Durcissement HTTP (`next.config.ts` + `src/proxy.ts`)

- `X-Powered-By` supprimé (DEF-S-11).
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  `X-Permitted-Cross-Domain-Policies: none`.
- **CSP avec nonce par requête** (`script-src 'self' 'nonce-…'
  'strict-dynamic'`, sans `unsafe-inline`) appliquée dans `src/proxy.ts`.
- HSTS activé uniquement si `GOCMD_PUBLIC_ORIGIN` est HTTPS (jamais en
  recette HTTP/LAN).

## Intégrité de la base

- SQLite : journal `DELETE` (WAL refusé), `busy_timeout=5000`, `foreign_keys=ON`, vérifiés de façon
  déterministe (DEF-S-05).
- `prisma db push` **refusé** par le garde `scripts/refuse-unsafe-schema-change.cjs`
  (DEF-S-01) : les migrations passent par les scripts SQL officiels contrôlés.
- Transactions atomiques pour toutes les écritures multi-tables ; crash testé
  (SIGKILL pendant 20 écritures : 0 écriture partielle, intégrité ok).

## Journalisation et audit

- Événements d'audit en base (connexions, décisions d'approbation,
  attributions, visas tarifaires, changements de droits) — 461 événements
  générés et contrôlés pendant la simulation six mois.
- Mise à jour du 09/11 : les **échecs de connexion** et le déclenchement du
  seuil de verrouillage sont consignés dans `GoCmdAccessAudit` (`session.login.failed`).
  Aucun mot de passe, cookie ni adresse réseau n'est enregistré ; un identifiant
  inconnu est anonymisé. Le journal est best-effort : une indisponibilité de la
  base ne doit pas faciliter ni bloquer artificiellement l'authentification.
  **Résiduel :** rétention, purge et supervision des journaux à configurer sur site,
  limitation IP à mettre en place au reverse proxy, protection contre saturation.
- `npm run start` et `npm run start:checked` utilisent le démarrage contrôlé.
  L'archive contient `db/custom.db` pour les tests, **pas pour la production**.
  Démarrer la démo incluse exige `GOCMD_ALLOW_DEMO_DB=1` et une écoute locale.
  Le contrôle local ne remplace pas la sécurisation d'une installation Windows.


## Obligations de déploiement (hors code — à la charge de SODEPI)

1. TLS + reverse proxy (limitation par IP, en-têtes transport).
2. Sauvegardes chiffrées testées (voir RUNBOOK.md).
3. Comptes individuels, pas de partage de compte démo en production.
4. Conformité fiscale marocaine et loi 09-08/CNDP : professionnels habilités.

## Protection des documents historiques (optionnelle)

`upgrade_history_delete_guards_p51523.py` ajoute sur demande et **après sauvegarde externe** des triggers empêchant les suppressions physiques de documents/ligne et mouvements historiques, même sur des relations dont le schéma Prisma conserve `onDelete: Cascade`. Les opérations métier utilisent annulation/avoirs, non DELETE. **Cette protection doit être activée explicitement sur la base choisie** ; elle n’est pas présente automatiquement dans la base démo, pour permettre sa remise à zéro. Voir `INTEGRITE_HISTORIQUE_P51523.md`.

### Journaux et factures — contrôle 09/11/2026

- `src/lib/safe-server-error.ts` expose uniquement des types d'erreur reconnus et des codes Prisma/SQLite bornés. Les messages, traces et objets ORM potentiellement sensibles ne sont pas écrits dans les logs des routes API examinées.
- `scripts/upgrade_invoice_immutability_p51523.py` pose six triggers couvrant les montants/en-têtes et modifications/suppressions des lignes existantes. Les mises à jour de statut/version pour paiements et avoirs restent autorisées.
- `scripts/verify_operational_guards_p51523.py` est exécuté avant `start:checked` : 19 triggers historiques et six triggers de facture obligatoires.
- Les factures sont créées avant insertion imbriquée de leurs lignes : les triggers ne bloquent **pas** les nouvelles insertions de lignes dans une facture existante. Ce contrôle additionnel relève des routes métiers et du contrôle d'intégrité ; les permissions SQL directes sur la base doivent rester limitées à l'application.
