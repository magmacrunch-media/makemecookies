#!/usr/bin/env python3
"""Draw the Game Center art: one image per achievement, one per leaderboard.

    python ios/tools/make-boards.py                  # needs Pillow
    python ios/tools/make-boards.py --sheet out.png  # a contact sheet to judge
    python ios/tools/make-boards.py --check          # CI: art still matches

App Store Connect wants **1024 x 1024**, PNG or JPEG, at least 72 ppi, RGB.
An achievement image is **required** and a leaderboard image is optional, so
without this the eight achievements cannot be created at all. 512 is the number
everybody remembers and it is wrong.

## Nothing here is retyped

The ids, their points and their one-line descriptions are parsed out of
`ios/shim/gamekit.js` -- both its `IDS` array and the table in its header, which
are cross-checked against each other. The numbers on the cards come from
`web/js/config.js`: the star thresholds from `STARS`, the box size from
`TRAY_CAP`, the bonus name from `CLEAN_BONUS`, and the three star titles from
`STAR_LABELS`, which is the game's own name for each tier.

That matters more here than for the icon. An id is permanent once created in
App Store Connect, and an image is not compiled, so art claiming a threshold the
game no longer uses is a mistake nothing else in the repo would ever notice.
Tuning `STARS` and forgetting this file now fails the build instead.

The one editorial thing is the achievement titles, and `TITLES` is asserted to
cover exactly the shim's ids: a ninth achievement cannot be added without either
a title or a deliberate decision here.

## Why --check exists, when george-boole's equivalent has none

The PNGs are committed. Drawing them and committing them are two acts where the
script makes it look like one, and george-boole has no detector for the gap.
This compares pixels rather than bytes, the way `make-cookie-pixel.py --check`
does, so a re-encode by a different Pillow is not reported as drift.
"""

import argparse
import importlib.util
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

IOS = Path(__file__).resolve().parent.parent
REPO = IOS.parent
OUT = IOS / "store" / "game-center"

SIZE = 1024

# make-splash.py owns the backdrop, the font loader and the publisher's mark,
# and itself loads make-cookie-pixel.py for the palette. Hyphenated names, so
# both are loaded by path; neither runs anything at import time beyond reading
# the game's own palette.
_spec = importlib.util.spec_from_file_location("splash", IOS / "tools" / "make-splash.py")
splash = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(splash)

cookie = splash.cookie

NEON = splash.NEON            # the title line, as on the launch image
MINT = splash.MINT            # the subtitle
BUTTER = splash.BUTTER        # the points badge
PUBLISHER = splash.PUBLISHER  # the mark, quiet

# Game Center rounds these corners and shows them at several sizes, so nothing
# reaches the edge. Wider than george-boole's cards are allowed to be, because
# these carry short lines.
SAFE_WIDTH = 0.78

# The editorial half. Each is the game's own language, per HOUSE.md: a factory
# game clocks in and ships boxes. The three star tiers are NOT here -- they are
# read from STAR_LABELS, so renaming a tier in the game renames it here.
TITLES = {
    "shipped": "FIRST BOX",
    "rushbox": "RUSH BOX",
    "fullhouse": "FULL HOUSE",
    "spotless": "SPOTLESS",
    "fireout": "FIRE OUT",
}


# ── what the game says ──────────────────────────────────────────────────────


def read_shim():
    """(prefix, leaderboard, [(id, points, description)]) from the shim.

    The header table and the IDS array are read separately and required to
    agree, because they are the two places the shim states the same thing and
    the header is the one a reader trusts.
    """
    text = (IOS / "shim" / "gamekit.js").read_bytes().decode()

    prefix = re.search(r"var PREFIX = '([^']+)'", text)
    board = re.search(r"var LEADERBOARD = PREFIX \+ '([a-z0-9_.]+)'", text)
    ids_block = re.search(r"var IDS = \[(.*?)\];", text, re.S)
    if not (prefix and board and ids_block):
        raise SystemExit("could not read PREFIX, LEADERBOARD or IDS from ios/shim/gamekit.js")

    array_ids = re.findall(r"'([a-z0-9_]+)'", ids_block.group(1))

    # ` *     shipped    10    ship a box`
    table = re.findall(r"^ \*     ([a-z0-9_]+)\s+(\d+)\s{2,}(.+?)\s*$", text, re.M)
    if not table:
        raise SystemExit("could not read the achievement table from the header of gamekit.js")

    table_ids = [row[0] for row in table]
    if table_ids != array_ids:
        raise SystemExit(
            "gamekit.js disagrees with itself about the achievements:\n"
            f"  header table: {table_ids}\n  IDS array:    {array_ids}"
        )

    total = sum(int(p) for _i, p, _d in table)
    if total > 1000:
        raise SystemExit(f"the achievements total {total} points, past the 1000 cap")

    return prefix.group(1), board.group(1), [(i, int(p), d) for i, p, d in table]


def read_config():
    """The numbers the cards state, from the game rather than from here."""
    text = (REPO / "web" / "js" / "config.js").read_bytes().decode()

    stars = re.search(r"const STARS = \[([^\]]+)\]", text)
    tray = re.search(r"const TRAY_CAP = (\d+)", text)
    bonus = re.search(r"const CLEAN_BONUS\s*=\s*\{[^}]*label:\s*'([^']+)'", text)
    labels = re.search(r"const STAR_LABELS = \[([^\]]+)\]", text)
    if not (stars and tray and bonus and labels):
        raise SystemExit("could not read STARS, TRAY_CAP, CLEAN_BONUS or STAR_LABELS from config.js")

    thresholds = [int(n) for n in re.findall(r"\d+", stars.group(1))]
    star_labels = re.findall(r"'([^']*)'", labels.group(1))
    if len(thresholds) != 3:
        raise SystemExit(f"expected 3 star thresholds, found {thresholds}")
    if len(star_labels) != 4:
        raise SystemExit(f"expected 4 STAR_LABELS (zero stars included), found {star_labels}")

    return thresholds, int(tray.group(1)), bonus.group(1), star_labels


# A description may state a small number in words -- "a box of four" reads
# better than "a box of 4" -- so both spellings count as stating it. The check
# is still real: TRAY_CAP moving to 5 matches neither "4" nor "four".
WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
         7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve"}


def states(description, n):
    """Does `description` state the number `n`, as a digit or as a word?"""
    if re.search(rf"\b{n}\b", description):
        return True
    word = WORDS.get(n)
    return bool(word and re.search(rf"\b{word}\b", description, re.I))


def subtitles(rows, thresholds, tray_cap, bonus_label, star_labels):
    """(title, subtitle) per id, with the game's numbers checked into place."""
    out = {}
    for ident, _points, description in rows:
        upper = description.upper()

        if ident in ("star1", "star2", "star3"):
            tier = int(ident[-1])
            need = thresholds[tier - 1]
            # The shim's description states the threshold in words. If tuning
            # moves STARS and the shim is not updated with it, the card would
            # claim a number the game does not use.
            if not states(description, need):
                raise SystemExit(
                    f"{ident}: config.js says {need} cookies, the shim's table says "
                    f'"{description}". Change them together.'
                )
            out[ident] = (star_labels[tier].upper(), f"{need} COOKIES")
            continue

        if ident == "fullhouse" and not states(description, tray_cap):
            raise SystemExit(
                f"fullhouse: TRAY_CAP is {tray_cap}, the shim's table says "
                f'"{description}". Change them together.'
            )
        if ident == "spotless" and bonus_label not in upper:
            raise SystemExit(
                f"spotless: CLEAN_BONUS is {bonus_label!r}, the shim's table says "
                f'"{description}". Change them together.'
            )

        if ident not in TITLES:
            raise SystemExit(
                f"no title for the achievement {ident!r}. Add one to TITLES in this "
                "file, and remember the id is permanent once created."
            )
        out[ident] = (TITLES[ident], upper)

    unused = set(TITLES) - {i for i, _p, _d in rows}
    if unused:
        raise SystemExit(f"TITLES has entries the shim does not report: {sorted(unused)}")
    return out


# ── the images ──────────────────────────────────────────────────────────────


def fit_text(d, text, start, minimum=24):
    """The largest size at which `text` fits inside the safe width."""
    limit = SIZE * SAFE_WIDTH
    size = start
    while size > minimum:
        font = splash.load_font(size)
        if d.textlength(text, font=font) <= limit:
            return font
        size -= 4
    return splash.load_font(minimum)


def card(title, subtitle, badge):
    """One 1024 square: title, subtitle, an optional points badge, the mark."""
    base = cookie.radial(
        max(64, SIZE // 6), centre=0.42, stops=(splash.SPLASH_GLOW, splash.SPLASH_EDGE)
    ).resize((SIZE, SIZE), Image.BICUBIC)
    base = Image.alpha_composite(base, cookie.floor(SIZE, tiles=16, alpha=12))

    art = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)

    title_font = fit_text(d, title, 92)
    sub_font = fit_text(d, subtitle, 34)

    y = 330
    w = d.textlength(title, font=title_font)
    d.text(((SIZE - w) / 2, y), title, font=title_font, fill=NEON)
    y += title_font.size + 54

    w = d.textlength(subtitle, font=sub_font)
    d.text(((SIZE - w) / 2, y), subtitle, font=sub_font, fill=MINT)
    y += sub_font.size + 64

    if badge:
        badge_font = fit_text(d, badge, 30)
        w = d.textlength(badge, font=badge_font)
        d.text(((SIZE - w) / 2, y), badge, font=badge_font, fill=BUTTER)

    out = Image.alpha_composite(base, cookie.bloom(art, radius=SIZE // 90, strength=0.8))
    out = Image.alpha_composite(out, cookie.bloom(art, radius=SIZE // 320, strength=1.0))
    out.alpha_composite(art)

    mark = splash.load_mark()
    if mark is not None:
        height = 92
        scaled = mark.resize(
            (max(1, round(mark.width * height / mark.height)), height), Image.LANCZOS
        )
        faded = scaled.copy()
        faded.putalpha(scaled.getchannel("A").point(lambda v: round(v * 0.5)))
        out.alpha_composite(faded, ((SIZE - scaled.width) // 2, 782))

    # RGB, as the spec asks: an alpha channel here is a rejected upload.
    return out.convert("RGB")


def build_all():
    prefix, board, rows = read_shim()
    thresholds, tray_cap, bonus_label, star_labels = read_config()
    text = subtitles(rows, thresholds, tray_cap, bonus_label, star_labels)

    images = [(f"leaderboards/{board}", card("SHIFT SCORE", "ONE SONG, ONE SHIFT", ""))]
    for ident, points, _description in rows:
        title, subtitle = text[ident]
        images.append((f"achievements/{ident}", card(title, subtitle, f"{points} POINTS")))
    return prefix, images


def contact_sheet(images, columns=5):
    cell = 190
    rows = (len(images) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell, rows * cell), (24, 12, 24))
    for i, (_name, image) in enumerate(images):
        sheet.paste(image.resize((cell - 10, cell - 10), Image.LANCZOS),
                    ((i % columns) * cell + 5, (i // columns) * cell + 5))
    return sheet


def stale(path, fresh):
    """Is the committed PNG not the image `fresh`? Pixels, not bytes.

    The same reasoning as make-cookie-pixel.py's: regenerating and asking git
    fails the moment CI's Pillow encodes an identical image differently, and a
    re-encode that moves no pixel is not drift.
    """
    if not path.exists():
        print(f"{path.relative_to(REPO)} is missing")
        return True
    current = Image.open(path).convert("RGB")
    if current.size != fresh.size or ImageChops.difference(current, fresh).getbbox():
        print(f"{path.relative_to(REPO)} does not match the shim and web/js/config.js")
        return True
    return False


def main():
    ap = argparse.ArgumentParser(description="Draw the makemecookies!x4 Game Center art.")
    ap.add_argument("--sheet", metavar="PNG", help="also write a contact sheet here")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the committed art does not match the game")
    args = ap.parse_args()

    prefix, images = build_all()

    if args.check:
        drifted = 0
        for name, image in images:
            if stale(OUT / f"{name}.png", image):
                drifted += 1
        if drifted:
            raise SystemExit("run: python ios/tools/make-boards.py   and commit the result")
        print(f"{len(images)} Game Center images match the shim and web/js/config.js")
        return

    for folder in ("leaderboards", "achievements"):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    for name, image in images:
        (OUT / f"{name}.png").parent.mkdir(parents=True, exist_ok=True)
        image.save(OUT / f"{name}.png")

    print(f"wrote {len(images)} images to {OUT.relative_to(REPO)}")
    print(f"  ids carry the prefix {prefix}")
    print("  an achievement image is required by App Store Connect; a leaderboard image is not")

    if args.sheet:
        contact_sheet(images).save(args.sheet)
        print(f"  sheet {args.sheet}")


if __name__ == "__main__":
    main()
