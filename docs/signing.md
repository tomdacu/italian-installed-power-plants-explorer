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

## Option A — free: SignPath Foundation (open-source projects)

This is the only genuinely free route to a *trusted* Windows signature. The
certificate is issued to the SignPath Foundation and used to sign the artifacts
built by your GitHub Actions workflow, so the binary is provably linked to this
repository.

Eligibility: an OSI-approved license (MIT here), a public repository, active
development, and — for OSS projects — every job of the workflow must run on
GitHub-hosted runners.

**This is not a rubber stamp.** The certificate is issued in the foundation's
name, so they gate on verifiable project reputation: “we cannot sign binaries
based on source code that nobody knows”. A brand-new repository with no release
and no users will normally be turned down. Before applying, make sure the
project satisfies:

- [ ] it is **already released** in the form to be signed (publish the installer
      as a GitHub Release first) and its functionality is documented on the
      download page;
- [ ] all components are OSI-licensed with **no proprietary parts** (that is why
      `backend/` lives in this repository);
- [ ] the **code signing policy** is on the project home page — the
      `## Code signing policy` section of this README is written to their
      required wording, keep it there and fill in the maintainer handle;
- [ ] the maintainer uses **multi-factor authentication** on GitHub and SignPath;
- [ ] signed binaries carry **product name and version** metadata (Tauri sets
      them for `app.exe`; the PyInstaller sidecar has none yet, so sign the
      installer and the app executable, or add a version resource to the spec);
- [ ] you accept that **every release is approved manually**.

1. **Apply** at <https://signpath.io/solutions/open-source-community>; approval is
   manual and takes a few days.
2. **In SignPath**: create an organization, add the predefined *Trusted Build
   System* “GitHub.com” to it, and install the
   [SignPath GitHub App](https://github.com/apps/signpath) on the repository.
3. **Create a project** for this app with:
   - an *Artifact Configuration* describing which files inside the uploaded
     artifact to sign (`*.exe`, `*.dll`, `*.msi`);
   - a *Signing Policy* (e.g. `release-signing`) — keep the manual approval if
     you want a human check before every signature.
4. **API token**: create one for a user with submitter rights and store it as the
   repository secret `SIGNPATH_API_TOKEN`.
5. **Wire it into `.github/workflows/release.yml`**, after the installer is built:

   ```yaml
   - name: Upload the unsigned installer
     id: upload-unsigned
     uses: actions/upload-artifact@v4
     with:
       name: unsigned-installer
       path: src-tauri/target/release/bundle/nsis/*.exe

   - name: Sign with SignPath
     uses: signpath/github-action-submit-signing-request@v3
     with:
       api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
       organization-id: "<SignPath organization id>"
       project-slug: "italian-capacity-explorer"
       signing-policy-slug: "release-signing"
       github-artifact-id: ${{ steps.upload-unsigned.outputs.artifact-id }}
       wait-for-completion: true
       output-artifact-directory: "signed/"
   ```

   Then attach `signed/` to the release instead of the unsigned file. The action
   only works on artifacts uploaded with `actions/upload-artifact` v4+.

Trade-offs: the publisher name Windows shows is **SignPath Foundation**, not your
own name, and each signing request goes through their policy (manual approval by
default). SmartScreen reputation is pooled at foundation level, so it builds up
across releases.

## Option B — cheapest paid: Certum Open Source Code Signing (~$58/year)

Certum sells an *Open Source Code Signing* certificate in the cloud for around
**$58/year** (list price on certum.store). It is the cheapest option that puts
**your own name** in the certificate: the subject is
`Open Source Developer <your name>`, RSA 3072, private key in a cloud HSM
(FIPS 140-2 level 3, no USB token), limit of 5 000 signatures per month.

What it requires:

- identity verification (ID documents) and a review of the open-source project,
- the **SimplySign Desktop** app on the signing machine plus the SimplySign
  mobile app for access codes,
- signing happens where SimplySign Desktop runs: use
  `powershell -File scripts/release.ps1 -Thumbprint <thumbprint>` on your
  machine. Automating this inside CI is possible only if the CA supports
  headless signing for your product; a cloud certificate tied to a desktop
  app is generally not usable from a GitHub runner.

Trade-off: ~€55/year, and the SmartScreen warning fades as the certificate
accumulates downloads (OV certificates are not exempt from the reputation ramp
the way EV ones are).

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
