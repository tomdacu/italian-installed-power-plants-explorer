<!-- Release notes template used by .github/workflows/release.yml (body_path).
     Replace the "What's new" section for each release; keep the download
     guidance, it prevents the two most common support questions. -->

## What's new

- _Describe the user-visible changes here._

## How to run it

**With Bun already installed** (fastest, nothing to download from here):

```bash
bunx italian-capacity-explorer
```

**Without any runtime** — download `ItalianCapacityExplorer_<version>_x64-portable.zip`,
extract it and run `ice.exe`. The archive holds the executable plus the `static/`
folder with the interface: keep them together.

> ⚠️ Extract the zip first. Running `ice.exe` from inside the compressed folder
> leaves the interface behind and the app starts without its UI.

Either way the app serves itself on `http://127.0.0.1:8731` and opens a browser
window; in Chromium-based browsers you can then install it as an app (its own
window, entry in the Start menu).

## First run

1. Windows may warn about an unknown publisher: the binary is not code-signed
   yet. Choose *More info → Run anyway*, or verify the SHA-256 below first.
2. The app needs your own **free** Terna Developer credentials
   ([developer.terna.it](https://developer.terna.it)): create an application and
   paste the Client ID and secret in the Credentials page. They stay on your
   machine — the secret is encrypted with Windows DPAPI, and the app never reads
   credentials belonging to other applications.
3. Press *Download everything* on the Data sync page — a multi-year sync takes a
   few minutes (the Terna API is rate limited) and everything is stored locally.

Requirements: Windows 10/11, or macOS/Linux with Bun. WebView2/Chromium comes
from the browser you already use.

## Verifying the download (optional)

```powershell
Get-FileHash "ItalianCapacityExplorer_<version>_x64-portable.zip" -Algorithm SHA256
```

Compare it with `SHA256SUMS.txt` published with this release.

## Notes

- Data source: Terna Developer API. This project is independent and not
  affiliated with Terna S.p.A.
- Everything runs locally: no telemetry, no account, no cloud.
