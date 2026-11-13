# Autoriser un état ARRÊT SÉCURISÉ seulement par un marqueur posé par un administrateur.
param(
 [string]$InstallDir = 'C:\GoCmd',
 [ValidateSet('Enable','Disable')][string]$Action = 'Enable',
 [string]$Reason,
 [ValidateRange(5,120)][int]$DurationMinutes=30
)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Droits administrateur requis'}
$marker=Join-Path $InstallDir 'service\maintenance\arret-controle.json'
if($Action -eq 'Disable'){
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  Write-Host 'Marqueur de maintenance supprimé.'
  exit 0
}
if([string]::IsNullOrWhiteSpace($Reason) -or $Reason.Trim().Length -lt 10){throw 'Motif de maintenance de 10 caractères minimum requis'}
$now=(Get-Date).ToUniversalTime()
$record=@{actor=[Security.Principal.WindowsIdentity]::GetCurrent().Name;createdUtc=$now.ToString('o');expiresUtc=$now.AddMinutes($DurationMinutes).ToString('o');reason=$Reason.Trim()}
$dir=Split-Path $marker -Parent
if(-not (Test-Path $dir)){throw 'Répertoire de maintenance protégé absent : installer le service d’abord'}
$temp=Join-Path $dir ('arret-'+[guid]::NewGuid().ToString('N')+'.tmp')
try { $record | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8 -NoNewline; Move-Item -LiteralPath $temp -Destination $marker -Force }
finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
Write-Host "Maintenance tracée par $($record.actor), autorisée jusqu'à $($record.expiresUtc)."
