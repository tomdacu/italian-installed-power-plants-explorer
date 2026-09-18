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
  Write-Host "== [0/3] Checking the backend sidecar ==" -ForegroundColor Cyan
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

  Write-Host "== [1/3] Type-check & build frontend ==" -ForegroundColor Cyan
  if (-not $SkipTypecheck) { npm run typecheck }
  if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

  Write-Host "== [2/3] Building & bundling (tauri build) ==" -ForegroundColor Cyan
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

  Write-Host "== [3/3] Artifacts ==" -ForegroundColor Cyan
  $bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
  Get-ChildItem $bundleDir -Filter *.exe | ForEach-Object { Write-Host "   $($_.FullName)" }

  if (-not $Thumbprint) {
    Write-Host ""
    Write-Host "Next step for a warning-free install: obtain a code-signing" -ForegroundColor Yellow
    Write-Host "certificate (OV or EV) and re-run with:" -ForegroundColor Yellow
    Write-Host '  powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Thumbprint <hex>' -ForegroundColor Yellow
  }
} finally {
  Pop-Location
}
