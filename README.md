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
| `web/` | Browser version. Vanilla JS over the Canvas API. Play it at [magmacrunch.com](https://magmacrunch.com/arcade/makemecookies/) |

`web/` is the source of truth for rules and tuning. The website repo copies it
into `arcade/makemecookies/` for deployment; its copy is generated and should
never be edited directly.

There is no second version yet. If one arrives it goes beside `web/` here,
which is the reason this repository exists at all.

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

It is a static page with no build step:

```
cd web && python -m http.server 8080
```

Then open <http://localhost:8080/>. The scoreboard and chat come from the
website's shared bundles in `../shared/`, which only resolve once `web/` has
been copied into the website's `arcade/` — locally they fail quietly and the
game plays without them.

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

## Audio

Every clip ships as both `.ogg` and `.mp3`, and `js/main.js` picks between them
at load time. iOS has no Ogg Vorbis decoder and every browser there is WebKit,
so an ogg-only game is not quieter on an iPhone — it is silent. See `AGENTS.md`
before adding or replacing a sound.

## Licence

PolyForm Noncommercial 1.0.0 — see `LICENSE`, and `NOTICE` for what is reserved
outright, the music included.
