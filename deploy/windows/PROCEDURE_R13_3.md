# Procédure d'exploitation GoCmd R13.3 — serveur Windows SODEPI

**Statut : candidat à la recette sur site (EXTERNAL VALIDATION).** Ce document
complète `README.md` (installation service WinSW) avec la procédure pas-à-pas
vérifiable exigée par la mission R13.3 §8.2. Toute commande PowerShell est
à exécuter telle quelle puis à valider par la sortie indiquée.

L'architecture cible est volontairement simple : un PC Windows dédié, **une
seule instance applicative** (verrou d'inter-processus `gocmd-instance-lock`),
base SQLite locale sur disque interne (jamais SMB ni réseau), navigateur sur
les postes et tablettes du réseau local, accès distant privé Tailscale si
validé (voir `deploy/network/`).

## 1. Préparer Windows

```powershell
# Compte administrateur pour l'installation, puis compte de service non administrateur.
whoami                                # doit répondre <domaine>\<admin>
Get-ComputerInfo | Select WindowsProductName, OsVersion, CsProcessors

# Dossiers d'exploitation (disque interne, jamais un partage réseau)
$dirs = 'C:\GoCmd','C:\GoCmd\app','C:\GoCmd\data','C:\GoCmd\backups','C:\GoCmd\logs'
New-Item -ItemType Directory -Force -Path $dirs | Out-Null

# Pare-feu : seul le port GoCmd en ENTREE, réseau local uniquement
New-NetFirewallRule -DisplayName 'GoCmd HTTP local' -Direction Inbound `
  -LocalPort 3000 -Protocol TCP -RemoteAddress LocalSubnet -Action Allow
Get-NetFirewallRule -DisplayName 'GoCmd HTTP local'    # doit afficher Enabled=True

# IP stable (à adapter à la plage SODEPI, réservation DHCP recommandée)
Get-NetIPAddress -AddressFamily IPv4 | Select InterfaceAlias, IPAddress
# Réserver l'adresse dans le DHCP de la box/routeur SODEPI (procédure côté routeur).
```

## 2. Installer Node.js 24 et Python

```powershell
# Télécharger Node.js 24 LTS (msi) depuis https://nodejs.org puis :
msiexec /i node-v24.x.x-x64.msi /qn
RefreshEnv.cmd 2>$null; [Environment]::SetEnvironmentVariable('Path',
  $env:Path + ';C:\Program Files\nodejs', 'Machine')
node --version     # doit afficher v24.x
python --version   # doit afficher 3.12.x (installé au préalable, coché "PATH")
```

Python est requis par les contrôles de démarrage vérifiés (schéma, sauvegardes)
et par les scripts d'exploitation.

## 3. Déployer GoCmd R13.3

```powershell
# AVANT l'extraction, vérifier l'empreinte du ZIP téléchargé :
# Remplacer le chemin ci-dessous par l'emplacement réel de l'archive reçue.
$ArchiveReçue = 'C:\CHEMIN_A_ADAPTER\GoCmd_SODEPI_R13_3_PROJET_NETTOYE_ORGANISE.zip'
if (-not (Test-Path $ArchiveReçue)) {
  throw 'Archive introuvable : indiquer le chemin du ZIP reçu avant de continuer.'
}
Get-FileHash -Path $ArchiveReçue -Algorithm SHA256
# Comparer avec GOCMD_R13_3_NETTOYAGE_SHA256SUMS.txt fourni séparément.
# Extraire ensuite l'archive, puis copier son dossier racine :
Copy-Item -Recurse -Force .\GoCmd_SODEPI_R13_3\* C:\GoCmd\app\
cd C:\GoCmd\app

npm ci --no-audit --no-fund        # exit 0, aucune erreur
npx prisma generate                # exit 0
npm run build                      # exit 0 — build de production Next.js
```

## 4. Préparer la base de production

**ARRÊT — PRÉREQUIS DE PRODUCTION NON ENCORE LIVRÉ :** `db/production-blank.db`
mentionné dans l'ancienne édition **n'existe pas dans le projet**. La base
`db/custom.db` fournie est exclusivement **DEMO fictive** ; il est interdit de
l'installer en production ou de la renommer en base réelle.

Avant cette étape, l'architecte / responsable informatique SODEPI doit fournir
une **procédure qualifiée de création d'une base de production vierge**,
compatible avec les migrations et triggers actuels, validée sur copie isolée.
Effectuer les contrôles ci-dessous **uniquement après** production d'une base
vierge officiellement validée, et non sur la DEMO :

```powershell
# STOP ici tant que le chemin de base vide approuvée n'est pas disponible.
$BaseViergeApprouvee = 'C:\GoCmd\installation\production-blank-VALIDEE.db'
if (-not (Test-Path $BaseViergeApprouvee)) {
  throw 'Base de production vierge non qualifiée : installation arrêtée.'
}
Copy-Item $BaseViergeApprouvee 'C:\GoCmd\data\gocmd.db'
python .\scripts\check_sqlite_schema_p5157.py --db C:\GoCmd\data\gocmd.db
python .\scripts\verify_sqlite_runtime.py --db C:\GoCmd\data\gocmd.db
python .\scripts\verify_operational_guards_p51523.py --db C:\GoCmd\data\gocmd.db
# Exiger exit 0 de chaque contrôle et un PV de mise en service.
```

## 5. Comptes et secrets

```powershell
# Compte principal (bootstrap nominatif, hors service) :
$env:GOCMD_DB_FILE = 'C:\GoCmd\data\gocmd.db'
node .\scripts\bootstrap-admin.cjs <identifiant> <mot_de_passe_32_caracteres>
node .\scripts\create-user.cjs <identifiant_admin> <commercial1> <mdp> sales
# ... répéter create-user pour chaque employé (rôles: sales, approver, buyer,
#     receiver, inventory, quality, finance, director, production)
```

Les secrets ne sont JAMAIS stockés en clair dans des scripts partagés :
mots de passe saisis à l'installation, stockés scrypt+sel dans la base ;
sessions révocables en base (cookie `gocmd_session` HttpOnly 8 h).

Variables d'environnement du service (posées par `gocmd-service.xml` /
l'installateur) : `GOCMD_DB_FILE=C:\GoCmd\data\gocmd.db`, `NODE_ENV=production`,
`HOSTNAME=127.0.0.1`, `PORT=3000`, `GOCMD_PUBLIC_ORIGIN=http://<ip-serveur>:3000`
(ou l'URL HTTPS Tailscale si déployé). Le starter vérifié force
`GOCMD_SERVER_RUNTIME=1` (moteur SQLite unique — correctif R13.3 CORR-01).

## 6. Démarrer et vérifier le service

L'installation définitive passe par `installer-service.ps1` (WinSW, LocalService,
tâches sauvegarde/santé). Vérifications manuelles d'abord :

```powershell
$env:GOCMD_DB_FILE = 'C:\GoCmd\data\gocmd.db'
node .\scripts\start-gocmd-checked.cjs     # écoute sur 127.0.0.1:3000
# Dans une seconde console :
Invoke-WebRequest http://127.0.0.1:3000/api/me -UseBasicParsing
# StatusCode 401 attendu (authentification requise) = service vivant
Get-Content C:\GoCmd\data\gocmd.db.gocmd-instance.lock   # PID du service actif
```

Puis installation service :

```powershell
.\deploy\windows\installer-service.ps1 -InstallDir C:\GoCmd -DbFile C:\GoCmd\data\gocmd.db -VaultDir D:\GoCmdVault
Start-Service GoCmd ; Get-Service GoCmd        # Status: Running
Get-ScheduledTask -TaskName 'GoCmd-Sauvegarde','GoCmd-Sante'   # Ready
```

## 7. Arrêt, redémarrage, journaux

```powershell
Stop-Service GoCmd          # arrêt propre (SIGTERM → libération du verrou)
Start-Service GoCmd
Get-Content C:\GoCmd\logs\gocmd-service.wrapper.log -Tail 50
Get-Content C:\GoCmd\logs\gocmd-service.out.log -Tail 50

# Le verrou d'instance DOIT disparaître à l'arrêt :
Test-Path C:\GoCmd\data\gocmd.db.gocmd-instance.lock    # False après arrêt propre

# Après un arrêt brutal (coupure), le verrou obsolète est repris automatiquement
# au démarrage suivant (PID mort détecté) ; si le fichier .reclaim subsiste,
# INTERVENTION MANUELLE exigée (voir §9 du README).
```

## 8. Contrôle depuis un poste client

Sur un poste du réseau SODEPI : ouvrir `http://<ip-serveur>:3000`, connexion
avec un compte nominatif, vérifier la liste des commandes, un détail, une
création en environnement de recette locale. Les tablettes Wi-Fi utilisent le
même navigateur — aucune installation, aucun accès direct au fichier SQLite.

## 9. Points de contrôle R13.3 spécifiques

- **Verrou d'instance** : une seconde tentative de démarrage (manuel ou service)
  doit être REFUSÉE avec « Autre service GoCmd actif sur cette base ».
- **Moteur unique** : R13.3 interdit les écritures identités via node:sqlite
  dans le serveur (`GOCMD_SERVER_RUNTIME=1`, lecture seule stricte) — le
  journal ne doit contenir aucun « Écriture identités interdite en mode
  serveur » (ce serait une régression d'intégration).
- **Sauvegardes** : `.\deploy\windows\executer-sauvegarde.ps1` puis vérifier
  le ZIP le plus récent dans `C:\GoCmd\backups` (régression 56 générations).

## 10. Recette de réception sur le matériel réel (à exécuter sur site)

1. Refaire les contrôles 1 à 8 ci-dessus sur le serveur Windows cible.
2. Exécuter le harnais de benchmark de recette (livré dans le dossier de
   preuves) sur une COPIE locale de la base de production :
   conditions, p95 cibles et interprétation documentées dans le rapport de
   qualification R13.3 (§ dimensionnement).
3. Simuler une coupure brutale (arrêt VM/onglet alimentation) pendant une
   écriture, redémarrer, contrôler `PRAGMA integrity_check` et l'absence de
   doublon de référence.
4. Faire valider la procédure de restauration complète par SODEPI
   (`restore_gocmd_complete.py` vers un répertoire neuf, redémarrage, contrôle).
