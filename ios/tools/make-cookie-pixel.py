#!/usr/bin/env python3
"""Draw the app icon: one cookie, on the diner floor.

    python ios/tools/make-cookie-pixel.py                  # needs Pillow
    python ios/tools/make-cookie-pixel.py --sheet out.png   # judge it small

Writes `AppIcon-512@2x.png` and its dark-appearance twin into the asset
catalog, replacing the stock Capacitor logo that `cap add` supplied. That
placeholder is the reason this script exists: it builds and archives without
complaint, so nothing in the pipeline ever objects to shipping Capacitor's
branding under this game's name.

## Judge it at 60px

George Boole's icon was fine at 1024 and a murky blob at 60, which is the size
that matters, and the lesson cost a redraw. `--sheet` renders 180, 120 and 60
against a light and a dark wallpaper, masked the way iOS masks them. Look at
that, not at the 1024.

## Why the ground is dark

The obvious reading of this game is neon pink, and a pink ground is wrong here:
dough is a light tan, and tan on `#FF2E9C` differs by about 47 points of luma.
Against the deep plum the panels already use it differs by about 142, so the
cookie carries itself and the pink becomes a glow behind it rather than a field
under it. The checkerboard is the title screen's diner floor at the same angle.

## Nothing about the cookie is retyped

The colours and the shape both come from `web/js/pixels.js`, parsed: the `PAL`
table and the `SPR_COOKIE_BIG` sprite. So a cookie recoloured OR redrawn in the
game cannot leave the icon painting the old one, and the title card, which
blits the same sprite, cannot drift from the home screen either.

The shape used to be computed here instead -- a disc with two low harmonics on
the rim -- which put the icon's cookie in the one file the game could not read.
The palette was already parsed to avoid exactly that; the shape was the half
that got away.

The three colours the icon needs and the sprite sheet does not -- the two
ground stops and the glow -- are named here and nowhere else.
"""

import argparse
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

IOS = Path(__file__).resolve().parent.parent
REPO = IOS.parent
WEB = REPO / "web"
ASSETS = IOS / "App" / "App" / "App" / "Assets.xcassets"

GRID = 32


def read_palette():
    """The PAL table out of web/js/pixels.js, as RGB triples."""
    text = (WEB / "js" / "pixels.js").read_bytes().decode()
    block = re.search(r"const PAL = \{(.*?)\n\};", text, re.DOTALL)
    if not block:
        raise SystemExit("could not find the PAL table in web/js/pixels.js")
    pal = {}
    for key, hexcode in re.findall(r"(\w):\s*'#([0-9A-Fa-f]{6})'", block.group(1)):
        pal[key] = tuple(int(hexcode[i:i + 2], 16) for i in (0, 2, 4))
    for needed in "KDTtCBM":
        if needed not in pal:
            raise SystemExit(f"web/js/pixels.js has no '{needed}' in PAL; the icon needs it")
    return pal


PAL = read_palette()

MINT = PAL["M"]         # the sprinkle that makes it this game's cookie
                        # -- named here because make-splash.py reads it for
                        # the tagline, not because the cookie needs it.

# Ground. Not in pixels.js because nothing in the game draws it: the title
# screen builds the same look out of CSS gradients.
GLOW = (126, 30, 92)
EDGE = (20, 10, 22)
GLOW_DARK = (78, 18, 58)
EDGE_DARK = (12, 6, 14)
NEON = (255, 46, 156)


# ---- the cookie ------------------------------------------------------------

# Where the sprite sits in the 32-cell icon grid, and it is NOT centred.
#
# The cookie used to be computed here: a disc with two low harmonics on the
# rim, chips placed by hand, and a one-cell outline walked around the result.
# Its tight bounding box landed 25 cells wide, half a cell right of centre,
# and this is that placement kept. Centring it would move the art by a cell
# and change an icon that has already been judged at 60px, for no reason
# beyond the offset looking tidier in this file.
#
# The margin is the part that matters and is why the grid is bigger than the
# cookie at all: 3 and 4 cells of clearance are what keep the disc inside the
# rounded mask iOS draws. build_icon asserts that, so an edit that fattens the
# sprite fails there rather than shipping a cookie with a corner shaved off.
COOKIE_AT = (4, 3)


def read_cookie_sprite():
    """SPR_COOKIE_BIG out of web/js/pixels.js, as a list of string rows.

    The shape is no longer computed here, and that is the point. Computing it
    meant the icon's cookie existed in the one file the game cannot read, so
    the game could redraw or recolour its cookie and the home screen would go
    on showing the old one with nothing to say so. The palette was already
    parsed for exactly that reason -- the shape was the half that got away.

    The table carries its own outline, as every sprite in that file does, so
    nothing is drawn around it here.
    """
    text = (WEB / "js" / "pixels.js").read_bytes().decode()
    block = re.search(r"const SPR_COOKIE_BIG = \[(.*?)\n\];", text, re.DOTALL)
    if not block:
        raise SystemExit(
            "could not find SPR_COOKIE_BIG in web/js/pixels.js; the icon is drawn "
            "from that table and has no cookie of its own to fall back on."
        )
    rows = re.findall(r"'([^']*)'", block.group(1))
    if not rows:
        raise SystemExit("SPR_COOKIE_BIG in web/js/pixels.js has no rows")
    width = len(rows[0])
    if any(len(r) != width for r in rows):
        raise SystemExit("SPR_COOKIE_BIG has rows of differing length")

    ox, oy = COOKIE_AT
    if ox + width > GRID or oy + len(rows) > GRID:
        raise SystemExit(
            f"SPR_COOKIE_BIG is {width}x{len(rows)} and does not fit the {GRID}-cell "
            f"icon grid at {COOKIE_AT}. Shrink it, or re-place it and re-judge the "
            f"icon at 60px -- the margin is what keeps it inside the corner mask."
        )
    return rows


def cookie_cells():
    """The 32x32 grid, as a dict of (x, y) -> colour."""
    ox, oy = COOKIE_AT
    cells = {}
    for y, row in enumerate(read_cookie_sprite()):
        for x, ch in enumerate(row):
            if ch in ". ":
                continue
            colour = PAL.get(ch)
            if colour is None:
                raise SystemExit(
                    f"SPR_COOKIE_BIG uses '{ch}', which web/js/pixels.js has no PAL "
                    f"entry for. The blitter there would skip it and draw a hole; "
                    f"here it would be a silently missing pixel."
                )
            cells[(x + ox, y + oy)] = colour
    return cells


def draw_cookie():
    """The cookie at 32x32, outline and all, on transparency."""
    art = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    for (x, y), colour in cookie_cells().items():
        art.putpixel((x, y), colour + (255,))
    return art


# ---- the ground ------------------------------------------------------------


def radial(size, dark=False, centre=0.44, stops=None):
    """The plum pool everything in this app sits on.

    Per-pixel Python, so it is drawn small and scaled up by anything that needs
    it large: a radial gradient survives that exactly, and the launch image at
    2732 would otherwise be seven million round trips through hypot.
    """
    glow, edge = stops or ((GLOW_DARK, EDGE_DARK) if dark else (GLOW, EDGE))
    img = Image.new("RGB", (size, size))
    px = img.load()
    cx, cy, reach = size * 0.5, size * centre, size * 0.82
    for y in range(size):
        for x in range(size):
            t = min(1.0, math.hypot(x - cx, y - cy) / reach)
            px[x, y] = tuple(round(glow[i] + (edge[i] - glow[i]) * t) for i in range(3))
    return img.convert("RGBA")


def floor(size, tiles=9, alpha=22):
    """The title screen's checkerboard diner floor, at the same 45 degrees.

    Drawn at full resolution rather than scaled, because the tile edges are the
    only crisp thing in the backdrop and a blurred checkerboard reads as dirt.
    """
    tile = max(2, size // tiles)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for row in range(-1, size // tile + 2):
        for col in range(-1, size // tile + 2):
            if (row + col) % 2:
                continue
            x0, y0 = col * tile, row * tile
            d.rectangle([x0, y0, x0 + tile - 1, y0 + tile - 1], fill=NEON + (alpha,))
    return layer.rotate(45, resample=Image.BILINEAR, expand=False)


def ground(size, dark=False):
    """Radial plum, with the checkerboard laid over it."""
    return Image.alpha_composite(radial(size, dark), floor(size))


def bloom(art, radius, strength=1.0):
    glow = art.filter(ImageFilter.GaussianBlur(radius))
    if strength != 1.0:
        glow.putalpha(glow.getchannel("A").point(lambda v: min(255, round(v * strength))))
    return glow


def neon_halo(art, size, strength):
    """The pink the ground gave up, put back as light behind the cookie.

    Two passes, wide and tight, which is how the rest of this game's art gets
    its glow: one broad bloom is a smudge and one tight bloom is an outline,
    and the pair reads as something emitting light.
    """
    silhouette = Image.new("RGBA", art.size, (0, 0, 0, 0))
    silhouette.paste(Image.new("RGBA", art.size, NEON + (255,)), (0, 0), art.getchannel("A"))
    return (
        bloom(silhouette, radius=size // 8, strength=strength * 0.85),
        bloom(silhouette, radius=size // 26, strength=strength),
    )


def corner_mask(size):
    """iOS's rounded square, near enough: radius about 22.4% of the side."""
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(size * 0.2237), fill=255
    )
    return mask


def build_icon(size=1024, dark=False):
    small = draw_cookie()
    art = small.resize((size, size), Image.NEAREST)

    # The asset catalog previews a full square and iOS shows a rounded one, so
    # a cookie with a corner shaved off looks perfect right up until it is on a
    # home screen. Nothing of the cookie may fall outside the mask.
    bitten = Image.composite(
        Image.new("L", (size, size), 0),
        small.getchannel("A").resize((size, size), Image.NEAREST),
        corner_mask(size),
    ).getbbox()
    if bitten:
        raise SystemExit(f"the cookie crosses the iOS corner mask at {bitten}; pull it in.")

    out = ground(size, dark)
    for layer in neon_halo(art, size, 0.7 if dark else 0.95):
        out.alpha_composite(layer)
    out.alpha_composite(art)
    # App icons must be opaque; an alpha channel is rejected at upload.
    return out.convert("RGB")


def build_sheet(icon, dark_icon):
    """Both icons at 180, 120 and 60, masked, each on the wallpaper it is
    actually shown against."""
    sheet = Image.new("RGB", (480, 460), (236, 232, 226))
    ImageDraw.Draw(sheet).rectangle([0, 230, 480, 460], fill=(22, 24, 30))
    for y0, art in ((25, icon), (255, dark_icon)):
        x = 20
        for s in (180, 120, 60):
            sheet.paste(art.resize((s, s), Image.LANCZOS), (x, y0), corner_mask(s))
            x += s + 40
    return sheet


def write_contents(icon_dir):
    """Pair the two files in Contents.json.

    The system derives the tinted icon itself, so two files and two entries is
    the whole of it. Written rather than hand-edited because the dark entry is
    easy to add with the wrong idiom and the failure is silent: iOS simply dims
    the light icon instead.
    """
    contents = {
        "images": [
            {
                "filename": "AppIcon-512@2x.png",
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            },
            {
                "appearances": [{"appearance": "luminosity", "value": "dark"}],
                "filename": "AppIcon-512@2x-dark.png",
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            },
        ],
        "info": {"author": "xcode", "version": 1},
    }
    path = icon_dir / "Contents.json"
    path.write_bytes((json.dumps(contents, indent=2) + "\n").encode())
    return path


def main():
    ap = argparse.ArgumentParser(description="Draw the makemecookies!x4 app icon.")
    ap.add_argument("--sheet", metavar="PNG", help="write a 60/120/180px preview sheet here")
    args = ap.parse_args()

    icon_dir = ASSETS / "AppIcon.appiconset"
    if not icon_dir.is_dir():
        raise SystemExit(f"asset catalog not found: {icon_dir}")

    icon = build_icon()
    icon_path = icon_dir / "AppIcon-512@2x.png"
    icon.save(icon_path)
    print(f"icon     {icon_path.relative_to(REPO)}  {icon.size[0]}x{icon.size[1]}")

    dark_icon = build_icon(dark=True)
    dark_path = icon_dir / "AppIcon-512@2x-dark.png"
    dark_icon.save(dark_path)
    print(f"dark     {dark_path.relative_to(REPO)}  {dark_icon.size[0]}x{dark_icon.size[1]}")

    print(f"catalog  {write_contents(icon_dir).relative_to(REPO)}")

    if args.sheet:
        build_sheet(icon, dark_icon).save(args.sheet)
        print(f"sheet    {args.sheet}")


if __name__ == "__main__":
    main()
