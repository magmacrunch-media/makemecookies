#!/usr/bin/env python3
"""Derive the magmacrunch media mark shown on the title screen.

    python ios/tools/make-logo.py        # needs Pillow
    python ios/tools/make-logo.py --check

Writes `web/img/mc-logo.png`, so the browser game and the App Store bundle both
get it: `package.mjs` copies `web/` wholesale, and the website's
`make sync-makemecookies` copies it into `arcade/`. It lives here because this
is where the other art generators live, not because it is iOS-only.

## Why this file exists at all

`web/img/mc-logo.png` was already committed and had **no way to remake it**. It
is byte-identical to george-boole's, so it was copied across, and a binary in
git with no generator is the dead end `make-splash.py`'s own header complains
about in Capacitor's default splash. This is that generator, ported from
george-boole's so both games derive the mark the same way and neither has to
remember what was done to it.

Adding it changed no art: the file this writes is byte-identical to the one
that was already committed, which is what made porting it safe.

## Why it is derived rather than copied

The source, `assets/logos/MClogoNoText.png` in the website repo, is a 2500x2650
PNG of **pure black on transparency** -- 1.1MB, and invisible on this game's
near-black title card. Two things have to happen to it:

  - Tint. Only the alpha channel carries the drawing, so the mark is redrawn
    as white from that alpha and the black is discarded entirely.
  - Shrink. It is displayed 32px tall. Shipping 1.1MB inside an offline bundle
    to draw a 32px mark would be most of the size the audio costs.

## Note what this does NOT feed

`make-splash.py` does not read this file. It opens the website's original and
whites it itself, without the threshold crop or the resize below, because the
launch image draws the mark far larger than 32px and wants the full-resolution
source. So the two derivations are deliberately separate, and george-boole
differs here: its `make-art.py` reads the generated file. Do not "fix" this by
pointing the splash at `web/img/mc-logo.png` without redrawing and eyeballing
the launch image, because it would change it.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageChops

IOS = Path(__file__).resolve().parent.parent
REPO = IOS.parent
WEB = REPO / "web"

# The website repo, resolved the way package.mjs and make-splash.py resolve it.
SOURCE_CANDIDATES = [
    REPO.parent / "website" / "assets" / "logos" / "MClogoNoText.png",
    REPO.parent.parent / "web" / "website" / "assets" / "logos" / "MClogoNoText.png",
]

# Three times the 32px it is drawn at, so it stays sharp on a 3x phone.
HEIGHT = 96
TINT = (255, 255, 255)


def find_source():
    for candidate in SOURCE_CANDIDATES:
        if candidate.exists():
            return candidate
    raise SystemExit(
        "MClogoNoText.png not found. It lives in the website repo.\n"
        + "\n".join(f"  looked in {c}" for c in SOURCE_CANDIDATES)
    )


def build(source, height=HEIGHT):
    art = Image.open(source).convert("RGBA")
    alpha = art.getchannel("A")

    # The source has a wide transparent margin, which at this size would be
    # most of the picture.
    box = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
    if not box:
        raise SystemExit(f"{source} is entirely transparent")
    alpha = alpha.crop(box)

    width = max(1, round(alpha.width * height / alpha.height))
    alpha = alpha.resize((width, height), Image.LANCZOS)

    out = Image.new("RGBA", alpha.size, TINT + (0,))
    out.putalpha(alpha)
    return out


def stale(path, fresh):
    """Is the committed mark not the image `fresh`? Pixels, and all four channels.

    **RGBA, not RGB, and that is the whole check.** This mark is uniform white
    with the drawing carried entirely in the alpha channel, so a comparison
    that dropped alpha would be white against white: it could never fail, for
    any possible difference, while reading exactly like a working check.

    Comparing pixels at all is safe because there is no font in this file, only
    an alpha crop and a LANCZOS resize, which agree across machines -- CI draws
    LANCZOS output for both games. `make-boards.py`'s cards are Press Start 2P
    through FreeType and cannot be checked this way; see its header.
    """
    if not path.exists():
        print(f"MISS  {path.relative_to(REPO)}")
        return True
    current = Image.open(path).convert("RGBA")
    if current.size != fresh.size or ImageChops.difference(current, fresh).getbbox():
        print(f"WRONG {path.relative_to(REPO)} is not what the website's logo derives to")
        return True
    return False


def main():
    ap = argparse.ArgumentParser(description="Derive the magmacrunch media mark.")
    ap.add_argument("--height", type=int, default=HEIGHT, help=f"pixels tall (default {HEIGHT})")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed mark is not what the source derives to")
    args = ap.parse_args()

    source = find_source()
    mark = build(source, args.height)
    out = WEB / "img" / "mc-logo.png"

    # The one check here that crosses a repository boundary. The source lives
    # in the website repo and the result is committed in this one, so a logo
    # redrawn over there leaves this stale with nothing on either side looking:
    # the website does not know this file exists, and this repo does not watch
    # the website.
    if args.check:
        if stale(out, mark):
            raise SystemExit("run: python ios/tools/make-logo.py   and commit the result")
        print(f"mark matches {source}")
        return

    out.parent.mkdir(exist_ok=True)
    mark.save(out, optimize=True)
    print(f"mark   {out.relative_to(REPO)}  {mark.size[0]}x{mark.size[1]}  "
          f"{out.stat().st_size / 1024:.1f}KB  (from {source})")


if __name__ == "__main__":
    main()
