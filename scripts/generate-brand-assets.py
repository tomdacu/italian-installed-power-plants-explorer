"""Prepare the raster companions of the brand mark.

The master is ``app-icon.svg`` (vector, hand-authored) rendered to
``app-icon.png`` at 1024x1024: regenerate that raster by loading the SVG in a
browser and screenshotting it at exactly 1024x1024. This script only resizes and
composes that master; it never redraws the mark. The hero/social images use the abstract
background plate in ``docs/assets/hero-background.png`` and the real capture in
``docs/screenshot-dashboard.png`` (1440x900 viewport, deviceScaleFactor 1.25,
themes dark and light — capture them from the running app, do not synthesise).

Run from the repository root with the machine's global Python + Pillow:

    python scripts/generate-brand-assets.py
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
SCREENSHOT = ROOT / "docs" / "screenshot-dashboard.png"
BACKGROUND = ASSETS / "hero-background.png"
ICON_SOURCE = ROOT / "app-icon.png"

WHITE = (255, 255, 255, 255)
INK = (4, 19, 14, 255)
BRAND = (20, 176, 127, 255)
MINT = (217, 255, 236, 255)


def font(name: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = Path(r"C:\Windows\Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def fit_cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image.convert("RGBA"), size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def brand_icon(size: int = 1024) -> Image.Image:
    """Return the vector brand mark rasterised at the requested size (RGBA)."""
    return ImageOps.fit(
        Image.open(ICON_SOURCE).convert("RGBA"),
        (size, size),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )


def rounded_panel(
    base: Image.Image,
    image: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    outline: tuple[int, int, int, int] = (255, 255, 255, 35),
) -> None:
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    panel = ImageOps.fit(image.convert("RGBA"), (width, height), method=Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((x1 + 8, y1 + 16, x2 + 8, y2 + 16), radius=radius, fill=(0, 0, 0, 170))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)))
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=radius, fill=255)
    base.paste(panel, (x1, y1), mask)
    ImageDraw.Draw(base).rounded_rectangle(box, radius=radius, outline=outline, width=2)


def panel_box(
    canvas: tuple[int, int],
    *,
    height: int,
    top: int,
    right: int,
) -> tuple[int, int, int, int]:
    """Box whose aspect ratio equals the screenshot's, so `rounded_panel` (which
    covers the box) never crops the window: a mismatched ratio silently cut the
    sidebar off the left and the right-hand cards off the right edge."""
    with Image.open(SCREENSHOT) as shot:
        ratio = shot.width / shot.height
    width = round(height * ratio)
    x2 = canvas[0] - right
    return (x2 - width, top, x2, top + height)


def make_hero() -> None:
    size = (1600, 900)
    base = fit_cover(Image.open(BACKGROUND), size)
    overlay = Image.new("RGBA", base.size, (4, 19, 14, 76))
    base.alpha_composite(overlay)
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((180, 65, 1420, 875), fill=(20, 176, 127, 45))
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(60)))
    rounded_panel(
        base,
        Image.open(SCREENSHOT),
        panel_box(size, height=775, top=100, right=180),
        30,
        (113, 226, 181, 95),
    )
    base.convert("RGB").save(ASSETS / "hero-site.png", "PNG", optimize=True)


def draw_share_card(path: Path, size: tuple[int, int], *, height: int, top: int, right: int) -> None:
    base = fit_cover(Image.open(BACKGROUND), size)
    base.alpha_composite(Image.new("RGBA", size, (4, 19, 14, 100)))
    draw = ImageDraw.Draw(base)
    w, h = size
    left = max(48, round(w * 0.055))
    accent_y = round(h * 0.19)
    draw.rounded_rectangle((left, accent_y, left + 70, accent_y + 6), radius=3, fill=BRAND)
    small = font("seguisb.ttf", max(13, round(w * 0.018)))
    title = font("segoeuib.ttf", max(32, round(w * 0.037)))
    body = font("segoeui.ttf", max(16, round(w * 0.018)))
    draw.text((left, accent_y + 27), "ITALIAN CAPACITY EXPLORER", font=small, fill=(113, 226, 181, 255))
    draw.multiline_text(
        (left, accent_y + 66),
        "Explore Italy's\ninstalled capacity",
        font=title,
        fill=WHITE,
        spacing=4,
    )
    draw.multiline_text(
        (left, accent_y + round(h * 0.38)),
        "Local-first analytics\npowered by Terna data.",
        font=body,
        fill=(218, 235, 229, 235),
        spacing=5,
    )
    rounded_panel(
        base,
        Image.open(SCREENSHOT),
        panel_box(size, height=height, top=top, right=right),
        max(20, round(w * 0.02)),
        (113, 226, 181, 105),
    )
    base.convert("RGB").save(path, "PNG", optimize=True)


def make_pwa_icons() -> None:
    """Icone per la PWA: `any` (angoli arrotondati) e `maskable` (fondo pieno)."""
    for size in (192, 512):
        brand_icon(size).save(ROOT / "public" / f"icon-{size}.png", "PNG", optimize=True)

    # Maskable: il soggetto deve stare nel 60% centrale e il fondo arrivare ai bordi.
    size = 512
    canvas = Image.new("RGBA", (size, size), (4, 19, 14, 255))
    canvas.alpha_composite(gradient((size, size), (47, 217, 143), (7, 96, 72)))
    inner = brand_icon(int(size * 0.56))
    canvas.alpha_composite(inner, ((size - inner.width) // 2, (size - inner.height) // 2))
    canvas.save(ROOT / "public" / "icon-maskable-512.png", "PNG", optimize=True)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    required = (SCREENSHOT, BACKGROUND, ICON_SOURCE)
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("Missing input asset(s): " + ", ".join(missing))

    brand_icon(256).save(ROOT / "public" / "brandmark.png", "PNG", optimize=True)
    make_hero()
    draw_share_card(ASSETS / "github-social-preview.png", (1280, 630), height=460, top=80, right=62)
    draw_share_card(ROOT / "public" / "og-image.png", (1200, 630), height=430, top=100, right=50)
    make_pwa_icons()


if __name__ == "__main__":
    main()
