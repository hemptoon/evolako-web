#!/usr/bin/env python3
"""Our own charger renders and the app icon -> web sizes.

Renders: the five SiteImages from the iOS repo (the only photos the product may use) -> WebP in three widths.
Icons: AppIcon-1024 (white "e" on the #2E6BFF tile) -> PWA icons, apple-touch-icon and a PNG favicon.
Run: python3 scripts/make_images.py   (needs Pillow with WebP)
"""
import os
import sys
from PIL import Image

IOS = os.environ.get("IOS_SRC", "/home/claude/src/ios")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERS = os.path.join(IOS, "EvolakoKit/Sources/Features/Resources/SiteImages.xcassets")
ICON = os.path.join(IOS, "Evolako/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png")
IMG_OUT = os.path.join(ROOT, "src/assets/img")
ICON_OUT = os.path.join(ROOT, "public/icons")

NAMES = ["paket-wallbox-hero", "paket-wallbox-closeup", "paketi-hero", "paket-garage", "paket-zgrada"]
WIDTHS = [480, 960, 1600]

def renders() -> None:
    os.makedirs(IMG_OUT, exist_ok=True)
    for name in NAMES:
        src = os.path.join(RENDERS, f"{name}.imageset", f"{name}.jpg")
        image = Image.open(src).convert("RGB")
        for width in WIDTHS:
            height = round(image.height * width / image.width)
            resized = image if width >= image.width else image.resize((width, height), Image.LANCZOS)
            resized.save(os.path.join(IMG_OUT, f"{name}-{width}.webp"), "WEBP", quality=78, method=6)

def icons() -> None:
    os.makedirs(ICON_OUT, exist_ok=True)
    icon = Image.open(ICON).convert("RGBA")
    for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (512, "icon-maskable-512.png"),
                       (180, "apple-touch-icon.png"), (32, "favicon-32.png")]:
        # The master is a full-bleed tile with the mark well inside the 80 % safe zone,
        # so the same art works as a maskable icon.
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(ICON_OUT, name), optimize=True)

if __name__ == "__main__":
    if not os.path.isdir(RENDERS):
        sys.exit(f"iOS sources not found in {IOS} (set IOS_SRC)")
    renders()
    icons()
    print("ok")
