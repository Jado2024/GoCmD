# PLAN DE CLÔTURE — GoCmd / SODEPI R13.3 REPRISE

**Date : 13 novembre 2026** · **Statut : qualification technique conditionnelle / NO-GO production** · Base : le ZIP R13.3 REPRISE vérifié, le rapport de contre-audit Z.ai et son AMDEC. Les chiffres suivants sont issus des journaux fournis par Z.ai ; ce nettoyage ne constitue pas une réexécution des benchmarks sous Node 24.

## 0. Décisions fermes et périmètre gelé

- **Version unique à poursuivre : R13.3 REPRISE (nettoyée)**, ne pas repartir des archives R10-R13.2 ; R13.2 a présenté une corruption SQLite avérée.
- **Ne jamais** modifier ni réinitialiser des données de production. `db/custom.db` est strictement fictive ; créer des copies isolées pour les tests.
- Préserver : achats DA → consultations → offres écrites/téléphoniques → BC → réceptions/qualité → stock → facture/paiement ; ventes → validation indépendante → OF après validation → réservation/livraison/facturation ; articles à la fois achetables/stockables/vendables ; aucune nomenclature/MRP GoProd automatique.
- **Aucun changement UX esthétique** dans cette clôture. Seul le traitement d'un dysfonctionnement fonctionnel explicitement démontré est autorisé.
- Conserver le moteur Prisma écrivain unique, `node:sqlite` lecture seule en runtime serveur, journal SQLite DELETE, sérialisation des écritures et verrou inter-processus, sauf preuve contraire et décision d'architecture formelle.

## 1. Plan d'action priorisé, mesurable et attribuable

| ID / priorité | Action à exécuter | Livrable / critère de clôture | Responsable proposé |
|---|---|---|---|
| **P1-P2P** | Profiler `/api/p2p/consultations` et son tri par urgence (`EXPLAIN QUERY PLAN`, plans, `ORDER BY`, filtres, agrégations, pagination). Corriger seulement le goulot démontré. | Jeu de 20 000 commandes et consultations réellement peuplées ; p50/p95/p99, CPU/RSS, codes HTTP avant/après **même charge** ; viser p95 ≤ 1 500 ms en forte charge si matériel/protocole comparables, ou documenter explicitement l'écart. Actuellement **5 080 ms à 50 utilisateurs**. | Développeur backend + auditeur performance |
| **P1-LIST** | Reprofiler liste commandes sous 20 000 commandes à 20/50 utilisateurs ; examiner requêtes, pagination et saturation CPU. | Mesures sur machine calme puis serveur Windows cible ; critère provisoire p95 ≤ 1 500 ms sous forte charge, actuellement **1 687 ms** sur 2 vCPU ; seuil non atteint déclaré FAIL tant qu'il n'est pas atteint. | Backend + exploitation |
| **P1-GEN** | Arbitrer GEN-DIV : gabarit suspendu définitivement ou extension documentée de la taxonomie V16 avec attributs obligatoires. | Décision métier écrite par SODEPI, matrice de codification, test HTTP, contrôle intégrité/trigger ; pas de contournement V16. GEN-MAT et GEN-MOU déjà corrigés. | Direction + responsable catalogue / qualité |
| **P2-AUTH** | Reproduire/qualifier le 401 observé à 50 utilisateurs sur une session pourtant valide ; distinguer expiration vraie, concurrence de sessions, lecture sous contention. | Harnais avec identité/session tracées, ≥ 3 exécutions représentatives, tableau 200/401/503/409, zéro 401 injustifié ou cause et mitigation acceptées. 1/600 observé à 2 000 commandes / 50 utilisateurs. | Sécurité + backend |
| **P2-503** | Contrôler 503, `Retry-After`, issues incertaines, déduplication paiements/commandes/réservations, pas de retry automatique non sûr. | Régression C4/C5/C7, audit RBAC, traces SQL, aucune double écriture ni 409 masquant une erreur d'infrastructure. | Backend + QA |
| **P0-OPS-DB** | Formaliser le **provisionnement d'une base de production vierge**. Le fichier `db/production-blank.db` mentionné dans l'ancienne procédure Windows n'est pas livré. | Méthode approuvée et TESTÉE sur base neuve isolée, vérification migrations/schéma/contraintes, aucune copie de la DEMO ; procédure Windows amendée. **BLOQUANT installation**. | DBA / architecte + SODEPI |
| **P0-OPS-WIN** | Recette réelle du serveur Windows : Node 24, service mono-instance, compte non-admin, NTFS, disque interne SSD, règles pare-feu, reboot, SIGKILL/kill process, coupure réseau. | PV de recette Windows avec screenshots/logs/codes de retour et test qu'une seconde instance ne peut écrire ; ports non exposés publiquement. | Exploitant SODEPI |
| **P0-OPS-NET** | Déploiement HTTPS privé (Tailscale Serve si validé), révocation appareil/utilisateur, contrôle d'origine, cookies Secure, tests tablette Wi-Fi et LAN. | Tests HTTPS réels sur site, accès refusé depuis appareil non autorisé ; pas de Funnel / exposition publique. | Responsable IT SODEPI |
| **P0-OPS-BCP** | Planifier sauvegarde SQLite cohérente, stockage séparé, rotation, contrôle d'exécution et restauration sur machine isolée ; fixer RPO/RTO. | Sauvegarde restaurée hors machine, intégrité SQL/FK, contrôle restauration et PV ; éviter copie naïve d'un fichier ouvert. | Exploitation + direction |
| **P0-LEGAL** | Valider TVA, factures, mentions, ICE/IF/RC, exigences légales marocaines et traitement des données personnelles. | Avis / signature des personnes compétentes ; aucune conformité déclarée par simple test logiciel. | Comptable et responsable conformité SODEPI |
| **P0-FINAL** | Contre-audit de la prochaine archive applicative finale réellement modifiée, sur extraction neuve Node 24. | `npm ci`, Prisma, tsc, lint, build, HTTP métier, permissions RBAC, CORR-01 anticorruption, D-GEN-01, verrouillage, C4/C5/C7, Playwright, sauvegarde/restauration ; journaux des vrais exit codes et SHA du ZIP final. | Auditeur indépendant |

## 2. Séquence d'exécution recommandée (DMAIC/PDCA)

**Phase A — DÉFINIR/MESURER :** figer les trois bases de recette 200/2 000/20 000 et leurs hash, confirmer les seuils de charge, mesurer avant sur le code R13.3 en état initial, produire `EXPLAIN QUERY PLAN` pour les consultations et la liste. Priorité P1-P2P, puis P1-LIST.

**Phase B — ANALYSER/CORRIGER :** localiser les SQL/agrégations dominantes, corriger minimalement, contrôler l'équivalence fonctionnelle (tri, confidentialité RBAC, pagination), puis comparer avant/après sur mêmes bases et matériel. Aucun maquillage par suppression de scénarios de charge.

**Phase C — SÉCURITÉ/RÉSILIENCE :** investiguer 401, faire tests de 503 et d'idempotence, préserver CORR-01, rejouer C4/C5/C7 et les tests de création/validation à quatre yeux. Aucun risque de double paiement ni corruption accepté.

**Phase D — DÉCISIONS SODEPI :** arbitrage GEN-DIV et revue réglementaire ; décisions écrites avant de créer ou étendre des familles d'articles.

**Phase E — PRÉPARER WINDOWS :** corriger le prérequis de base vierge, tester la procédure Windows sur serveur cible, sauvegardes/restauration réelles, accès LAN/tablettes et HTTPS/Tailscale privé. Adopter les mesures de performance sur matériel cible (pas extrapoler le sandbox 2 vCPU).

**Phase F — CONTRÔLER/HOMOLOGUER :** construire un ZIP de code distinct uniquement si des fichiers ont réellement changé ; sceller ses empreintes, extraire à neuf, refaire les tests nécessaires, compléter l'AMDEC et le procès-verbal. GO production seulement après validation des étapes Windows et conformité externe.

## 3. Critères d'arrêt immédiat / NO-GO

- Nouvelle corruption SQLite, `integrity_check != ok`, FK violées, perte de données, double paiement, double réservation, OF créé avant approbation, contournement RBAC/quatre yeux.
- Seconde instance écrivant dans la même base en contournant le verrou, installation proposée avec base de démonstration comme production, SQLite sur partage réseau.
- Déploiement public sans décision explicite, sauvegardes non restaurables, test non exécuté déclaré PASS.

## 4. Mesures actuellement connues (référentiel R13.3 fourni)

| Scénario | Données et charge | Mesure | Verdict selon seuil provisoire |
|---|---|---|---|
| Commandes paginées | 20 000, 10 utilisateurs | p95 **417 ms** | PASS (≤ 800 ms nominal) |
| Commandes paginées | 20 000, 50 utilisateurs | p95 **1 687 ms** | **FAIL** (> 1 500 ms forte charge) |
| Consultations achats, tri urgence | 20 000, 50 utilisateurs | p95 **5 080 ms** | Ralentissement majeur ouvert |
| Création commande | 20 000, 50 utilisateurs | p95 **797 ms**, 600 créations 201 | PASS dans ce scénario |
| Dashboard | 20 000, 50 utilisateurs | p95 **1 458 ms** | Amélioration importante, à recetter sur Windows |
| Authentification | 2 000, 50 utilisateurs en écritures | **1 HTTP 401 / 600** créations | Investigation ouverte |

Le rapport Z.ai donne des résultats plus complets. **Ne pas présenter ces chiffres comme des mesures du serveur Windows ni comme exécutés de nouveau pendant le nettoyage.**

## 5. Livrables attendus de la prochaine campagne Z.ai

1. Projet corrigé seulement si une anomalie justifie un changement de code ; sinon conserver R13.3.
2. Correctif autonome et manifeste SHA-256 seulement si changements applicatifs.
3. Dossier DMAIC/PDCA/AMDEC, benchmarks avant/après, profils SQL, investigations 401/503, non-régression, preuve d'intégrité.
4. Kit d'installation Windows réellement testable, procédure de base production vierge approuvée, sauvegarde/restauration et procès-verbal de recette.
5. Verdict détaillé GO technique/GO conditionnel/NO-GO avec BLOCKED et EXTERNAL VALIDATION explicitement distingués.

**Point de départ Z.ai :** cette archive nettoyée, `README.md`, `AGENTS.md`, `ORGANISATION_PROJET.md` et le présent plan. Ne pas reprendre les anciens ZIP dispersés.
