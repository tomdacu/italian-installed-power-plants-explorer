<!-- Release notes template used by .github/workflows/release.yml (body_path).
     Replace the "What's new" section for each release; keep the download
     guidance, it prevents the two most common support questions. -->

## What's new

- _Describe the user-visible changes here._

## Which file do I download?

| File | Who it is for |
| --- | --- |
| `ItalianCapacityExplorer_<version>_x64-setup.exe` | **Most people.** Double-click, next-next, done. Installs for the current user (no administrator rights), adds a Start menu entry and an uninstaller, and installs WebView2 if the machine is missing it. |
| `ItalianCapacityExplorer_<version>_x64-portable.zip` | Anyone who does not want to install anything. **Right-click → Extract all**, then run `app.exe` from the extracted folder. |

> ⚠️ Do **not** run `app.exe` from inside the zipped folder (Windows' compressed
> folder view): the backend lives in `bin\app-backend\` next to it and the app
> would open without a data service. Extract everything first.

## First run

1. Windows may show *“Windows protected your PC — unknown publisher”*: the
   installer is not code-signed yet. Choose *More info → Run anyway*, or verify
   the SHA-256 below first.
2. The app needs your own **free** Terna Developer credentials
   ([developer.terna.it](https://developer.terna.it)): create an application and
   paste the Client ID and secret in the Credentials page. They stay on your
   machine.
3. Press *Download everything* on the Data sync page — a multi-year sync takes a
   few minutes (the Terna API is rate limited) and everything is stored locally.

Requirements: Windows 10/11 (64-bit). The portable build needs WebView2, which
ships with Windows 10/11.

## Verifying the download (optional)

```powershell
Get-FileHash "ItalianCapacityExplorer_<version>_x64-setup.exe" -Algorithm SHA256
```

Compare it with the checksum published with this release.

## Notes

- Data source: Terna Developer API. This project is independent and not
  affiliated with Terna S.p.A.
- Everything runs locally: no telemetry, no account, no cloud.
