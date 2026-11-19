# =====================================================================
# OptiSim FTTx Lab — création du dossier partagé de la salle informatique
# Auteur : Hassami COMPAORE · decompaore@gmail.com · Tél. / WhatsApp : +226 79 00 03 04
#
# À lancer sur le serveur de fichiers (ou le poste qui partage le dossier),
# dans PowerShell ouvert en administrateur.
#
# Crée :
#   <Racine>\Application\              version élève           élèves : lecture
#   <Racine>\Sujets\<classe>\           sujets d'examen         élèves : lecture ; enseignants : modification
#   <Racine>\Copies\<classe>\           dépôt des copies        élèves : déposer et modifier SA copie, sans voir
#                                                               celles des autres ; enseignants : modification
#   <Racine>\Enseignant\                version protégée, corrigés, notes, archives
#                                                               élèves : AUCUN accès (dossier invisible)
# puis le partage réseau « OptiSim » avec l'énumération basée sur l'accès
# (chacun ne voit que les dossiers auxquels il a droit).
#
# Exemple (vérification sans rien modifier) :
#   .\creer-partage.ps1 -Racine D:\Partages\OptiSim -GroupeEleves "LYCEE\Eleves" `
#       -GroupeEnseignants "LYCEE\Enseignants" -Classes "1TEL-A","1TEL-B" `
#       -PaquetEleve .\OptiSim-FTTx-Lab-eleve -PaquetEnseignant .\OptiSim-FTTx-Lab-enseignant-protege -Simulation
# Puis la même commande sans -Simulation.
# =====================================================================
param(
  [Parameter(Mandatory = $true)][string]$Racine,
  [string]$NomPartage = 'OptiSim',
  [Parameter(Mandatory = $true)][string]$GroupeEleves,
  [Parameter(Mandatory = $true)][string]$GroupeEnseignants,
  [string[]]$Classes = @('Classe-1'),
  [string]$PaquetEleve,
  [string]$PaquetEnseignant,
  [switch]$Simulation
)
$ErrorActionPreference = 'Stop'
function Etape([string]$texte, [scriptblock]$action) {
  if ($Simulation) { Write-Host "[simulation] $texte" -ForegroundColor Cyan }
  else { Write-Host $texte; & $action }
}
function Icacls([string]$chemin, [string[]]$arguments) {
  Etape "icacls `"$chemin`" $($arguments -join ' ')" { & icacls.exe $chemin @arguments /Q | Out-Null; if ($LASTEXITCODE -ne 0) { throw "icacls a échoué sur $chemin" } }
}

if (-not $Simulation) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Write-Host 'Lancez PowerShell en administrateur (ou ajoutez -Simulation pour vérifier).' -ForegroundColor Red; exit 1 }
}
# Les groupes doivent exister (domaine ou groupes locaux)
foreach ($g in @($GroupeEleves, $GroupeEnseignants)) {
  try { [void](New-Object Security.Principal.NTAccount($g)).Translate([Security.Principal.SecurityIdentifier]) }
  catch { Write-Host "Groupe introuvable : $g (créez-le ou indiquez DOMAINE\Groupe)." -ForegroundColor Red; if (-not $Simulation) { exit 1 } }
}
# Classes : noms de dossiers sûrs
$Classes = $Classes | ForEach-Object { ($_ -replace '[\\/:*?"<>|]', '-').Trim() } | Where-Object { $_ }
if (-not $Classes) { Write-Host 'Indiquez au moins une classe (-Classes).' -ForegroundColor Red; exit 1 }

# Comptes par SID (indépendants de la langue de Windows)
$ADM = '*S-1-5-32-544'      # Administrateurs
$SYS = '*S-1-5-18'          # SYSTEM
$CRE = '*S-1-3-0'           # CREATEUR PROPRIETAIRE
$E = $GroupeEleves; $P = $GroupeEnseignants

# 1. Arborescence
$dossiers = @($Racine, "$Racine\Application", "$Racine\Sujets", "$Racine\Copies", "$Racine\Enseignant",
  "$Racine\Enseignant\Version-enseignant", "$Racine\Enseignant\Corriges", "$Racine\Enseignant\Notes", "$Racine\Enseignant\Archives")
$Classes | ForEach-Object { $dossiers += "$Racine\Sujets\$_"; $dossiers += "$Racine\Copies\$_" }
foreach ($d in $dossiers) { Etape "Dossier : $d" { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

# 2. Droits NTFS (héritage coupé à chaque niveau, droits explicites)
$base = @('/inheritance:r', '/grant:r', "${ADM}:(OI)(CI)F", "${SYS}:(OI)(CI)F")
Icacls $Racine ($base + @("${P}:RX", "${E}:RX"))                                            # racine : lister, sans hériter
Icacls "$Racine\Application" ($base + @("${P}:(OI)(CI)RX", "${E}:(OI)(CI)RX"))
Icacls "$Racine\Sujets" ($base + @("${P}:(OI)(CI)M", "${E}:(OI)(CI)RX"))
Icacls "$Racine\Copies" ($base + @("${P}:(OI)(CI)M", "${E}:RX"))                           # voir les dossiers de classe
foreach ($c in $Classes) {
  # Dépôt : l'élève crée sa copie (et la remplace), ne voit pas le contenu du dossier
  Icacls "$Racine\Copies\$c" ($base + @("${P}:(OI)(CI)M", "${E}:(WD,AD,X,RA,REA,RC)", "${CRE}:(OI)(CI)(IO)M"))
}
Icacls "$Racine\Enseignant" ($base + @("${P}:(OI)(CI)M"))                                   # aucun droit pour les élèves

# 3. Paquets
if ($PaquetEleve) {
  $ed = Join-Path $PaquetEleve 'edition.js'
  if (-not (Test-Path $ed) -or ((Get-Content $ed -Raw) -notmatch "role: 'eleve'")) { Write-Host "$PaquetEleve n'est pas le paquet ÉLÈVE : copie refusée." -ForegroundColor Red; exit 1 }
  Etape "Copie de la version élève dans $Racine\Application" {
    Get-ChildItem "$Racine\Application" -Force | Remove-Item -Recurse -Force
    Get-ChildItem $PaquetEleve -Force | Where-Object { $_.Name -notlike 'installer-eleve.*' } | Copy-Item -Destination "$Racine\Application" -Recurse -Force
  }
}
if ($PaquetEnseignant) {
  $ix = Join-Path $PaquetEnseignant 'index.html'
  if (-not (Test-Path $ix) -or ((Get-Content $ix -Raw) -notmatch 'accès enseignant')) { Write-Host "$PaquetEnseignant n'est pas la version enseignant PROTÉGÉE : copie refusée (ne déposez jamais la version non protégée sur un partage)." -ForegroundColor Red; exit 1 }
  Etape "Copie de la version enseignant protégée dans $Racine\Enseignant\Version-enseignant" {
    Get-ChildItem "$Racine\Enseignant\Version-enseignant" -Force | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $PaquetEnseignant '*') -Destination "$Racine\Enseignant\Version-enseignant" -Recurse -Force
  }
}

# 4. Partage réseau, avec énumération basée sur l'accès
$auth = (New-Object Security.Principal.SecurityIdentifier('S-1-5-11')).Translate([Security.Principal.NTAccount]).Value   # Utilisateurs authentifiés
$adms = (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate([Security.Principal.NTAccount]).Value
Etape "Partage \\$env:COMPUTERNAME\$NomPartage (droits de partage : modification pour les utilisateurs authentifiés, les droits NTFS ci-dessus s'appliquent)" {
  if (Get-SmbShare -Name $NomPartage -ErrorAction SilentlyContinue) { Set-SmbShare -Name $NomPartage -FolderEnumerationMode AccessBased -Force }
  else { New-SmbShare -Name $NomPartage -Path $Racine -FullAccess $adms -ChangeAccess $auth -FolderEnumerationMode AccessBased | Out-Null }
}

$unc = "\\$env:COMPUTERNAME\$NomPartage"
Write-Host ''
Write-Host 'Terminé.' -ForegroundColor Green
Write-Host "Raccourci des élèves (GPO, bureau)  : $unc\Application\index.html"
Write-Host "Dossier des sujets d'une classe      : $unc\Sujets\<classe>"
Write-Host "Dépôt des copies d'une classe        : $unc\Copies\<classe>"
Write-Host "Espace enseignant (invisible élèves) : $unc\Enseignant  (version protégée : Version-enseignant\index.html)"
Write-Host 'Vérifiez avec un compte élève : Enseignant ne doit pas apparaître, et Copies\<classe> doit paraître vide.'
