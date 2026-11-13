---
name: gocmd-rbac-confidentialite-owasp
description: "Contrôler sessions nominatives, RBAC, accès HTTP, DTO récursifs, CSP, CSRF, exports et fuites inter-rôles."
---

# Skill — gocmd-rbac-confidentialite-owasp

## Quand utiliser
Contrôler sessions nominatives, RBAC, accès HTTP, DTO récursifs, CSP, CSRF, exports et fuites inter-rôles.

## Contexte et règle de priorité
Lire d'abord `fsnw/POLITIQUE_SODEPI_ACTUELLE.md`, puis les sources historiques pertinentes sous `fsnw/sources/`. **La politique actuelle prévaut sur les anciens prompts**. Travailler uniquement sur la version figée et une base de recette isolée. Ne pas déclarer testée une action non exécutée.

## Mission
Démontrer qu'un utilisateur non habilité ne lit ni données financières ni données nominatives, y compris par chemins indirects. Les tentatives intrusives requièrent un environnement isolé et une autorisation explicite.

## Procédure obligatoire
1. Inventorier toutes les routes `src/app/api/**/route.ts`, leurs méthodes et leurs protections en amont ; refuser de conclure « 100% protégées » par simple comptage de `accessGate`.
2. Exécuter une matrice GET/POST/PATCH/DELETE pour les rôles sales, receiver, inventory, quality, buyer, approver, finance, director, admin et compte démo.
3. Tester `dashboard`, `goods-receipts`, `supplier-returns`, `quality-inspections`, `p2p/sourcing`, `suppliers`, `supplier-orders`, `clients`, `orders`, exports comptables ; inspecter récursivement le JSON, les erreurs et imbrications.
4. Vérifier prix d'achat, `averageCost`, `amount`, `creditAllocations`, `invoicedCents`, `creditCoverageCents`, agrégats MAD, notes sensibles, coordonnées, noms clients ; distinguer rôles pouvant voir montants et rôles opérationnels.
5. Refuser la lecture des clients/commandes au compte démo et aux comptes hors droit ; vérifier `Cache-Control: private, no-store`, `Vary: Authorization` quand pertinent.
6. Tester les permissions séparées `director` (prix spécial), `approver` (commande) et vérification des quatre yeux.
7. Examiner CSP appliquée et nonce Next.js, CSRF, origine/proxy, absence de contournement par Basic Auth hérité, rate-limit externe, secrets dans logs, règles OWASP ASVS selon périmètre.
8. Rejouer la tâche autorisée avec le même compte après filtrage pour prévenir les régressions UX/API.

## Vérifications et critères d'acceptation
Interdiction de scanner ou d'attaquer un hôte public sans autorisation. Seules les preuves HTTP sur environnement autorisé et les revues de code fondent les constats ; un header CSP ne prouve pas l'absence de XSS.

## Livrables attendus
`preuves/SEC_roles.csv`, requêtes/réponses expurgées, rapport fuites P1/P2, recommandations reverse proxy et conformité ASVS à confirmer.

## Remise au skill orchestrateur
Signaler les P0/P1 en priorité ; transmettre preuves, version SHA, statuts (`Conforme`, `Partiel`, `Non conforme`, `Non testé`, `Non applicable avec justification`) et limites. Les rapports anciens ne sont **jamais** une preuve de conformité actuelle.

## Extension V18.9.13 — utilisateurs persistants
Contrôler le bootstrap unique en transaction, la priorité exclusive des comptes `GoCmdUser` sur `GOCMD_USERS_JSON`, la désactivation immédiate du compte partagé, le cumul des rôles, les refus de permissions par action, l'impossibilité d'attribuer `director` sans droit supérieur, le journal d'audit sans secrets, l'obligation de changer les mots de passe initiaux, et l'absence de perte des données métier lors du déploiement additif. Rejouer les tests HTTP depuis une base *copiée* ; vérifier le contrôle à quatre yeux quand l'auteur cumule `buyer` et `approver`.

## Règles V18.9.13-p3 (authentification)

- Les comptes SQLite utilisent un formulaire `/login`, une session aléatoire en cookie HttpOnly/SameSite=Lax, stockée sous empreinte SHA-256 côté SQLite ; la déconnexion `/api/auth/logout` révoque immédiatement le jeton.
- Ne jamais réactiver Basic Auth pour un compte SQLite : des identifiants conservés par le navigateur ne doivent pas contourner la déconnexion.
- L’administrateur principal doit être `admin` uniquement ; admin seul ne peut lire ou modifier aucun module métier, ni approuver un prix spécial (rôle explicite director).
- Les comptes multi-rôles restent autorisés ; contrôle à quatre yeux, moindre privilège et journalisation obligatoires.
- Contrôler la migration idempotente des comptes déjà bootstrappés (sauvegarde préalable), la révocation des sessions après changement de droits/mot de passe/désactivation, l’expiration, les protections CSRF, HTTPS, et les essais HTTP réels.

## Actualisation CASCADE4-R1 — permissions individuelles et DTO
- Pour chaque route : distinguer **rôle** et **permission individuellement révoquée**. Un magasinier ayant `inventory` avec `stock.read` refusée ne doit pas accéder à `/api/stock-lots` ni `/api/movements`. Un directeur dont `director.prices` est retirée ne peut plus valider les prix sur aucun circuit.
- Tester les comptes multi-rôles créateur + approbateur ; les quatre yeux sont liés à l'identité, pas seulement aux rôles. Conserver un compte autorisé distinct pour les cas positifs.
- Inspecter les réponses récursives/exports pour les champs techniques internes d'idempotence (`createRequestKey`, `createRequestDigest`, `customerOrderNoNormalized`) et pour les identités/motifs qualité qui n'ont pas vocation à être divulgués.
- Un test de confidentialité doit **obtenir une réponse métier valide** avant d'inspecter le DTO ; un 409 accepté comme PASS peut masquer l'absence de vérification.
- Confirmation ordinaire par session nominative ; une réauthentification individuelle pour les actions sensibles, sans clé partagée `GOCMD_VALIDATION_KEY`.
