# Brand assets

The brand mark is hand-authored vector art: three ascending bars on an
evergreen gradient plate, legible down to 16 px.

| Asset | Location | Use |
| --- | --- | --- |
| Vector master | [`app-icon.svg`](../../app-icon.svg) | source of truth; edit this first |
| 1024 master PNG | [`app-icon.png`](../../app-icon.png) | RGBA raster of the SVG, input to the asset script |
| In-app mark | [`BrandMark.tsx`](../../src/components/ui/BrandMark.tsx) | inline SVG with the same geometry |
| Favicon | [`public/favicon.svg`](../../public/favicon.svg) | same drawing, browser tab |
| BrandMark PNG | [`public/brandmark.png`](../../public/brandmark.png) | raster mark for third-party surfaces |
| Repository banner | `readme-banner.png` | shown at the top of the README (dark plate, emblem with orbit rings, extruded title) |
| GitHub preview | `github-social-preview.png` | upload in GitHub repository settings |
| Website hero | `hero-site.png` | real dashboard screenshot + abstract plate |
| Hero background plate | `hero-background.png` | background source for the hero composition |
| OG image | [`public/og-image.png`](../../public/og-image.png) | `og:image` / social cards |
| PWA icons | `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | installed-app icon |
| Executable icon | [`assets/icon.ico`](../../assets/icon.ico) | `bun run compile` (local standalone build) |

## Regenerating

```powershell
# 1. rasterise app-icon.svg at exactly 1024x1024 with transparent corners,
#    replacing app-icon.png (any browser: load the SVG, screenshot at 1:1)
# 2. hero, banner, social preview, OG image, PWA icons, brandmark.png
python scripts/generate-brand-assets.py
```

The dashboard screenshots (`docs/screenshot-dashboard.png` and
`docs/screenshot-sync.png`) are **captured from the running app** — 1440 × 900
viewport, `deviceScaleFactor` 1.25 — never synthesised: the mark in the sidebar
has to be the real one.

The image-generation concepts that led to the final mark, and the legibility
comparisons behind it, are kept outside the repository in `notes/`.
