<#
  Actualizează Bombe și Petarde pe VPS, de pe Windows:
  rulează local testele, typecheck-ul și build-ul de producție; pune server/dist/index.js și client/dist
  într-o singură arhivă .tar.gz; o copiază cu scp; pe server o despachetează într-o versiune nouă și comută
  atomic pe ea (versiunea anterioară rămâne ca current.prev); repornește serviciul bombe și verifică
  /health pe server și public. Dacă health check-ul pică, revine automat la versiunea anterioară.
  Nu conține parole sau chei.
  Exemple:
    .\deploy\push.ps1                                       # alias "oracle" din ~/.ssh/config (utilizator, cheie, port de acolo)
    .\deploy\push.ps1 -Server 203.0.113.10 -Key <cheie>     # fără alias: cheia dată explicit (utilizator implicit: ubuntu)
    .\deploy\push.ps1 -WhatIf                               # testele, build-ul și arhiva local + comenzile care s-ar rula; serverul nu e atins
    .\deploy\push.ps1 -Rollback                             # revine la versiunea anterioară, fără build
  (Instalarea inițială se face cu deploy/setup.sh, vezi deploy/README.md.)
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Server = 'oracle',
  [string]$User = '',
  [string]$Key = '',
  [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$publicHealth = 'https://bombe-petarde.duckdns.org/colyseus/health'
$remoteDir = '/tmp/bombe-push'
$work = Join-Path $env:TEMP 'bombe-push'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'   # bsdtar din Windows 10+

if ($Key -and -not (Test-Path $Key)) { throw "Nu găsesc cheia $Key" }
if ($Key -and -not $User) { $User = 'ubuntu' }   # ca la tren, când cheia se dă explicit
$target = if ($User) { "$User@$Server" } else { $Server }
$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new')
if ($Key) { $sshOpts = @('-i', $Key) + $sshOpts }

function Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

# Rulează o comandă externă și se oprește dacă iese cu cod nenul. Doar codul de ieșire contează:
# Vite, npm și ssh scriu și mesaje normale pe stderr, pe care PowerShell 5.1 le-ar trata ca erori.
function Invoke-Checked([string]$What, [scriptblock]$Command) {
  $ErrorActionPreference = 'Continue'
  & $Command
  if ($LASTEXITCODE) { throw "$What a eșuat (cod $LASTEXITCODE)" }
}

function Test-PublicHealth {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  for ($i = 1; $i -le 10; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $publicHealth -UseBasicParsing -TimeoutSec 5
      if ($res.StatusCode -eq 200 -and $res.Content -match '"ok"\s*:\s*true') {
        Write-Host $res.Content
        return $true
      }
    } catch {
      Write-Host "   încercarea $i/10: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

Push-Location $root
try {
  $dirty = @(git status --porcelain 2>$null)
  if ($dirty.Count -gt 0) {
    Write-Warning "Ai modificări necomise ($($dirty.Count) fișiere); se publică exact ce e acum pe disc."
  }

  # Scriptul rulat de bash pe server: fără CRLF (git pe Windows îl poate scoate cu CRLF).
  New-Item -ItemType Directory -Force -Path $work -WhatIf:$false | Out-Null
  $remoteScript = Join-Path $work 'remote-update.sh'
  $script = (Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'remote-update.sh')) -replace "`r", ''
  [IO.File]::WriteAllText($remoteScript, $script, (New-Object Text.UTF8Encoding $false))
  $upload = @($remoteScript)
  $mode = if ($Rollback) { 'rollback' } else { 'deploy' }

  if (-not $Rollback) {
    Step 'Teste'
    Invoke-Checked 'npm test' { npm.cmd test }
    Step 'Typecheck'
    Invoke-Checked 'npm run typecheck' { npm.cmd run typecheck }
    Step 'Build de producție'
    Invoke-Checked 'npm run build' { npm.cmd run build }

    Step 'Arhivez server/dist/index.js și client/dist'
    $stage = Join-Path $work 'release'
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage -WhatIf:$false }
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'server') -WhatIf:$false | Out-Null
    Copy-Item 'server\dist\index.js' (Join-Path $stage 'server\index.js') -WhatIf:$false
    Copy-Item 'client\dist' (Join-Path $stage 'client') -Recurse -WhatIf:$false
    $version = "$(git rev-parse --short HEAD)$(if ($dirty.Count -gt 0) { '-dirty' }) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    [IO.File]::WriteAllText((Join-Path $stage 'VERSION'), "$version`n", (New-Object Text.UTF8Encoding $false))
    $archive = Join-Path $work 'release.tar.gz'
    Invoke-Checked 'tar' { & $tar -czf $archive -C $stage . }
    $upload += $archive
    Write-Host ("   {0} ({1:N2} MB), versiunea {2}" -f $archive, ((Get-Item $archive).Length / 1MB), $version)
  }

  $prepare = "rm -rf $remoteDir && mkdir -p $remoteDir"
  $run = "bash $remoteDir/remote-update.sh $mode"
  $cleanup = "rm -rf $remoteDir"
  $action = if ($Rollback) { 'revin la versiunea anterioară a bombe' } else { "public versiunea $version și repornesc bombe" }
  if (-not $PSCmdlet.ShouldProcess($target, $action)) {
    Write-Host "ssh $($sshOpts -join ' ') $target `"$prepare`""
    Write-Host "scp $($sshOpts -join ' ') $($upload -join ' ') ${target}:$remoteDir/"
    Write-Host "ssh $($sshOpts -join ' ') $target `"$run`""
    Write-Host "verific $publicHealth$(if (-not $Rollback) { ' (dacă pică: rollback automat)' })"
    Write-Host "ssh $($sshOpts -join ' ') $target `"$cleanup`""
    return
  }

  Step "Copiez pe $target"
  Invoke-Checked 'ssh' { ssh @sshOpts $target $prepare }
  Invoke-Checked 'scp' { scp @sshOpts @upload "${target}:$remoteDir/" }

  Step $(if ($Rollback) { 'Revin la versiunea anterioară' } else { 'Instalez și repornesc serviciul' })
  $ErrorActionPreference = 'Continue'   # de aici, doar codurile de ieșire ale ssh decid
  & ssh @sshOpts $target $run
  $code = $LASTEXITCODE
  if ($code -eq 3) { throw 'Serverul nu a pornit sănătos; a revenit automat la versiunea anterioară. Vezi: ssh oracle journalctl -u bombe -n 50' }
  if ($code) { throw "Actualizarea pe server a eșuat (cod $code). Vezi: ssh oracle journalctl -u bombe -n 50" }

  Step "Verific $publicHealth"
  if (-not (Test-PublicHealth)) {
    if ($Rollback) { throw 'Health check-ul public pică și după rollback: verifică Caddy și DNS-ul.' }
    Write-Warning 'Health check-ul public a eșuat: revin la versiunea anterioară.'
    & ssh @sshOpts $target "bash $remoteDir/remote-update.sh rollback"
    & ssh @sshOpts $target $cleanup
    throw 'Am revenit la versiunea anterioară. Dacă e primul deploy, verifică DNS-ul, porturile 80/443 și Caddy.'
  }
  & ssh @sshOpts $target $cleanup
  Step 'Gata.'
} finally {
  Pop-Location
}
