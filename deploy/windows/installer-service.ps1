# P6U-P2FIX — installation fail-closed du service et des tâches Windows SODEPI.
# Doit être exécuté par un administrateur Windows SUR LE SERVEUR CIBLE.
# Le service et les tâches utilisent NT AUTHORITY\LocalService (non administrateur).
# Ne jamais installer sur une base démo ou sans stockage de sauvegardes chiffré.
param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$DbFile,
  [string]$VaultDir = 'D:\GoCmdVault',
  [string]$ServiceAccount = 'NT AUTHORITY\LocalService',
  [switch]$EncryptionVerifiedByAdministrator
)
$ErrorActionPreference = 'Stop'
$serviceName = 'GoCmd'
$expectedAccount = 'NT AUTHORITY\LocalService'
if ($ServiceAccount -ine $expectedAccount) {
  throw 'Cet installateur ne gère que LocalService sans mot de passe. Pour un gMSA, établir une procédure dédiée et la tester sur site.'
}
$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Exécution PowerShell Administrateur obligatoire'
}
$root = Join-Path $InstallDir 'gocmd'
$dataDir = Split-Path $DbFile -Parent
$docs = Join-Path $VaultDir 'documents-prives'
$backupDir = Join-Path $VaultDir 'sauvegardes'
$serviceDir = Join-Path $InstallDir 'service'
$logs = Join-Path $serviceDir 'logs'
$maintenance = Join-Path $serviceDir 'maintenance'
$sourceScript = Join-Path $root 'scripts\start-gocmd-checked.cjs'
$pythonScript = Join-Path $root 'scripts\verify_sqlite_runtime.py'
$backupScript = Join-Path $root 'deploy\windows\executer-sauvegarde.ps1'
$healthScript = Join-Path $root 'deploy\windows\verifier-sante.ps1'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $node -p 'process.versions.node'
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 24) { throw "Node 24+ requis : $nodeVersion" }
foreach ($file in @($DbFile,$sourceScript,$pythonScript,$backupScript,$healthScript)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Pré-requis manquant : $file" }
}
if (-not (Test-Path -LiteralPath $VaultDir -PathType Container)) { throw "Volume de sauvegarde indépendant absent : $VaultDir" }
# Aucun consentement implicite au chiffrement. Contrôle BitLocker si disponible.
$volume = ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($VaultDir))).TrimEnd('\')
$encrypted = $false
if (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue) {
  try {
    $bl = Get-BitLockerVolume -MountPoint $volume -ErrorAction Stop
    $encrypted = ($bl.ProtectionStatus -eq 'On' -and $bl.VolumeStatus -eq 'FullyEncrypted')
  } catch { $encrypted = $false }
}
if (-not $encrypted -and -not $EncryptionVerifiedByAdministrator) {
  throw 'Chiffrement du volume non démontré. Vérifier BitLocker ou chiffrement du stockage et relancer explicitement -EncryptionVerifiedByAdministrator.'
}
if (-not $encrypted) { Write-Warning 'Chiffrement déclaré manuellement par administrateur : preuve externe et recette sur site obligatoires.' }
foreach ($folder in @($dataDir,$docs,$backupDir,$logs,$maintenance,$serviceDir)) {
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
# Procédure sûre : LocalService ne peut pas modifier le code et les marqueurs maintenance.
function Set-ProtectedAcl([string]$folder, [string]$serviceRights) {
  & icacls.exe $folder /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' "${ServiceAccount}:(OI)(CI)$serviceRights" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "ACL non appliquées : $folder" }
}
Set-ProtectedAcl $dataDir 'M'
Set-ProtectedAcl $docs 'M'
Set-ProtectedAcl $backupDir 'M'
Set-ProtectedAcl $logs 'M'
Set-ProtectedAcl $maintenance 'R'
Set-ProtectedAcl $serviceDir 'RX'
# Répertoire applicatif en lecture seule pour le service.
& icacls.exe $root /grant "${ServiceAccount}:(OI)(CI)RX" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ACL lecture du code non appliquées' }
# Les fichiers d'environnement peuvent contenir des secrets : interdire leur
# lecture aux groupes ordinaires (les scripts de démonstration restent hors prod).
$environmentFile = Join-Path $root '.env'
if (Test-Path -LiteralPath $environmentFile -PathType Leaf) {
  & icacls.exe $environmentFile /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' "${ServiceAccount}:R" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ACL fichier .env non vérifiées' }
}
& python $pythonScript --db $DbFile
if ($LASTEXITCODE -ne 0) { throw 'Contrôle SQLite refusé : installation interdite' }
$exe = Join-Path $serviceDir 'gocmd-service.exe'
$xmlPath = Join-Path $serviceDir 'gocmd-service.xml'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'WinSW gocmd-service.exe absent' }
if (-not (Test-Path -LiteralPath $xmlPath -PathType Leaf)) {
  Copy-Item (Join-Path $root 'deploy\windows\gocmd-service.xml') $xmlPath
}
[xml]$xml = Get-Content -LiteralPath $xmlPath
$xml.service.executable = $node
$xml.service.workingdirectory = $root
$xml.service.arguments = '"' + $sourceScript + '"'
$xml.service.SelectSingleNode("env[@name='GOCMD_DB_FILE']").SetAttribute('value',$DbFile)
$xml.service.SelectSingleNode("env[@name='GOCMD_DOCUMENTS_DIR']").SetAttribute('value',$docs)
$xml.Save($xmlPath)
# Pas de démarrage en LocalSystem : WinSW installe, on configure l'identité,
# on vérifie l'identité effective, ENSUITE seulement on démarre.
& $exe install
if ($LASTEXITCODE -ne 0) { throw 'Installation WinSW échouée' }
& sc.exe config $serviceName obj= $ServiceAccount password= ''
if ($LASTEXITCODE -ne 0) { throw 'Compte de service non configuré ; service NON démarré' }
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop
if (-not $service -or $service.StartName -ine $ServiceAccount) {
  throw "Identité du service incorrecte : $($service.StartName). Démarrage refusé."
}
# Quatre heures distinctes chaque jour, sous la même identité limitée.
$actionArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $backupScript + '" -InstallDir "' + $InstallDir + '" -DbFile "' + $DbFile + '" -VaultDir "' + $VaultDir + '"'
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '00:00'),
  (New-ScheduledTaskTrigger -Daily -At '06:00'),
  (New-ScheduledTaskTrigger -Daily -At '12:00'),
  (New-ScheduledTaskTrigger -Daily -At '18:00')
)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $ServiceAccount -LogonType ServiceAccount -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'GoCmd-Sauvegarde' -Action $backupAction -Trigger $triggers -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
$installed = Get-ScheduledTask -TaskName 'GoCmd-Sauvegarde' -ErrorAction Stop
if (@($installed.Triggers).Count -ne 4 -or $installed.Principal.UserId -ine $ServiceAccount) {
  throw 'Planification des sauvegardes incorrecte : service NON démarré'
}
# Contrôle de santé quotidien, même identité, sans droits administrateur.
$healthArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $healthScript + '" -InstallDir "' + $InstallDir + '" -DbFile "' + $DbFile + '" -VaultDir "' + $VaultDir + '"'
Register-ScheduledTask -TaskName 'GoCmd-Sante' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $healthArgs) -Trigger (New-ScheduledTaskTrigger -Daily -At '07:45') -Principal $taskPrincipal -Force | Out-Null
if (-not (Get-ScheduledTask -TaskName 'GoCmd-Sante' -ErrorAction Stop)) { throw 'Tâche de santé absente' }
# Première sauvegarde exécutée sous identité de tâche, à vérifier avant mise en production.
$firstBackupStart = Get-Date
Start-ScheduledTask -TaskName 'GoCmd-Sauvegarde' -ErrorAction Stop
$limit = (Get-Date).AddMinutes(10)
do {
  Start-Sleep -Seconds 3
  $task = Get-ScheduledTask -TaskName 'GoCmd-Sauvegarde' -ErrorAction Stop
  $taskInfo = Get-ScheduledTaskInfo -TaskName 'GoCmd-Sauvegarde' -ErrorAction Stop
  $firstFinished = ($task.State -ne 'Running' -and $taskInfo.LastRunTime -ge $firstBackupStart.AddMinutes(-1))
} while (-not $firstFinished -and (Get-Date) -lt $limit)
if (-not $firstFinished -or $taskInfo.LastTaskResult -ne 0) {
  throw "Première sauvegarde planifiée non démontrée : code $($taskInfo.LastTaskResult). Service NON démarré."
}
$firstArchive = Get-ChildItem -LiteralPath $backupDir -Filter 'gocmd_full_*.zip' | Where-Object { $_.LastWriteTime -ge $firstBackupStart.AddMinutes(-1) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $firstArchive) { throw 'La tâche a répondu succès sans archive récente : démarrage refusé' }
& $exe start
if ($LASTEXITCODE -ne 0) { throw 'Démarrage du service impossible' }
Write-Host 'Service installé sous LocalService ; sauvegardes et supervision planifiées.' -ForegroundColor Green
Write-Warning 'Recette Windows, droits, restauration sur machine distincte et sauvegarde hors serveur restent OBLIGATOIRES.'
