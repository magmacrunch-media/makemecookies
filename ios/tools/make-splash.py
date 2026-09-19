#!/usr/bin/env python3
"""Draw the launch image into the Xcode asset catalog.

    python ios/tools/make-splash.py        # needs Pillow

What it replaces is three byte-identical copies of Capacitor's default splash,
which `cap add` supplied and which archive without complaint. A binary in git
with no way to remake it is a dead end the first time somebody wants it a
shade different, so the art is source and this is the source.

The backdrop is `make-cookie-pixel.py`'s, imported rather than copied, so the
icon and the launch image cannot drift apart. The wordmark is Press Start 2P
drawn crisp with the glow added afterwards from a blurred copy, which is how
the title screen reads and how the album art reads.

## Everything is sized as a fraction of the square, and that is the point

`LaunchScreen.storyboard` scales this with `scaleAspectFill`, so a portrait
phone fills the HEIGHT from a square image and crops the width to the device's
aspect. A 2732 square on a 1320x2868 iPhone shows a band 46% of the width.
Anything wider is cut off at both ends while looking perfect in the asset
catalog, which is exactly the sort of gap this game's icon already had. So the
text is laid out to a fraction and the fractions are asserted before the file
is written.
"""

import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

IOS = Path(__file__).resolve().parent.parent
REPO = IOS.parent
ASSETS = IOS / "App" / "App" / "App" / "Assets.xcassets"

# make-cookie-pixel.py owns the backdrop and the palette. Its name has a
# hyphen, so it is loaded by path rather than imported; it runs nothing at
# import time beyond reading the game's own palette.
_spec = importlib.util.spec_from_file_location("cookie", IOS / "tools" / "make-cookie-pixel.py")
cookie = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cookie)

# The website repo carries the self-hosted font and the publisher's mark.
# Both layouts: a flat clone beside this repo, and this tree.
WEBSITE_CANDIDATES = [
    REPO.parent / "website",
    REPO.parent.parent / "web" / "website",
]

# The backdrop's own stops, darker than the icon's.
#
# The icon is mostly cookie, so its ground shows only at the edges where the
# gradient has already fallen away. Here the field is the whole picture, and
# the same stops that read as a glow under a cookie read as hot pink across a
# phone screen. The title card is dark with a pink wash over it; so is this.
SPLASH_GLOW = (72, 18, 54)
SPLASH_EDGE = (16, 8, 18)

NEON = cookie.NEON              # the title line
BUTTER = (255, 201, 60)         # --butter, for the X4
MINT = cookie.MINT              # --sprinkle, for the tagline
PUBLISHER = (154, 123, 162)     # --subtext: quiet, the way the title card's is

# The narrowest band any current iPhone shows is 46% of the square's width.
# Refuse to write art wider than this, with a margin.
SAFE_WIDTH = 0.44
# A landscape iPad fills the width and crops top and bottom, showing about the
# middle 75% of the height.
SAFE_HEIGHT = 0.70


def website():
    for c in WEBSITE_CANDIDATES:
        if c.is_dir():
            return c
    return None


def load_font(px):
    site = website()
    path = site / "fonts" / "PressStart2P-Regular.ttf" if site else None
    if path and path.exists():
        return ImageFont.truetype(str(path), px)
    raise SystemExit(
        "PressStart2P-Regular.ttf not found. It lives in the website repo.\n"
        + "\n".join(f"  looked for {c / 'fonts'}" for c in WEBSITE_CANDIDATES)
    )


def load_mark():
    """The magmacrunch media mark, recoloured white.

    The website's original is black on transparency, which would vanish here,
    so only its alpha is kept. A missing mark drops the line rather than
    failing the run: it is a decoration, and the wordmark is the art.
    """
    site = website()
    path = site / "assets" / "logos" / "MClogoNoText.png" if site else None
    if not path or not path.exists():
        print("  no publisher mark found; drawing the splash without it")
        return None
    original = Image.open(path).convert("RGBA")
    white = Image.new("RGBA", original.size, (255, 255, 255, 0))
    white.putalpha(original.getchannel("A"))
    return white.crop(white.getbbox())


def fit(d, text, fraction, size):
    """A font at which `text` is `fraction` of the square, near enough.

    Sizing by measurement rather than by ratios of character counts: the
    tagline is 19 characters against the title's 14, and getting that wrong is
    how a line ends up past the crop with nothing to show it.
    """
    probe = load_font(100)
    width = d.textlength(text, font=probe)
    return load_font(max(8, round(100 * size * fraction / width)))


def build_splash(size=2732):
    base = cookie.radial(
        max(64, size // 6), centre=0.42, stops=(SPLASH_GLOW, SPLASH_EDGE)
    ).resize((size, size), Image.BICUBIC)
    base = Image.alpha_composite(base, cookie.floor(size, tiles=16, alpha=12))

    art = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)

    lines = [
        ("MAKEMECOOKIES!", fit(d, "MAKEMECOOKIES!", 0.38, size), NEON),
        ("X4", fit(d, "X4", 0.09, size), BUTTER),
        ("ONE SONG, ONE SHIFT", fit(d, "ONE SONG, ONE SHIFT", 0.33, size), MINT),
        ("MAGMACRUNCH MEDIA", fit(d, "MAGMACRUNCH MEDIA", 0.19, size), PUBLISHER),
    ]

    gaps = [
        round(lines[0][1].size * 0.45),
        round(lines[0][1].size * 1.10),
        round(lines[0][1].size * 1.30),
    ]
    total = sum(font.size for _t, font, _c in lines) + sum(gaps)

    # The mark sits above the publisher's name, the pairing the website uses,
    # and joins the block so the height check below covers it. The block is
    # centred on both axes because the middle is the only region certain to
    # survive the crop, whichever way the device is held.
    mark = load_mark()
    pub_size = lines[-1][1].size
    mark_height = round(pub_size * 2.4) if mark else 0
    mark_gap = round(pub_size * 0.9) if mark else 0
    total += mark_height + mark_gap

    y = (size - total) // 2
    widest = 0
    for i, (text, font, colour) in enumerate(lines):
        if mark is not None and i == len(lines) - 1:
            scaled = mark.resize(
                (max(1, round(mark.width * mark_height / mark.height)), mark_height),
                Image.LANCZOS,
            )
            art.alpha_composite(scaled, ((size - scaled.width) // 2, y))
            widest = max(widest, scaled.width)
            y += mark_height + mark_gap

        w = d.textlength(text, font=font)
        widest = max(widest, w)
        d.text(((size - w) / 2, y), text, font=font, fill=colour)
        y += font.size + (gaps[i] if i < len(gaps) else 0)

    if widest > size * SAFE_WIDTH:
        raise SystemExit(
            f"the splash block is {widest / size:.0%} of the square's width, past "
            f"{SAFE_WIDTH:.0%}. scaleAspectFill would crop it on a phone."
        )
    print(f"  width  {widest / size:.0%} of the square (a phone shows 46%)")

    if total > size * SAFE_HEIGHT:
        raise SystemExit(
            f"the splash block is {total / size:.0%} of the square's height, past "
            f"{SAFE_HEIGHT:.0%}. A landscape iPad shows about the middle 75%."
        )
    print(f"  height {total / size:.0%} of the square (an iPad shows 75%)")

    out = Image.alpha_composite(base, cookie.bloom(art, radius=size // 90, strength=0.8))
    out = Image.alpha_composite(out, cookie.bloom(art, radius=size // 300, strength=1.0))
    out.alpha_composite(art)
    return out.convert("RGB")


def main():
    splash_dir = ASSETS / "Splash.imageset"
    if not splash_dir.is_dir():
        raise SystemExit(f"asset catalog not found under {ASSETS}. Run `npx cap add ios` first.")

    splash = build_splash()
    # Capacitor registers the same image at 1x, 2x and 3x, and all three
    # filenames are referenced by Contents.json.
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        splash.save(splash_dir / name)
        print(f"wrote {splash_dir.name}/{name}  {splash.size[0]}x{splash.size[1]}")


if __name__ == "__main__":
    main()
