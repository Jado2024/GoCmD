# P6U-P2FIX — script lancé par GoCmd-Sauvegarde sous compte non privilégié.
param(
 [Parameter(Mandatory=$true)][string]$InstallDir,
 [Parameter(Mandatory=$true)][string]$DbFile,
 [Parameter(Mandatory=$true)][string]$VaultDir
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $InstallDir 'gocmd\scripts\backup_gocmd_complete.py'
$verify = Join-Path $InstallDir 'gocmd\scripts\restore_gocmd_complete.py'
$docs = Join-Path $VaultDir 'documents-prives'
$target = Join-Path $VaultDir 'sauvegardes'
if (-not (Test-Path -LiteralPath $DbFile -PathType Leaf) -or -not (Test-Path -LiteralPath $docs -PathType Container)) { throw 'Base ou documents privés indisponibles' }
# Un dossier de sauvegarde au repos doit être chiffré, ACL restreintes et
# répliqué hors serveur. La copie hors serveur est un prérequis d'exploitation.
& python $source --source $DbFile --documents-dir $docs --output-dir $target --retention 56
if ($LASTEXITCODE -ne 0) { throw 'Sauvegarde complète ÉCHOUÉE' }
$latest = Get-ChildItem -LiteralPath $target -Filter 'gocmd_full_*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest -or ((Get-Date)-$latest.LastWriteTime).TotalMinutes -gt 30) { throw 'Archive récente manquante' }
& python $verify --archive $latest.FullName --verify-only
if ($LASTEXITCODE -ne 0) { throw 'Vérification de la sauvegarde ÉCHOUÉE' }
Write-Host "Sauvegarde vérifiée : $($latest.Name)"
