# GoCmd P6 — Vérification de santé quotidienne (PowerShell)
# Chantier 4 §5.3 : états globaux compréhensibles pour l'exploitant SODEPI :
#   OPÉRATIONNEL        tout est nominal (code de sortie 0)
#   DÉGRADÉ             application utilisable mais alertes à suivre (1)
#   INTERVENTION REQUISE service ou données indisponibles/incertaines (2)
#   ARRÊT SÉCURISÉ      service volontairement arrêté, base vérifiée saine (3)
# À exécuter chaque matin par l'exploitant local (ou via Planificateur de
# tâches, puis transmettre le résultat au responsable informatique).
# Ne modifie AUCUNE donnée ; n'expose aucune donnée confidentielle (compteurs).
param(
  [string]$InstallDir = "C:\GoCmd",
  [string]$DbFile = "C:\GoCmd\data\gocmd.db",
  [string]$VaultDir = "D:\GoCmdVault"
)
$ErrorActionPreference = "Continue"
$log = Join-Path $InstallDir "service\logs\sante-$(Get-Date -Format yyyyMMdd).log"
New-Item -ItemType Directory -Force -Path (Split-Path $log -Parent) | Out-Null
$alerts = @()      # dégradations (application toujours utilisable)
$critical = @()    # interventions requises
$info = @()

function Check($nom, $ok, $detail, [switch]$IsCritical) {
  $etat = if ($ok) { "OK  " } else { "ALERTE" }
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$etat] $nom — $detail"
  $line | Tee-Object -FilePath $log -Append
  if (-not $ok) {
    if ($IsCritical) { $script:critical += $line } else { $script:alerts += $line }
  }
}

# L'arrêt sécurisé exige un marqueur TEMPORAIRE créé par un administrateur.
$markerPath = Join-Path $InstallDir 'service\maintenance\arret-controle.json'
$plannedMaintenance = $false
if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
  try {
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    $nowUtc = (Get-Date).ToUniversalTime()
    $since = ([datetime]$marker.createdUtc).ToUniversalTime()
    $until = ([datetime]$marker.expiresUtc).ToUniversalTime()
    $plannedMaintenance = ($marker.actor -and $marker.reason.Length -ge 10 -and $since -le $nowUtc -and $until -gt $nowUtc -and ($until - $since).TotalMinutes -le 120)
  } catch { $plannedMaintenance = $false }
}
# 2. État du service Windows : jamais ARRÊT SÉCURISÉ sans maintenance tracée.
$svc = Get-Service -Name "GoCmd" -ErrorAction SilentlyContinue
$serviceRunning = ($svc -and $svc.Status -eq "Running")
if ($serviceRunning) {
  Check "Service Windows" $true "statut = Running"
} elseif ($svc) {
  if ($plannedMaintenance) {
    $info += "Service arrêté pour maintenance tracée ($($marker.actor)) jusqu'à $($marker.expiresUtc)"
  } else {
    Check "Service Windows" $false "Arrêt INATTENDU, maintenance absente ou expirée (statut = $($svc.Status))" -IsCritical
  }
} else {
  Check "Service Windows" $false "service GoCmd introuvable (installation incomplète ?)" -IsCritical
}

# 1 bis. Vérification HTTP : arrêt contrôlé du service != panne HTTP.
if ($serviceRunning) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health" -UseBasicParsing -TimeoutSec 10
    Check "Application" ($r.StatusCode -eq 204) "HTTP $($r.StatusCode) (204 attendu)" -IsCritical
  } catch {
    Check "Application" $false "INJOIGNABLE : $($_.Exception.Message)" -IsCritical
  }
} else {
  $info += "HTTP non testé : service Windows à l'arrêt ; état qualifié après contrôle SQLite."
}

# 3. Espace disque : 20 Go = dégradé, 5 Go = intervention requise
foreach ($drive in @("C:", "D:")) {
  $d = Get-PSDrive $drive -ErrorAction SilentlyContinue
  if ($null -ne $d -and $d.Free) {
    $freeGB = [math]::Round($d.Free/1GB,1)
    if ($d.Free -lt 5GB) {
      Check "Disque $drive" $false "$freeGB Go libres (< 5 Go) : espace critique" -IsCritical
    } elseif ($d.Free -lt 20GB) {
      Check "Disque $drive" $false "$freeGB Go libres (< 20 Go) : prévoir un nettoyage"
    } else {
      Check "Disque $drive" $true "$freeGB Go libres"
    }
  }
}

# 4. État de la base (intégrité + journal DELETE, lecture seule) — CRITIQUE
$dbOk = $true
$py = Join-Path $InstallDir "gocmd\scripts\verify_sqlite_runtime.py"
if (Test-Path $py) {
  $env:GOCMD_DB_FILE = $DbFile
  $out = python $py --db $DbFile 2>&1 | Out-String
  $dbOk = ($LASTEXITCODE -eq 0)
  Check "Base SQLite" $dbOk $out.Trim() -IsCritical
} else {
  $dbOk = $false
  Check "Base SQLite" $false "Script de contrôle SQLite introuvable" -IsCritical
}

# 5. Sauvegardes complètes (stockage indépendant) : > 12 h = intervention requise
$bdir = Join-Path $VaultDir "sauvegardes"
$latest = Get-ChildItem -Path $bdir -Filter "gocmd_full_*.zip" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latest) {
  $ageH = ((Get-Date) - $latest.LastWriteTime).TotalHours
  if ($ageH -gt 12) {
    Check "Sauvegarde complète" $false "dernière archive il y a $([math]::Round($ageH,0)) h (> 12 h) : relancer la sauvegarde et vérifier la tâche planifiée" -IsCritical
  } elseif ($ageH -gt 8) {
    Check "Sauvegarde complète" $false "dernière archive il y a $([math]::Round($ageH,0)) h (> 8 h) : surveiller la tâche planifiée"
  } else {
    Check "Sauvegarde complète" $true "dernière : $($latest.Name) ($([math]::Round($latest.Length/1MB,1)) Mo, $(Get-Date $latest.LastWriteTime -Format 'dd/MM HH:mm'))"
  }
} else {
  Check "Sauvegarde complète" $false "AUCUNE archive dans $bdir : première sauvegarde à lancer" -IsCritical
}

# 6. Scellement d'audit : fraîcheur du dernier maillon (la clé reste hors
#    serveur ; la vérification HMAC nominative est faite par la direction).
$seal = Get-ChildItem -Path $bdir -Filter "gocmd-audit-seal-chain-*.json" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($seal) {
  $sealH = ((Get-Date) - $seal.LastWriteTime).TotalHours
  Check "Scellement audit" ($sealH -lt 25) "dernier maillon il y a $([math]::Round($sealH,0)) h (quotidien attendu ; vérification nominative par la direction)"
} else {
  $info += "Aucun maillon de scellement dans $bdir : mettre en place la procédure (RUNBOOK §supervision)."
}

# 7. Tentatives d'accès anormales (échecs de connexion 24 h, compteur seul)
$metricsPy = Join-Path $InstallDir "gocmd\scripts\health_metrics_p6.py"
if (Test-Path $metricsPy) {
  $m = python $metricsPy $DbFile 2>$null | Out-String | ConvertFrom-Json
  if (-not $m -or $null -eq $m.failedLogins24h) {
    Check "Accès" $false "Métriques d'accès indisponibles : vérifier le script et les ACL"
  } else {
    if ($m.failedLogins24h -ge 20) {
      Check "Accès" $false "$($m.failedLogins24h) connexions refusées en 24 h (>= 20) : vérifier les comptes concernés dans l'application"
    } else {
      Check "Accès" $true "$($m.failedLogins24h) connexion(s) refusée(s) en 24 h ; $($m.sensitiveFailed24h) confirmation(s) sensible(s) refusée(s)"
    }
    $info += "Activité applicative 24 h : $($m.auditEvents24h) événement(s) audités."
  }
}

# 8. Journaux récents du service (sans relire les journaux de santé produits par ce script).
# Les codes critiques SQLite sont émis sans message brut par l'application.
# Ne pas confondre une réponse 409 métier avec une corruption de base.
$svcLogs = @(Get-ChildItem -Path (Join-Path $InstallDir "service\logs") -Filter "*.log" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-1) -and $_.Name -notlike 'sante-*' })
$errCount = 0
$sqliteCritical = 0
$sqliteBusy = 0
foreach ($f in $svcLogs) {
  $sqliteCritical += @(Select-String -LiteralPath $f.FullName -Pattern 'GOCMD_SQLITE_(CORRUPTION_SUSPECTED|OUTCOME_UNCERTAIN|UNSAFE_WAL|FOREIGN_KEYS_OFF)' -ErrorAction SilentlyContinue).Count
  $sqliteBusy += @(Select-String -LiteralPath $f.FullName -Pattern 'GOCMD_SQLITE_(RETRY_EXHAUSTED|BUSY)' -ErrorAction SilentlyContinue).Count
  $errCount += @(Select-String -LiteralPath $f.FullName -Pattern 'Echec|Error:|Unhandled|FATAL' -ErrorAction SilentlyContinue |
    Where-Object { $_.Line -notmatch '409|403|401|400' }).Count
}
Check "Alertes SQLite critiques" ($sqliteCritical -eq 0) "$sqliteCritical signalement(s) de corruption ou résultat incertain sur 24 h" -IsCritical
Check "Conflits SQLite épuisés" ($sqliteBusy -lt 5) "$sqliteBusy signalement(s) sur 24 h (seuil de surveillance : 5)"
Check "Erreurs applicatives" ($errCount -lt 10) "$errCount erreur(s) technique(s) dans les journaux sur 24 h"

# 9. Les événements 1074 sont des redémarrages PLANIFIÉS : ils ne sont pas des coupures brutales.
$events = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008; StartTime=(Get-Date).AddDays(-1)} -ErrorAction SilentlyContinue)
Check "Redémarrages inattendus" ($events.Count -eq 0) "$($events.Count) événement(s) 41/6008 en 24 h"

# ── Qualification globale (mission P6 §5.3) ─────────────────────────────
Write-Host ""
foreach ($l in $info) { Write-Host "  (info) $l" -ForegroundColor DarkGray }
if ($critical.Count -gt 0) {
  foreach ($l in $critical) { Write-Host "  $l" -ForegroundColor Red }
  Write-Host "ÉTAT GOCMD : INTERVENTION REQUISE — ne pas utiliser l'application tant que les points rouges ne sont pas traités ; contacter le responsable informatique." -ForegroundColor Red
  exit 2
}
if (-not $serviceRunning -and $svc -and $dbOk -and $plannedMaintenance) {
  Write-Host "ÉTAT GOCMD : ARRÊT SÉCURISÉ — maintenance autorisée et horodatée, base vérifiée saine. Démarrer le service pour reprendre l'exploitation." -ForegroundColor Cyan
  exit 3
}
if ($alerts.Count -gt 0) {
  foreach ($l in $alerts) { Write-Host "  $l" -ForegroundColor Yellow }
  Write-Host "ÉTAT GOCMD : DÉGRADÉ — application utilisable ; traiter les alertes et transmettre $log au responsable informatique." -ForegroundColor Yellow
  exit 1
}
Write-Host "ÉTAT GOCMD : OPÉRATIONNEL — aucune alerte." -ForegroundColor Green
exit 0
