# Plan de clôture GoCmd R13.3 — après intégration des corrections Qwen

## Urgent : requalification de cette archive exacte sur Node 24

1. Extraire le ZIP complet dans un dossier **neuf** et calculer son SHA-256.
2. Exécuter `npm ci`, `npx prisma generate`, `npm run test:types`, `npm run lint`, `npm run build`.
3. Exécuter `npm run test:qwen:targeted` ; refaire le tri/filtre des consultations via API HTTP authentifiée sur base synthétique de 200 / 2 000 / 20 000 consultations.
4. Rejouer matrice RBAC et anti-fuites, CORR-01 anticorruption, C4/C5/C7, `test:http:all`, D-GEN-01, Playwright et backup/restauration sur bases jetables.
5. Benchmark p50/p95/p99 avant/après P2P et liste commandes **sur les mêmes données et la même machine**, 10/20/50 utilisateurs ; profiler la réponse serveur (SQL/hydratation/JSON/CPU/RSS). **Ne pas inférer les performances HTTP à partir du SQL seul.**
6. Contre-auditer le **ZIP final après modifications**, sans le réécrire après les preuves ; enregistrer SHA et journaux exit-code.

## P0 avant production SODEPI

- **Base vierge** : créer une baseline de schéma SQLite complète, versionnée, depuis les migrations fiables (pas le catalogue DEMO), installer toutes les gardes de conservation/immutabilité, contrôler `start:checked`, FK/PRAGMA et bootstrap administrateur. Ne pas délivrer de base production par simple copie/renommage de DEMO. Le présent correctif ne prétend pas résoudre cela.
- **Windows sur site** : Node 24, service unique/verrou inter-processus, disque interne, NTFS, journal DELETE, redémarrage/arrêt forcé, pare-feu et PV.
- **Réseau** : HTTPS privé/Tailscale Serve uniquement si validé, cookie Secure, révocation appareil, tests LAN/tablettes, pas de Funnel public.
- **Continuité** : sauvegardes cohérentes chiffrées hors serveur, restauration externe chronométrée, objectifs RPO/RTO approuvés.
- **Maroc** : validation comptable et juridique TVA, mentions facture, ICE/IF/RC, loi 09-08/CNDP, règles de rétention.

## P1 / P2 / P3

- **P1-P2P** : confirmer le nouveau tri par données réelles et benchmark HTTP ; si p95 50 utilisateurs reste > 1 500 ms, analyser hydratation Prisma et comptages avant toute mise en cache (jamais cacher une décision financière ou un droit).
- **P1-LIST** : corriger les agrégats globaux à chaque page après preuve de profilage ; mesure initiale 1 687 ms à 50 utilisateurs / 20 000 commandes.
- **P1-GEN-DIV** : arbitrage écrit direction/catalogue/qualité pour garder la suspension ou étendre V16, puis nouvelle recette et AMDEC.
- **P2-AUTH/503** : trois campagnes HTTP représentatives en écriture/connexion concurrente ; 401 réel conservé, 503 sur incident SQLite, aucun rejeu automatique ambigu, zéro double paiement/réservation.
- **P2-AUDIT** : ancrer les maillons du scellement hors serveur avec contrôle à quatre yeux.
- **P3-DOC** : documentation du mode DELETE/10 rôles corrigée ; autres historiques à mettre à jour progressivement.

**Critères d'arrêt :** corruption SQLite, double paiement, double réservation, OF créé avant validation, contournement RBAC/quatre yeux, DEMO en production, exposition réseau publique ou rapportant un test non exécuté comme PASS.
