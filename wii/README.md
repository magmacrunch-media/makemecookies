# makemecookies!x4 — Wii

The console version, built on [magnolia](https://github.com/magmacrunch-media/magnolia).

> one song, one shift

`../web/` is the source of truth for rules and tuning. This is a port of it,
and `tests/test_stations.c` is what keeps the two from drifting apart.

## State of it

The **rules are ported and tested**. `source/stations.c` is a line-for-line
port of `web/js/stations.js`, and `make test` runs the web suite's cases ported
case for case.

Everything you can see is a **placeholder**. `source/render.c` draws labelled
bays, phase names and two meters — enough to watch the simulation run, and not
the game. It has not been on a console yet.

## Layout

```
wii/
├── Makefile
├── meta.xml          Homebrew Channel entry
├── source/
│   ├── config.h      geometry, palette, and every tunable number
│   ├── stations.c    the five machines — the whole simulation
│   ├── render.c      draws state, decides nothing (placeholder)
│   └── main.c        the engine, the clock, the controller, the song
├── tests/            host tests, no console and no cross-compiler needed
├── tools/            audio conversion from the web game's ogg
├── sprites/          PNGs, embedded into the binary by bin2s (empty so far)
└── audio/            raw PCM, embedded by bin2s
```

## Playing

Hold the Wiimote **sideways**. Five stations, five buttons, one press each.

| | | |
|---|---|---|
| `◄` | HOPPER | Dump a sack of flour. Overfill it and it goes on the floor |
| `▲` | MIXER | Press once to start, again to eject. Leave it and the dough toughens |
| `▼` | CONVEYOR | Unstick a jam and boost the line |
| `1` | OVEN | Pull the tray golden. Mash to put out a fire |
| `2` | PACKING | Box and ship. Four cookies pays double |

Fill the MESS bar and a health inspector stops the line for four seconds while
the music keeps playing — which, in a round of fixed length, is the only
currency the game has to take from you.

The left hand takes the front of the production line and the right hand the
back, in the order the stations appear on screen. Nothing costs two presses to
reach: switching attention between five machines under time pressure is the
game, so spending a press on selecting a station would spend the tension rather
than test it.

## Tests

```bash
make test
```

78 checks covering the health inspector, the jam cascade, every station's
neglect path, scoring, the difficulty ramp and frame-rate independence. No
console, no emulator, and no cross-compiler — `source/stations.c` is free of
libogc and GRRLIB, which is what makes that possible and why it has to stay
that way.

The health inspector is worth singling out, for the same reason it is in the
web version: it is the only failure state in the game and a competent shift
never triggers it, so it is the least-exercised path here and the one most
likely to rot unnoticed.

Frame-rate independence matters more here than in the browser. A Wii frame is
1/60 on NTSC and 1/50 on PAL, and the same shift has to play the same on both.

## Building

```bash
export DEVKITPRO=/opt/devkitpro
export DEVKITPPC=/opt/devkitpro/devkitPPC
export PATH=$DEVKITPPC/bin:$PATH

make            # build/makemecookies.dol
make deploy     # stage sdcard/apps/makemecookies/
make dolphin    # push that to the folder Dolphin reads as its SD card
```

`make dolphin` clears the app directory rather than merging, so **saved scores
and settings are deleted on every deploy**. That is right for a dev loop and
wrong to mistake for the game failing to save.

The engine is expected at `../../magnolia` or `../../../engines/magnolia`;
override with `make MAGNOLIA=<path>`.

## Onto a real Wii

```bash
make card SD=/mnt/e             # install onto an SD card (permanent, merges)
make wii  WIILOAD=tcp:<wii-ip>  # send this build to a running console
```

`make card` needs the card's mount point because a removable drive's letter
moves — a card showing as `E:` in Windows is `/mnt/e` in WSL. Unlike
`make dolphin` it merges, so saves on the card survive an update.

`make wii` sends the `.dol` over the network and runs it immediately without
installing anything. The console has to be sitting on the Homebrew Channel's
netloader screen — open the channel and press Home — and it prints its own IP
address there.

## Audio

The song is not background music; it is the round. A shift is exactly one play
of the track, and the track's length is the shift's length.

```bash
tools/convert-audio.sh
```

That reads `../web/audio/makemecookies-x4.ogg` and writes `audio/music.pcm` at
24kHz mono — 2.4MB, resident for the whole session, linked into the `.dol`. At
48kHz stereo the same 51.2s would be 9.8MB of the console's 24MB, which is a
lot to spend on one asset.

The script prints the exact millisecond length and the `SHIFT_MS` line that
`source/config.h` must carry, because magnolia cannot report a playback
position and the shift clock is derived rather than read. `main.c` checks the
two against each other at startup. See `AGENTS.md` before replacing the track.

## Licence

PolyForm Noncommercial 1.0.0 — see `../LICENSE`, and `../NOTICE` for what is
reserved outright, the music included.
