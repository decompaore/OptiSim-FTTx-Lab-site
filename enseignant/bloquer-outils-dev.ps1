# =====================================================================
# OptiSim FTTx Lab — blocage des outils de développement sur les postes élèves
# Auteur : Hassami COMPAORE · decompaore@gmail.com · Tél. / WhatsApp : +226 79 00 03 04
#
# Pourquoi : un sujet d'examen contient forcément les pannes à simuler. Avec les
# outils de développement du navigateur (F12), un élève averti peut les lire,
# ou fabriquer une copie. Ce script les désactive par les stratégies officielles
# des navigateurs (registre HKLM\SOFTWARE\Policies) :
#   Chrome  : DeveloperToolsAvailability = 2 ; URLBlocklist « javascript://* »
#   Edge    : DeveloperToolsAvailability = 2 ; URLBlocklist « javascript://* »
#   Firefox : DisableDeveloperTools = 1
# Le réglage vaut pour TOUS les comptes du poste : à réserver aux postes de la
# salle des élèves. Dans un domaine, préférer une stratégie de groupe appliquée
# au seul groupe des élèves (modèles d'administration Chrome / Edge / Firefox :
# « Contrôler où les outils de développement peuvent être utilisés »).
#
# À lancer dans PowerShell ouvert en administrateur, sur chaque poste élève :
#   .\bloquer-outils-dev.ps1 -Simulation     (affiche les actions, ne modifie rien)
#   .\bloquer-outils-dev.ps1                 (applique)
#   .\bloquer-outils-dev.ps1 -Annuler        (retire les réglages posés par ce script)
# Vérification : redémarrer le navigateur, ouvrir chrome://policy ou edge://policy
# (about:policies dans Firefox) ; F12 ne doit plus rien ouvrir.
# =====================================================================
param(
  [switch]$Annuler,
  [switch]$Simulation
)
$ErrorActionPreference = 'Stop'
function Etape([string]$texte, [scriptblock]$action) {
  if ($Simulation) { Write-Host "[simulation] $texte" -ForegroundColor Cyan }
  else { Write-Host $texte; & $action }
}
if (-not $Simulation) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Write-Host 'Lancez PowerShell en administrateur (ou ajoutez -Simulation pour vérifier).' -ForegroundColor Red; exit 1 }
}

$BLOCAGE = 'javascript://*'   # adresses javascript: tapées dans la barre d'adresse (favoris-scripts)
$navigateurs = @(
  @{ Nom = 'Google Chrome';   Cle = 'HKLM:\SOFTWARE\Policies\Google\Chrome';    Valeur = 'DeveloperToolsAvailability'; Donnee = 2; Liste = $true },
  @{ Nom = 'Microsoft Edge';  Cle = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge';   Valeur = 'DeveloperToolsAvailability'; Donnee = 2; Liste = $true },
  @{ Nom = 'Mozilla Firefox'; Cle = 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox';  Valeur = 'DisableDeveloperTools';      Donnee = 1; Liste = $false }
)

foreach ($n in $navigateurs) {
  $cle = $n.Cle; $liste = "$cle\URLBlocklist"
  if ($Annuler) {
    Etape "$($n.Nom) : retrait de $($n.Valeur)" {
      if (Test-Path $cle) { Remove-ItemProperty -Path $cle -Name $n.Valeur -ErrorAction SilentlyContinue }
    }
    if ($n.Liste) {
      Etape "$($n.Nom) : retrait de « $BLOCAGE » de URLBlocklist" {
        if (Test-Path $liste) {
          $p = Get-ItemProperty -Path $liste
          $p.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' -and $_.Value -eq $BLOCAGE } | ForEach-Object { Remove-ItemProperty -Path $liste -Name $_.Name }
        }
      }
    }
    continue
  }
  Etape "$($n.Nom) : $($n.Valeur) = $($n.Donnee)" {
    if (-not (Test-Path $cle)) { New-Item -Path $cle -Force | Out-Null }
    New-ItemProperty -Path $cle -Name $n.Valeur -Value $n.Donnee -PropertyType DWord -Force | Out-Null
  }
  if ($n.Liste) {
    Etape "$($n.Nom) : URLBlocklist += « $BLOCAGE » (entrées existantes conservées)" {
      if (-not (Test-Path $liste)) { New-Item -Path $liste -Force | Out-Null }
      $p = Get-ItemProperty -Path $liste
      $entrees = @($p.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' })
      if (-not ($entrees | Where-Object { $_.Value -eq $BLOCAGE })) {
        $suivant = 1; if ($entrees.Count) { $suivant = ([int[]]($entrees | ForEach-Object { $_.Name }) | Measure-Object -Maximum).Maximum + 1 }
        New-ItemProperty -Path $liste -Name ([string]$suivant) -Value $BLOCAGE -PropertyType String -Force | Out-Null
      }
    }
  }
}

Write-Host ''
if ($Simulation) { Write-Host 'Simulation terminée : relancez sans -Simulation pour appliquer.' -ForegroundColor Cyan }
elseif ($Annuler) { Write-Host 'Réglages retirés. Redémarrez les navigateurs.' -ForegroundColor Green }
else { Write-Host 'Outils de développement bloqués. Redémarrez les navigateurs, puis vérifiez avec un compte élève : F12 ne doit rien ouvrir.' -ForegroundColor Green }
