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

`LaunchScreen.storyboard` scales this with `scaleAspectFill`, so a square image
covers the view and whichever axis the view is shorter on gets cropped.
**This game's phone is landscape**, so the axis at risk is the HEIGHT: a 2732
square on a 2868x1320 iPhone shows a band 46% of the height, full width.
Anything taller is cut off top and bottom while looking perfect in the asset
catalog, which is exactly the sort of gap this game's icon already had. So the
text is laid out to a fraction and the fractions are asserted before the file
is written.

Both limits were on the wrong axes until 2026-09-24. This file was written from
george-boole's, whose phone is portrait, so it guarded the width at 46% on a
device that never crops the width and allowed 70% of the height on one that
shows 46%. The art passed throughout and still does, at 38% and 21%, which is
why nothing surfaced it: the block was small enough to clear both limits either
way round. See the constants below for the full derivation.
"""

import argparse
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

# Which axis gets cropped depends on the orientation, and this game is
# LANDSCAPE on iPhone. That inverts both limits relative to george-boole, whose
# phone is portrait, and they were inverted here until 2026-09-24: this file
# carried george-boole's numbers and guarded the width on a device that never
# crops the width.
#
# `scaleAspectFill` from a square covers the view, so the shorter side of the
# view is the fraction of the square that survives, on that side's axis:
#
#   iPhone landscape   2868x1320, 0.46  ->  full width, middle 46% of HEIGHT
#   iPad portrait      1024x1366, 0.75  ->  middle 75% of WIDTH, full height
#   iPad landscape     1366x1024, 0.75  ->  full width, middle 75% of height
#
# Info.plist locks iPhone to landscape both ways up and leaves iPad on all
# four, so the binding cases are the first two. Height is cropped hardest by
# the landscape phone at 46%; width is cropped only by the portrait iPad, at
# 75%. Both carry a margin.
SAFE_WIDTH = 0.72
SAFE_HEIGHT = 0.44


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
            f"{SAFE_WIDTH:.0%}. A portrait iPad would crop it: the phone is landscape "
            f"and never crops the width."
        )
    print(f"  width  {widest / size:.0%} of the square (a portrait iPad shows 75%)")

    if total > size * SAFE_HEIGHT:
        raise SystemExit(
            f"the splash block is {total / size:.0%} of the square's height, past "
            f"{SAFE_HEIGHT:.0%}. A landscape phone shows about the middle 46%, and "
            f"this app's phone is landscape only."
        )
    print(f"  height {total / size:.0%} of the square (a landscape phone shows 46%)")

    out = Image.alpha_composite(base, cookie.bloom(art, radius=size // 90, strength=0.8))
    out = Image.alpha_composite(out, cookie.bloom(art, radius=size // 300, strength=1.0))
    out.alpha_composite(art)
    return out.convert("RGB")


# Capacitor registers the same image at 1x, 2x and 3x, and all three filenames
# are referenced by Contents.json.
NAMES = ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png")


def main():
    ap = argparse.ArgumentParser(description="Draw the makemecookies!x4 launch image.")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed launch image is missing, malformed, or would crop")
    args = ap.parse_args()

    splash_dir = ASSETS / "Splash.imageset"
    if not splash_dir.is_dir():
        raise SystemExit(f"asset catalog not found under {ASSETS}. Run `npx cap add ios` first.")

    if args.check:
        # Drawn for its assertions, and the image is then thrown away.
        #
        # That is the point rather than a shortcut. build_splash() sizes every
        # line from SAFE_WIDTH and then measures the laid-out block against the
        # band a phone actually shows, and both the font and the publisher's
        # mark it measures come from the WEBSITE repo. Either one changed over
        # there moves the metrics and could crop the wordmark, with nothing in
        # this repo looking. This is what looks.
        #
        # What it cannot do is compare the drawn image to the committed one.
        # Press Start 2P goes through FreeType, which does not rasterise
        # identically across versions or platforms, so that comparison holds
        # only on the machine that drew it last. make-boards.py tried exactly
        # that and went red in CI on all nine of its images while passing here.
        build_splash()

        bad = 0
        for name in NAMES:
            path = splash_dir / name
            if not path.exists():
                print(f"MISS  {path.relative_to(REPO)}")
                bad += 1
                continue
            with Image.open(path) as im:
                if im.size != (2732, 2732):
                    print(f"WRONG {path.relative_to(REPO)} is {im.size[0]}x{im.size[1]}, not 2732x2732")
                    bad += 1

        # Three filenames, one image. Comparing them to each other is portable
        # where comparing them to a fresh draw is not, and a half-finished
        # regeneration is exactly how they would come apart.
        if not bad and len({(splash_dir / n).read_bytes() for n in NAMES}) != 1:
            print(f"WRONG the {len(NAMES)} splash files are not the same image")
            bad += 1

        if bad:
            raise SystemExit("run: python ios/tools/make-splash.py   and commit the result")
        print(f"launch image present as {len(NAMES)} identical files, and fits the crop")
        return

    splash = build_splash()
    for name in NAMES:
        splash.save(splash_dir / name)
        print(f"wrote {splash_dir.name}/{name}  {splash.size[0]}x{splash.size[1]}")


if __name__ == "__main__":
    main()
