# GoCmd R13.3 — risques résiduels après campagne de reprise

**Référence principale :** `PLAN_RESTANT_R13_3.md` (source des mesures et critères d'acceptation). Ce document remplace l'ancienne synthèse CASCADE4-R1 devenue obsolète. Un **GO technique conditionnel** ne constitue pas un GO production.

| Code | Priorité de traitement | Risque ouvert | Preuve / limite actuelle |
|---|---|---|---|
| PERF-P2P | P1 | Tri urgence des consultations fournisseurs sous forte charge | p95 5 080 ms à 50 utilisateurs / 20 000 commandes, sandbox 2 vCPU ; requête SQL à profiler |
| PERF-LIST | P1 | Liste commandes au-dessus du seuil de recette proposé | p95 1 687 ms, seuil 1 500 ms ; rerun sur serveur Windows réel |
| GEN-DIV | P1, décision métier | Gabarit DIVERS suspendu avec HTTP 400 | Taxonomie V16 n'autorise pas la famille DIVERS ; arbitrage SODEPI demandé |
| AUTH-401 | P2 (à requalifier selon fréquence) | 401 isolé sous forte contention | Un 401 sur 600 créations à 2 000 commandes / 50 utilisateurs ; investigation ciblée ultérieure sans reproduction |
| SQLITE-503 | P2 (surveillance) | 503 techniques possibles sous saturation | Journal DELETE et sérialisation imposés ; pas de retry aveugle sur écriture ambiguë |
| WIN-DEPLOY | Bloquant GO production | Service Windows, firewall, IP, Tailscale/HTTPS non réceptionnés | Aucun PV sur serveur SODEPI disponible |
| BACKUP | Bloquant GO production | Sauvegardes planifiées hors serveur, restauration opérationnelle sur site | Backup/restauration logique réussi en sandbox, pas sur système cible |
| PROD-DB | Bloquant installation | Procédure évoque `db/production-blank.db` absent de l'archive | Base vierge et migrations de production à faire qualifier avant déploiement |
| FIN-LEGAL | Bloquant exploitation réelle | TVA, obligations marocaines, facturation et confidentialité | Validation professionnelle SODEPI nécessaire |

**Mesure de maîtrise du risque de corruption SQLite :** CORR-01 et verrou mono-instance sont présents et testés dans les journaux Z.ai, mais aucune homologation de production ne peut s'en déduire sans recette sur le matériel cible. Ne pas utiliser R13.2.
