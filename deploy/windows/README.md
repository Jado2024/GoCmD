# Addendum P6U-P2FIX (2026-11-11) — à lire en priorité

Les sections historiques P3/P6U ci-dessous servent de contexte. **La procédure
active est `installer-service.ps1` P6U-P2FIX.** Ce kit n'a pas été exécuté sur
le serveur Windows réel ; il est candidat à la recette de déploiement.

## Installation obligatoire

1. Installer Node.js 24+ et Python accessibles au compte `NT AUTHORITY\LocalService`.
2. Installer et configurer le reverse proxy HTTPS, le pare-feu et le stockage
   documentaire `D:\GoCmdVault\documents-prives` ; vérifier le chiffrement du
   volume de sauvegarde ainsi que ses ACL.
3. Préparer une **base de production distincte** de `db/custom.db` et un compte
   administrateur GoCmd nominatif. Ne pas déployer la base démo.
4. Déposer `gocmd-service.exe` (WinSW v3) sous `C:\GoCmd\service`, ainsi que
   `gocmd-service.xml` si nécessaire. L'installateur sait copier le modèle.
5. Dans PowerShell **administrateur** :

```powershell
.\installer-service.ps1 -InstallDir C:\GoCmd -DbFile C:\GoCmd\data\gocmd.db -VaultDir D:\GoCmdVault
```

En l'absence d'un contrôle BitLocker exploitable, l'option
`-EncryptionVerifiedByAdministrator` requiert une preuve séparée et signée de
chiffrement du stockage ; elle ne chiffre PAS les sauvegardes.

**Échecs bloquants :** droits administrateur absents, Node trop ancien, stockage
absent/non chiffré (sans constat explicite), SQLite non intègre, WinSW absent,
identité du service différente de LocalService, tâches non installées, première
sauvegarde planifiée non réussie ou archive récente absente. Le service ne doit
PAS démarrer après un tel échec. Ne pas relancer en supprimant les contrôles.

L'installateur pose les ACL, installe WinSW sous LocalService, crée une tâche
`GoCmd-Sauvegarde` avec 4 déclencheurs quotidiens (00 h, 06 h, 12 h, 18 h)
et `GoCmd-Sante` (07 h 45), puis déclenche et contrôle une première sauvegarde
avant démarrage du service. La sauvegarde inclut base et PDF privés, puis
vérifie le ZIP avec `--verify-only`. L'horloge est celle du serveur.

## Maintenance planifiée et pannes

**Un service arrêté n'est PAS une maintenance par défaut.** Toute interruption
inattendue est `INTERVENTION REQUISE`, même si la base est intègre. Pour une
maintenance intentionnelle, un administrateur doit d'abord déclarer :

```powershell
.\maintenance-controlee.ps1 -InstallDir C:\GoCmd -Action Enable -Reason 'Intervention planifiée serveur GoCmd' -DurationMinutes 30
Stop-Service GoCmd
# ... maintenance autorisée, vérifier les backups et le statut ...
Start-Service GoCmd
.\maintenance-controlee.ps1 -InstallDir C:\GoCmd -Action Disable
```

Le marqueur est horodaté, attribué au compte Windows administrateur, limité à
120 min et stocké sous ACL administrateurs/SYSTEM. Sans marqueur valide,
`verifier-sante.ps1` signale l'arrêt comme critique. L'absence d'une base saine
ou d'une sauvegarde récente demeure critique même en maintenance.

## Ce qui reste à réceptionner chez SODEPI

- Test WinSW et Planificateur de tâches **sur Windows réel**, y compris identité
  effective et permission de lecture de la base / PDF par LocalService.
- **Chiffrement** du volume contenant les archives ; export vers **un support
  distinct du serveur** (NAS ou disque chiffré à rotation), avec contrôle de
  récupération sur une autre machine. Le ZIP applicatif est NON chiffré.
- Copie indépendante des clés/seaux de scellement HMAC (Direction).
- Limitation de l'accès direct à Next.js et à la base (pare-feu/ACL).
- Reprise après coupure, test RPO/RTO réellement mesurés, impression et tablettes.
- Un compte LocalService est non privilégié mais partagé avec d'autres services
  Windows. Une isolation dédiée (compte de service distinct ou gMSA) nécessite
  une procédure spécifique et une recette de droits avant déploiement.

---

# Déploiement Windows SODEPI — GoCmd P5.15.29-P3

> **Statut : procédure prête, NON TESTÉE sur le serveur réel SODEPI.**
> La recette sur site (§14 du cahier des charges) reste obligatoire avant mise en production.
> Aucun de ces fichiers ne touche une base GoCmd : ils préparent le service et les contrôles.

## Objectif d'autonomie (cahier des charges §6)

GoCmd doit fonctionner quotidiennement sans intervention du développeur :
démarrage automatique, contrôles intégrés au démarrage, supervision locale,
sauvegardes planifiées. Les validations métier (prix, achats, production,
paiements) conservent leurs contrôles humains — l'automatisation informatique
n'est PAS une autorisation métier automatique.

## Arborescence cible recommandée

```
C:\GoCmd\
  gocmd\              application (ZIP 1 du dossier d'homologation, node_modules inclus)
  data\gocmd.db       BASE DE PRODUCTION (distincte de db/custom.db de démonstration)
  service\            gocmd-service.exe (WinSW), gocmd-service.xml, logs\
  sauvegardes\        transit local UNIQUEMENT (l'archive finale va sur le stockage externe)
D:\GoCmdVault\        disque/volume INDÉPENDANT, hors C:, sauvegardes chiffrées
  documents-prives\   justificatifs fournisseurs (GOCMD_DOCUMENTS_DIR)
  sauvegardes\        archives gocmd_full_*.zip (copie hors du serveur recommandée)
```

## 1. Prérequis (à vérifier sur site)

- Windows Server (2019/2022), Node.js **24 LTS** installé « pour Tous les utilisateurs ».
- Python 3.12+ disponible pour les scripts de maintenance (vérification, sauvegarde).
- Reverse proxy HTTPS (IIS/Caddy/nginx) → `http://127.0.0.1:3000` avec :
  certificat interne SODEPI, limitation de débit par IP, **aucun accès direct au port 3000** depuis le réseau.
- `GOCMD_PUBLIC_ORIGIN=https://gocmd.sodepi.local` (nom réel à adapter).
- Wi-Fi/tablettes : SSID dédié atelier, pare-feu bloquant le réseau invité vers le serveur.

## 2. Installation du service (Administrateur)

```powershell
cd C:\GoCmd\service
.\installer-service.ps1 -InstallDir C:\GoCmd -DbFile C:\GoCmd\data\gocmd.db
```

Le script : prépare les répertoires, applique les ACL minimales au compte de
service `svc-gocmd`, exécute `verify_sqlite_runtime.py --db <chemin>` (échec = installation
stopée), puis installe et démarre le service via WinSW
(`gocmd-service.xml` : démarrage automatique différé, redémarrage 30 s / 2 min
puis arrêt maîtrisé, journaux roulants).

Le service lance `scripts/start-gocmd-checked.cjs`, qui refusera de démarrer si :
base absente, journal ≠ DELETE, intégrité HS, gardes d'historique manquantes,
base démo détectée sans `GOCMD_ALLOW_DEMO_DB`. **Un échec de contrôle n'est
jamais contourné : le service s'arrête et l'alerte est dans les journaux.**

## 3. Sauvegardes planifiées (Planificateur de tâches, 4×/jour)

Tâche « GoCmd-Sauvegarde » sous le compte de service à 00h00, 06h00, 12h00 et 18h00.
La cible RPO ≤12h reste à valider : vérifier les échecs, le déport hors serveur
et le scénario de restauration sur le matériel cible :

```bat
python C:\GoCmd\gocmd\scripts\backup_gocmd_complete.py --source C:\GoCmd\data\gocmd.db --documents-dir D:\GoCmdVault\documents-prives --output-dir D:\GoCmdVault\sauvegardes --retention 56
```

Rétention de 56 archives (14 jours à 4/jour) gérée par le script. Le ZIP n'est PAS chiffré :
BitLocker/volume chiffré obligatoire sur D:, et copie quotidienne vers un
stockage hors serveur (NAS/USB rotation). Vérification hebdomadaire :

```bat
python C:\GoCmd\gocmd\scripts\restore_gocmd_complete.py --archive <dernier zip> --verify-only
```

La restauration réelle (poste de secours) doit être testée au moins
trimestriellement : `restore_gocmd_complete.py --archive <zip> --target-dir <NOUVEAU répertoire>`
puis démarrage sur ce répertoire — jamais sur la base active.

## 4. Supervision quotidienne

```powershell
C:\GoCmd\service\verifier-sante.ps1
```

Contrôle : disponibilité HTTP locale, état du service, espace disque,
`verify_sqlite_runtime.py` (intégrité + journal DELETE), fraîcheur de la
sauvegarde (alerte à 12 h), redémarrages système inattendus. Toute alerte est
journalisée dans `service\logs\sante-*.log` à transmettre au responsable
informatique. Planifier l'exécution quotidienne (07h45) via le Planificateur.

## 5. Scénarios réseau à recetter sur site (§7 — non reproductibles hors site)

| # | Scénario | Attente |
|---|----------|---------|
| 1 | Coupure Internet, LAN OK | Application 100 % opérationnelle (aucune dépendance cloud) |
| 2 | Coupure Wi-Fi pendant une validation | Soit l'opération aboutit, soit message clair ; jamais de double création (garde refs uniques + updateMany conditionnel) |
| 3 | Redémarrage serveur | Service redémarre (auto différé), base intacte (journal DELETE) |
| 4 | Reconnexion tablette | Session 8 h max, reconnexion par écran de login nominatif |
| 5 | Double clic « Enregistrer » | Une seule création (refs uniques serveur), second appel → 409 explicite |
| 6 | Session expirée pendant une modification | 401 « Session expirée : reconnectez-vous », aucune écriture partielle |
| 7 | Impression interrompue | Aucun impact données (impression = lecture) |
| 8 | Accès distant non autorisé | Pare-feu : seul le reverse proxy expose 443 ; port 3000 inaccessible hors localhost |
| 9 | Perte du stockage documentaire | Sauvegarde suivante ÉCHOUE explicitement (document manquant) → alerte, jamais de fausse réussite |
| 10 | Reprise après sauvegarde restaurée | Démarrer sur la base restaurée : comptes, commandes, documents conformes (cf. preuve de reprise du dossier d'audit) |

## 6. Ce qui reste à la charge de SODEPI (hors périmètre logiciel)

- Rotation et garde des secrets (`.env` protégé par ACL, jamais dans les ZIP).
- Sauvegarde du fichier `.env` / secrets dans le coffre séparé (le ZIP de
  sauvegarde ne contient volontairement AUCUN secret).
- Recette humaine des parcours métier par rôle (§9) avant bascule.
- Tests Wi-Fi/Ethernet/tablettes réels (matériel spécifique SODEPI).

## Contrôles supplémentaires P6U-P1FIX

- **Entrée unique** : démarrer uniquement le service WinSW / `npm start` (lanceur
  `start-gocmd-checked.cjs`). `next start` lancé manuellement n'acquiert pas
  le verrou. Restreindre par ACL et procédures l'accès aux secrets et au
  répertoire de production. Une seconde instance démarrée hors lanceur reste
  un risque résiduel nécessitant une recette sur site.
- **Node 24+** : l'installateur et le lanceur refusent une version antérieure.
- **TVA** : la variable `GOCMD_SALES_TAX_RATES_BPS` du XML est vide par défaut ;
  NE PAS activer de taux sans validation écrite du comptable.
- **Liveness** : `/api/health` renvoie 204 sans détails ; SQLite, sauvegardes et
  scellement sont contrôlés séparément par `verifier-sante.ps1`.
- **Contrôle de santé** : exécuter
  `verifier-sante.ps1 -InstallDir C:\GoCmd -DbFile C:\GoCmd\data\gocmd.db -VaultDir D:\GoCmdVault`.
- **Scellement** : garder la clé et une copie horodatée des maillons sur un
  support administré indépendamment. Après interruption entre création du
  maillon et écriture du pointeur, ne pas re-sceller automatiquement : figer
  les fichiers, comparer à la dernière ancre externe et appliquer la procédure
  de réconciliation sous contrôle à quatre yeux. Ne jamais supprimer un
  maillon pour faire passer une vérification.
