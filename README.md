# makemecookies!x4

A kitsch cookie factory you tend five stations of at once. Flour into the
hopper, dough out of the mixer, along the belt, golden out of the oven, boxed
and shipped — and none of the five machines waits for you.

> one song, one shift

The song is the clock. A round is exactly one play of Jimmi's
"makemecookies! x4." and the track ending is the end-of-shift whistle. There is
no losing: only how much you shipped, and how much mess you left.

## Versions

| | |
|---|---|
| `web/` | Browser version. Built on [adenosine](https://github.com/magmacrunch-media/adenosine) over the Canvas API. Play it at [magmacrunch.com](https://magmacrunch.com/arcade/makemecookies/) |
| `wii/` | Wii homebrew, built on [magnolia](https://github.com/magmacrunch-media/magnolia). **Rules ported and tested; everything you can see is a placeholder.** See `wii/README.md` |

`web/` is the source of truth for rules and tuning. The website repo copies it
into `arcade/makemecookies/` for deployment; its copy is generated and should
never be edited directly.

The second version arrived, which is the reason this repository exists at all.
`wii/source/stations.c` is a line-for-line port of `web/js/stations.js` and
`wii/tests/test_stations.c` is the suite below ported case for case — that
pairing is what keeps two versions of one game from becoming two games. A
tuning change belongs in both `web/js/config.js` and `wii/source/config.h`.

## Playing

Keys `1`–`5` act on the station above them; tapping a station works too, and on
a touch device five buttons appear under the playfield.

| | | |
|---|---|---|
| `1` | HOPPER | Dump a sack of flour. Overfill it and it goes on the floor |
| `2` | MIXER | Press once to start, again to eject. Leave it and the dough toughens |
| `3` | CONVEYOR | Unstick a jam and boost the line |
| `4` | OVEN | Pull the tray golden. Mash to put out a fire |
| `5` | PACKING | Box and ship. Four cookies pays double |

Fill the MESS bar and a health inspector stops the line for four seconds while
the music keeps playing — which, in a round of fixed length, is the only
currency the game has to take from you.

## Running it locally

It is a static page with no build step, but it will **not** run out of a bare
checkout of this repo. `web/index.html` loads `../shared/adenosine-rpg.js`, and
the game loop comes from it — with that script missing, `AdRPG` is undefined
and `js/main.js` throws on its first line. Unlike the score and chat clients,
which degrade quietly, this one is load-bearing.

Serve it from a website checkout instead, where `arcade/shared/` sits beside
the copy:

```
cd ../magmacrunch.com && make sync-makemecookies && python -m http.server 8080
```

Then open <http://localhost:8080/arcade/makemecookies/>. The scoreboard and
chat additionally need their backends running, and fall back to localStorage
and to nothing respectively when those are absent.

The rules do not need any of this — see Tests below, which run on node alone.

## Tests

```
cd web/tests && node test-simulation.js
```

`js/stations.js` holds the rules and touches no DOM at all, which is what makes
this possible: the real shipped modules are loaded into a `vm` context, so
nothing in the suite is a reimplementation that could drift. 59 checks covering
the health inspector, the jam cascade, every station's neglect path, scoring
and dt invariance.

The health inspector is worth singling out. It is the only failure state in the
game and a competent shift never triggers it, so it is the least-exercised path
here and the one most likely to rot unnoticed.

## Built on adenosine

[adenosine](https://github.com/magmacrunch-media/adenosine) is the browser
engine behind the arcade, and this game runs on three of its modules:

| | |
|---|---|
| `AdRPG` | The game loop, the input map, and the started/paused/over state |
| `AdScore` | The leaderboard, talking to the MAGMA//OPS backend |
| `AdChat` | The chat widget on the page |

`AdRPG` is a harness rather than a framework here: `createGameLoop`,
`initInput`, `initCanvas` and four state setters. Nothing in adenosine knows
what a cookie is — every rule lives in `js/stations.js` and every pixel is
drawn by `js/render.js`.

`AdAudio` is the one module deliberately left out. It hardcodes looping and
exposes neither an `ended` event nor a playback position, and a round that *is*
one play of a track needs all three, so the song runs on a plain `<audio>`
element instead. `AGENTS.md` has the detail.

Those three bundles live in the website's `arcade/shared/` and are wired in at
deploy time, which is why `web/index.html` points at `../shared/` — a path that
resolves only once this folder has been copied into the website's `arcade/`.

## Audio

Every clip ships as both `.ogg` and `.mp3`, and `js/main.js` picks between them
at load time. iOS has no Ogg Vorbis decoder and every browser there is WebKit,
so an ogg-only game is not quieter on an iPhone — it is silent. See `AGENTS.md`
before adding or replacing a sound.

## Licence

PolyForm Noncommercial 1.0.0 — see `LICENSE`, and `NOTICE` for what is reserved
outright, the music included.
