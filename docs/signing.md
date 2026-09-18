# Code signing the Windows installer

Windows shows *“Windows protected your PC — unknown publisher”* (SmartScreen) for
executables that are not signed with a certificate whose publisher identity has
built up reputation. No build flag can remove that warning: **signing is the only
fix**. This document covers the options that actually work, cheapest first.

## What SmartScreen actually checks

| Build | First-run experience |
| --- | --- |
| Unsigned | Warning → *More info* → *Run anyway* |
| Signed, CA-issued, low download volume | Publisher name is shown, warning may still appear until reputation builds |
| Signed, CA-issued, established reputation | No warning |
| Signed with an EV / cloud-HSM certificate | Reputation is granted immediately (EV certificates are not subject to the reputation ramp) |

A **self-signed certificate does not help** — it is only useful to test the
signing pipeline locally, because Windows cannot chain it to a trusted root.

## Option A — SignPath Foundation (free for open-source projects)

Fits this project: MIT licensed, public repository, actively developed.

1. Apply at <https://signpath.org/apply.html> (open-source program).
2. SignPath provides the certificate (issued to the SignPath Foundation) and
   signs the binaries built by your GitHub Actions workflow; the resulting
   signature links the binary to this repository.
3. Wire the `SignPath/github-action-submit-signing-request` action into
   `.github/workflows/release.yml`, replacing the “Import the code-signing
   certificate” step.
4. Approvals are manual per release, which is fine for a desktop app that ships
   a handful of builds per year.

Trade-off: the publisher name in the UAC prompt is *SignPath Foundation*, not
your own name.

## Option B — commercial certificate (OV), signed locally or in CI

Any public CA (Certum, Sectigo, GlobalSign, DigiCert, Actalis…) issues OV code
signing certificates to individuals and companies. Since the CA/Browser Forum
rules of 2023 the private key must live on a FIPS 140-2 Level 2 device, so the
certificate arrives either on a **USB token** or as a **cloud HSM** service
(Certum *SimplySign*, DigiCert *KeyLocker*, …).

With a cloud certificate you can keep using the repository script:

```powershell
$env:TAURI_SIGNING_THUMBPRINT = "<certificate thumbprint>"
npm run release
# or
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Thumbprint <thumbprint>
```

Tauri then signs the application executable, the uninstaller and the NSIS
installer (SHA-256 + RFC-3161 timestamping).

To sign **inside GitHub Actions** instead of on your machine, export the
certificate as a password-protected `.pfx` (only possible with cloud-HSM
certificates — a physical token cannot be exported) and:

```powershell
# base64 of the .pfx, then store the two values as repository secrets
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard
```

Repository → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `SIGNING_ENABLED` | `true` |
| Variable | `SIGNING_THUMBPRINT` | certificate thumbprint (SHA-1 hex) |
| Secret | `SIGNING_PFX_BASE64` | base64 of the `.pfx` |
| Secret | `SIGNING_PFX_PASSWORD` | `.pfx` password |

The `Release` workflow then imports the certificate, builds, verifies the
signature with `signtool verify` and attaches the signed installer to the
release. With `SIGNING_ENABLED` unset the same workflow produces an unsigned
installer, so you can wire everything up before buying anything.

Trade-off: OV certificates run roughly €100–400/year depending on the CA and
whether you pick a cloud HSM; the SmartScreen warning disappears gradually as
the certificate accumulates downloads.

## Option C — Azure Artifact Signing (formerly Trusted Signing)

Microsoft's managed service (≈ $9.99/month for 5 000 signatures) needs no
hardware and integrates with CI through a service principal.

⚠️ Eligibility: **organisations** in the USA, Canada, EU and UK — but
**individuals only in the USA and Canada**. An Italian individual developer
cannot subscribe, so this option only applies with a registered company.

## Verifying a build

```powershell
signtool verify /pa /v "src-tauri\target\release\bundle\nsis\Italian Capacity Explorer_1.2.0_x64-setup.exe"
Get-AuthenticodeSignature "…\Italian Capacity Explorer_1.2.0_x64-setup.exe" | Format-List
```

`Status : Valid` plus a timestamp chain means the installer will keep validating
after the certificate expires.

## What to publish on the website

- Unsigned or signed, publish the installer **plus** a SHA-256 checksum so users
  can verify the download:

  ```powershell
  Get-FileHash "Italian Capacity Explorer_1.2.0_x64-setup.exe" -Algorithm SHA256
  ```

- Link to the GitHub *Releases* page rather than mirroring the binary, unless
  you need download analytics: GitHub already serves it over HTTPS with a
  stable URL per tag.
