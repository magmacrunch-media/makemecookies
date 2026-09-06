# makemecookies!x4 — Wii port, agent brief

The console version, built on [magnolia](../../../engines/magnolia). `web/` is
still the source of truth for rules and tuning; this is a port of it, and the
job of `tests/test_stations.c` is to keep that true.

Read `../AGENTS.md` first — the no-AI-attribution rule and the reasoning behind
the tuning apply here unchanged.

## What is finished and what is not

**Finished, and verified here:** the rules. `source/stations.c` is a
line-for-line port of `web/js/stations.js`, and `tests/test_stations.c` is the
web suite's cases ported case for case — 78 checks, run by `make test` with
nothing but a C compiler. The port was checked by mutation as well as by
running: seven rules were broken in turn (the belt-entry check, the inspector
freeze, the inspector trigger, the mixer's downgrade, the fire tap count, the
full-box multiplier, dt scaling) and the suite caught all seven.

**Placeholder:** `source/render.c` and `source/main.c`. They compile, they
build a `.dol`, and they run a whole shift — but what is drawn is a diagnostic
view of labelled bays, phase names and two meters. The look it has to grow into
is `web/js/render.js` and `web/js/pixels.js`.

**Absent:** sprites, sound effects, the scoreboard, an attract mode. The
engine offers scoring (`magnolia_init` brings it up already) and none of it is
wired.

**Not run anywhere yet:** this has never been on a console or in Dolphin. It
compiles and its rules are tested; that is a different claim.

## The song cannot be the clock here

This is the one design decision the port could not carry across, and everything
about the shift timing follows from it.

On the web, `js/main.js` reads `music.currentTime` every frame, so the
difficulty ramp and the four RUSH windows stay on the music even when the tab
drops frames. `RUSH_AT` holds *fractions* of the measured duration, and
`st.shiftMs` is read on both `loadedmetadata` and `durationchange` because Ogg
carries no duration header and the browser's first estimate is nine seconds
short.

magnolia offers none of that. `audio_play_music_mem_fmt()` goes to
`ASND_SetInfiniteVoice`, which **loops forever and reports neither a position
nor an end**. It is the same gap that made the web version reject adenosine's
`AdAudio` — except there is no plain `<audio>` element to fall back to.

So the relationship inverts, and for once in the port's favour:

- Raw PCM has an exact duration — byte count over rate — known at build time
  and not estimated by any decoder. `tools/convert-audio.sh` prints it.
- The shift clock is `clock_dt()` accumulated from the frame the voice starts.
- `SHIFT_MS` in `source/config.h` is that constant. It is currently `51248.0`,
  which is the same figure the web suite measured from the ogg — arrived at
  from the bytes rather than from a decoder, and agreeing.

What is **lost** is the web version's self-correction. There, re-encoding the
track moved the RUSH windows automatically. Here a re-encoded `music.pcm` and a
stale `SHIFT_MS` would silently misplace all four windows and end the shift
early — precisely the bug the web version hit when it read the duration once.
So `main.c` derives the real length from the linked bytes at startup and, if
the two have drifted more than 250ms apart, shows the complaint **on the title
card in red** — not through `printf`, which reaches nothing here (see below).
**Do not delete that check**, and if you re-encode the track, read what
`convert-audio.sh` prints.

The music loops rather than ending, so `play_shift()` calls `audio_stop_music()`
when the clock runs out. A shift is over when the clock says so, not when the
song does.

## Memory is a format decision

Clips are decoded in RAM for the whole session and linked into the `.dol`. The
whole 51.2s track:

| Format | Resident |
|---|---|
| 48kHz stereo | ~9.8 MB |
| 24kHz mono | ~2.4 MB |

Against 24MB, the first is survivable but wasteful for a single asset. It ships
at 24kHz mono, which is `convert-audio.sh`'s default, and mono costs almost
nothing on a TV speaker.

This game is unusual in not needing a loop at all — george-boole had to cut a
3m50s piece down to a 60s loop with a crossfaded seam; here the whole track
goes in whole, because the round *is* the track.

## The rules must stay engine-free

`source/stations.c` includes `<string.h>` and `<stdio.h>` and nothing else. No
`grrlib.h`, no `ogc/`, no `magnolia.h`. That is what lets `make test` link it
on any machine with a compiler, and what lets CI run it on a GitHub-hosted
runner with no devkitPPC anywhere.

Keep it. A `GRRLIB_Rectangle` in `stations.c` costs the entire suite, and the
suite is the only thing standing between this port and the browser version
quietly becoming two different games. CI asserts it, the same way the web job
asserts `stations.js` is DOM-free.

The corollary: the input mapping lives in `main.c`, not in `stations.c`, even
though `config.h` declares it. `STATION_BUTTON` holds magnolia's `InputButton`
values and the simulation never sees a button — it is handed a `Station`.

## Dolphin cannot be driven by a script — use `AUTOPILOT`

**Do not spend an afternoon on `SendInput`.** Dolphin's emulated Wiimote reads
the keyboard through DirectInput (`Device = DInput/0/Keyboard Mouse` in
`WiimoteNew.ini`), and DirectInput does not observe injected keystrokes. Neither
`SendInput` nor `keybd_event` reaches the game, from either a foreground or a
background process, and **nothing reports an error** — the keys simply do
nothing.

The mouse is the exception and is what makes this so confusing to diagnose.
`Buttons/A` defaults to `Click 0`, so a synthetic click *does* register: a
script can start a shift and then find that not one of the five stations
responds. That reads exactly like a broken input mapping in the game.

Measured, not assumed: with the shift running, twelve `LEFT` presses — six via
`SendInput` with scancodes, six via `keybd_event` — left `HOPPER` at its
starting `4/6` with `MESS` at zero. A single hopper press would have moved both.

So gameplay is verified with the compile-time hook instead, which is the
pattern magnolia's own template recommends:

```bash
make CFLAGS='-g -O2 -Wall $(MACHDEP) $(INCLUDE) -DAUTOPILOT=1'
```

That skips the title, plays the shift unattended, shows the results for six
seconds and then stops driving. Both timeouts matter: without them the results
card waits for an A press that can never arrive, and `main()` starts a second
shift immediately — which is how a capture ends up showing the *next* shift's
empty scoreboard and getting filed as this one's result. **Returning from
`main()` does not close Dolphin**, so a scripted run still has to close the
emulator itself; measured, it was still up 64s in.

`AUTOPILOT_EVERY` sets the reaction time in frames; see the note in
`source/config.h`.

`AUTOPILOT` defaults to 0 and compiles away entirely — verified by building the
tree twice, once with `AUTOPILOT=0` and once with every `#if AUTOPILOT` block
physically deleted, and comparing: byte-identical (`31f74e0b…`). Note it is
*not* identical to the binary from before the hook landed, and should not be:
the same change fixed the printf bug below, which altered real shipped
behaviour.

A run is reproducible. Two builds of this autopilot, a fortnight of
fiddling apart, both finished 6100 / 20 shipped / 22 perfect.

## printf works, but only since magnolia 0.3.0 — and needs Logger.ini

`printf` reaches Dolphin's log through `SYS_STDIO_Report(true)`, which
`magnolia_init()` calls. Set `OSREPORT = True` and `WriteToFile = True` in
Dolphin's `Logger.ini`; both default to False, which makes a working trace look
like a dead one.

**This was not true when this port was written, and the history is the useful
part.** magnolia did not make that call, so libogc left stdout attached to
nothing and every `printf` in every game on the engine was discarded — measured
as a **0-byte `dolphin.log`** with `OSREPORT`, `OSREPORT_HLE` and `WriteToFile`
all `True`. The engine's own `template/README.md` documented the Logger.ini
half alone, so the advice read as complete and the symptom read as "logging is
off" rather than "nothing was ever sent". It survived three shipped games that
way; `george-boole` had five `printf` calls that had never produced a line.
Fixed in the engine rather than worked around here, and verified: booting
george-boole now logs `run: mode=crumb bits=2 max=3`.

The lesson that outlives the bug: **a diagnostic nobody receives is worse than
none**, because it reads in the source as though the case is handled. The first
version of the `SHIFT_MS` mismatch check was exactly that.

That check stays on the title card even now that logging works, and should: a
re-encoded track is a mistake somebody makes while building, and the person who
needs telling is looking at the screen, not at `dolphin.log`. Use `printf` for
tracing, the screen for anything a person has to act on.

**A clean autopilot run does not mean the game is tuned.** The bot is a perfect
prioritiser — in a full shift it recorded 22 perfect cookies, zero burnt, zero
fires, zero spills and zero inspections. It cannot tell you whether `golden_ms`
is too generous or whether the health inspector ever appears in real play. Only
hands can, which is the same thing `../AGENTS.md` says about the web version's
bot-measured tuning.

Two further traps when capturing a run:

- `SetForegroundWindow` is refused to a background process while another
  application is taking focus, and **the refusal is silent** — the screenshot
  then shows whatever is genuinely in front, which reads as the game having
  rendered it. Pin Dolphin's own window with `SetWindowPos(HWND_TOPMOST)`
  instead, and sanity-check a pixel.
- Dolphin reuses an already-running instance, so kill it between runs or you
  will read the previous run's log and screenshot a binary that is not the one
  you just built.

## Tuning belongs to `web/`, not here

`source/config.h` carries the same numbers as `web/js/config.js` deliberately.
They were bot-measured over full shifts, not hand-measured, and the first pass
had no skill gradient at all. If a Wiimote turns out to need different numbers —
and it may; `ready_ms` and `golden_ms` are the two that decide how much the
mixer and the oven forgive — change them **in both files** and say in the commit
that they were changed in both. Two versions with two balances is two games.

## Building

Host tests need nothing but a compiler:

```bash
make test
```

The console build needs devkitPPC. It **is** installed in WSL on this machine
at `/opt/devkitpro` (devkitPPC 16.1.0, with GRRLIB in `portlibs/wii`), which
the top-level `CLAUDE.md` says twice that it is not — the note is stale.

```bash
export DEVKITPRO=/opt/devkitpro
export DEVKITPPC=/opt/devkitpro/devkitPPC
export PATH=$DEVKITPPC/bin:$DEVKITPRO/tools/bin:$PATH
make            # build/makemecookies.dol
make dolphin    # stage and push to Dolphin's SD folder
```

Call WSL from PowerShell, not Git Bash — MSYS rewrites `/mnt/c/...` arguments
before WSL sees them and the call hangs rather than failing.

### The engine-discovery fix in this Makefile

The `MAGNOLIA` line resolves the engine with
`$(firstword $(wildcard ../../magnolia ../../../engines/magnolia))`. That
wildcard is written against the game directory — but `make` re-invokes itself
with `-C build`, and in that second pass the working directory is one level
deeper, so both candidates miss and the guard fires with the engine sitting
right there.

This Makefile passes the resolved value down:

```make
@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile MAGNOLIA=$(MAGNOLIA)
```

**The same bug is live in george-boole, moonlight-drift and
texas-holdem-lava-dome**, where that line has no `MAGNOLIA=` on it. It has been
latent since the `games\` junctions were removed on 2026-09-03, and it went
unnoticed because the verification recorded for that change was the host tests
— and `make test` is exactly the goal the guard skips. An absolute
`MAGNOLIA=/path` does *not* work around it: the devkitPro rules build include
paths as `$(TOPDIR)/$(dir)`, which only composes with a relative one.
