#!/bin/sh
# Converts the web game's track into the raw PCM magnolia plays, and into a
# memory budget a Wii actually has.
#
#   tools/convert-audio.sh [path-to-web-audio-dir]
#
# Clips are held decoded in main RAM, so the format is a memory decision before
# it is a fidelity one:
#
#   48kHz stereo  ~192 KB/s     24kHz mono  ~48 KB/s
#
# This game is unusual in not needing a loop. A round is exactly one play of
# "makemecookies! x4" -- the track ending is the end-of-shift whistle -- so
# unlike george-boole, whose 3m50s source had to be cut down to a 60s loop,
# the whole 51.2s track goes in whole. At 48kHz stereo that is 9.8MB of the
# console's 24MB, which is survivable but wasteful for one asset; at 24kHz mono
# it is 2.5MB. Mono costs almost nothing on a TV speaker.
#
# THE OUTPUT LENGTH IS THE SHIFT LENGTH. magnolia cannot report a playback
# position, so source/config.h carries SHIFT_MS and main.c derives the real
# figure from the linked bytes and complains if the two disagree. This script
# prints both, so a re-encode that needs a config.h edit says so here first.
set -e

SRC=${1:-"$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)/web/audio"}
OUT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/audio

MUSIC_RATE=${MUSIC_RATE:-24000}
MUSIC_CHANNELS=${MUSIC_CHANNELS:-1}

if [ ! -d "$SRC" ]; then
    echo "error: no audio directory at $SRC" >&2
    echo "  pass the web game's audio/ directory as the first argument." >&2
    exit 1
fi

command -v ffmpeg >/dev/null 2>&1 || { echo "error: ffmpeg not found" >&2; exit 1; }

# The ogg is the original encode; the mp3 beside it is a second-generation
# transcode of it, so this always reads the ogg.
TRACK="$SRC/makemecookies-x4.ogg"
[ -f "$TRACK" ] || { echo "error: no $TRACK" >&2; exit 1; }

mkdir -p "$OUT"

echo "music: whole track, ${MUSIC_RATE}Hz, ${MUSIC_CHANNELS}ch"
ffmpeg -v error -y -i "$TRACK" \
    -f s16le -acodec pcm_s16le -ar "$MUSIC_RATE" -ac "$MUSIC_CHANNELS" \
    "$OUT/music.pcm"

size=$(wc -c < "$OUT/music.pcm")
ms=$(( size * 1000 / (MUSIC_RATE * MUSIC_CHANNELS * 2) ))

echo ""
echo "Resident audio:"
total=0
for f in "$OUT"/*.pcm; do
    [ -f "$f" ] || continue
    s=$(wc -c < "$f")
    total=$((total + s))
    printf "  %-16s %6s KB\n" "$(basename "$f")" "$((s / 1024))"
done
printf "  %-16s %6s KB\n" "TOTAL" "$((total / 1024))"
echo ""
echo "All of this is linked into the .dol and resident for the whole session."
echo "The Wii has 24MB. Keep an eye on the total."
echo ""
echo "music.pcm is ${ms}ms. source/config.h must say:"
echo "    #define SHIFT_MS ${ms}.0"
echo "  and MUSIC_RATE ${MUSIC_RATE}, MUSIC_CHANNELS ${MUSIC_CHANNELS}."
echo "The shift clock, the difficulty ramp and all four RUSH windows come off"
echo "that number. main.c checks it against these bytes at startup and says so"
echo "if they have drifted apart."
