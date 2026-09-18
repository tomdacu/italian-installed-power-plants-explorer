# Release pipeline for Italian Capacity Explorer.
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1
#
# Options:
#   -Thumbprint <hex>   Code-signing certificate thumbprint (from certmgr.msc).
#                       When omitted the script looks for the environment
#                       variable TAURI_SIGNING_THUMBPRINT.
#   -TimestampUrl <url> RFC-3161 timestamp server (default: DigiCert).
#   -SkipTypecheck      Skip `npm run typecheck`.
#
# What it does:
#   1. typecheck + build the frontend
#   2. run `tauri build` (NSIS installer), signing the app executable and the
#      installer if a certificate thumbprint is provided
#   3. print the location of the produced installer

param(
  [string]$Thumbprint = $env:TAURI_SIGNING_THUMBPRINT,
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [switch]$SkipTypecheck
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  $appConfig = Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  $productName = $appConfig.productName
  $version = $appConfig.version

  Write-Host "== [0/4] Checking the backend sidecar ==" -ForegroundColor Cyan
  $sidecar = Join-Path $root "src-tauri\bin\app-backend\app-backend.exe"
  if (-not (Test-Path $sidecar)) {
    throw @"
Backend sidecar not found at $sidecar.
Build it first (see README → "Running the full desktop app"):
  cd backend
  python -B -m PyInstaller app-backend.spec --noconfirm --distpath dist --workpath build
  robocopy dist\app-backend ..\src-tauri\bin\app-backend /MIR
"@
  }

  Write-Host "== [1/4] Type-check & build frontend ==" -ForegroundColor Cyan
  if (-not $SkipTypecheck) {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
  } else {
    Write-Host "   typecheck skipped (-SkipTypecheck)"
  }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

  Write-Host "== [2/4] Building & bundling (tauri build) ==" -ForegroundColor Cyan
  if ($Thumbprint) {
    Write-Host "   code signing enabled (thumbprint $Thumbprint)"
    $env:TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT = $Thumbprint
    $env:TAURI_BUNDLE_WINDOWS_TIMESTAMP_URL = $TimestampUrl
  } else {
    Write-Warning "   no certificate thumbprint provided - the installer will be UNSIGNED"
    Write-Warning "   (users will see the Windows SmartScreen 'unknown publisher' warning)"
  }

  npx tauri build
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

  Write-Host "== [3/4] Packaging the portable build ==" -ForegroundColor Cyan
  $releaseDir = Join-Path $root "src-tauri\target\release"
  $staging = Join-Path $releaseDir "assets"
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  # Portable layout: app.exe plus the sidecar folder, zipped under a
  # space-free name (GitHub turns spaces into %20 in asset URLs).
  $portableDir = Join-Path $releaseDir "portable"
  Remove-Item $portableDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
  Copy-Item (Join-Path $releaseDir "app.exe") $portableDir
  Copy-Item (Join-Path $releaseDir "bin") $portableDir -Recurse
  $slug = $productName -replace "\s+", ""
  $portableZip = Join-Path $staging ("{0}_{1}_x64-portable.zip" -f $slug, $version)
  Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath $portableZip -CompressionLevel Optimal

  Write-Host "== [4/4] Artifacts ==" -ForegroundColor Cyan
  $bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
  # The bundle folder can still hold installers from earlier product names or
  # versions: take only what this build produced, and flag the leftovers so
  # nobody uploads the wrong file to a release.
  $installer = Get-ChildItem $bundleDir -Filter "*.exe" | Where-Object { $_.Name -like "$productName*" } | Select-Object -First 1
  if (-not $installer) { throw "no installer matching '$productName' found in $bundleDir" }
  $setup = Join-Path $staging ("{0}_{1}_x64-setup.exe" -f $slug, $version)
  Copy-Item $installer.FullName $setup

  foreach ($asset in @($setup, $portableZip)) {
    $hash = (Get-FileHash $asset -Algorithm SHA256).Hash
    Add-Content -Path (Join-Path $staging "SHA256SUMS.txt") -Value "$hash  $(Split-Path -Leaf $asset)"
    Write-Host "   $(Split-Path -Leaf $asset)"
    Write-Host "   $([math]::Round((Get-Item $asset).Length / 1MB, 1)) MB  SHA-256 $hash"
  }
  Write-Host "   $staging\SHA256SUMS.txt"

  $stale = Get-ChildItem $bundleDir -Filter "*.exe" | Where-Object { $_.Name -notlike "$productName*" }
  if ($stale) {
    Write-Warning "   stale installers in the same folder (not from this build - do not publish):"
    foreach ($old in $stale) { Write-Warning "     $($old.Name)" }
  }

  if (-not $Thumbprint) {
    Write-Host ""
    Write-Host "Next step for a warning-free install: obtain a code-signing" -ForegroundColor Yellow
    Write-Host "certificate (OV or EV) and re-run with:" -ForegroundColor Yellow
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Thumbprint <hex>' -ForegroundColor Yellow
  }
} finally {
  Pop-Location
}
