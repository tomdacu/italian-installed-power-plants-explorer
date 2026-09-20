<!-- Release notes template used by .github/workflows/release.yml (body_path).
     Replace the "What's new" section for each release. -->

## What's new

- _Describe the user-visible changes here._

## Install or update

```bash
bunx italian-renewable-capacity-explorer
```

`bunx` always runs the latest published version, so updating is the same command.
Bun is a single binary: [bun.sh](https://bun.sh).

Prefer a checkout?

```bash
git clone https://github.com/tomdacu/italian-renewable-capacity-explorer
cd italian-renewable-capacity-explorer
bun install && bun run serve
```

## Using it

1. Create a free application on [developer.terna.it](https://developer.terna.it)
   and paste Client ID and secret in **Credentials** — they stay on your machine
   (the secret is encrypted with Windows DPAPI, the macOS Keychain or
   `secret-tool`).
2. Open **Data sync**, choose the years and press *Download everything*. A
   multi-year sync takes a few minutes: Terna paces requests at about one per
   second.
3. Explore the **Dashboard**. Every chart can be copied as PNG or exported as
   SVG/CSV. In Chromium-based browsers you can install the app for a standalone
   window with its own icon.

Data comes from the Terna Developer API; this project is independent and not
affiliated with Terna S.p.A.
