/* =====================================================================
 * config.h -- makemecookies!x4 (Wii)
 * Geometry, palette, and every tunable number in one place.
 *
 * A direct port of web/js/config.js. The numbers are deliberately the same
 * ones: the web version is the source of truth for rules and tuning, and a
 * Wii build that quietly drifts to its own balance is two games wearing one
 * name. Where a value differs it is because the console forced it, and it
 * says so on the line.
 *
 * The whole difficulty curve is expressed as [easy, hard] pairs in the RAMP_*
 * constants, lerped by song position. Nothing else in the game reads the clock
 * to decide how hard it should be -- mmc_tune() is the only place that happens.
 * ===================================================================== */
#ifndef CONFIG_H
#define CONFIG_H

/* -- Screen ----------------------------------------------------------
 * The web canvas is 960x420. The Wii's safe area at 640x480 is neither, so
 * the playfield keeps the web's coordinate system and render.c scales it.
 * Keeping the sim in web coordinates is what lets the belt geometry, the bay
 * columns and the tuning transfer without a single number being re-derived.
 */
#define PLAYFIELD_W 960
#define PLAYFIELD_H 420

/* -- Palette ---------------------------------------------------------
 * Kitsch bakery neon, as 0xRRGGBBAA -- the byte order GRRLIB wants, so the
 * renderer never has to shuffle channels.
 */
#define C_DOUGH    0xF2D8A7FF
#define C_FROSTING 0xFF5FA2FF
#define C_SPRINKLE 0x41E8D1FF
#define C_BUTTER   0xFFC93CFF
#define C_CHOC     0x4B2E1EFF
#define C_BURNT    0x2A1A12FF
#define C_NEON     0xFF2E9CFF
#define C_BG       0x180C18FF
#define C_PANEL    0x26122AFF
#define C_TILE     0x34163AFF
#define C_STEEL    0x8E7B96FF
#define C_STEEL_LO 0x5C4C64FF
#define C_DANGER   0xFF3B3BFF
#define C_OK       0x41E8D1FF
#define C_WARN     0xFFC93CFF

/* -- Stations --------------------------------------------------------
 * Order matches BAYS below and the PRESS dispatch in stations.c.
 */
typedef enum {
    S_HOPPER = 0,
    S_MIXER,
    S_BELT,
    S_OVEN,
    S_PACK,
    S_COUNT
} Station;

/* x/w are the playfield columns each station owns. The neon frame, the
   urgency meter and the button glyph are all drawn from these, so moving a
   station is a one-line edit here. */
typedef struct {
    const char   *name;
    int           x, w;
    unsigned int  color;
} Bay;

extern const Bay BAYS[S_COUNT];

#define FLOOR_Y 300   /* top of the checkerboard floor */
#define BELT_Y  250   /* top of the belt surface */

/* -- Belt geometry --------------------------------------------------- */
#define BELT_X0  348.0f   /* where the mixer drops dough */
#define BELT_X1  604.0f   /* the oven mouth */
#define ITEM_GAP  34.0f   /* minimum spacing; a stuck item blocks at this range */
#define BELT_CAP  5

/* -- Hopper ---------------------------------------------------------- */
#define HOPPER_MAX       6
#define HOPPER_PER_SACK  2
#define HOPPER_PER_MIX   2
#define POUR_MS        350.0
#define SPILL_LOCK_MS  700.0

/* -- Oven ------------------------------------------------------------ */
#define BURN_TO_FIRE_MS 2500.0f
#define FIRE_TAPS          3      /* taps of the oven button needed... */
#define FIRE_TAP_WINDOW 2000.0    /* ...within this window, to put it out */
#define FIRE_MESS_RATE    12.0f   /* mess per second while burning */

/* -- Packing --------------------------------------------------------- */
#define TRAY_CAP 4
#define BOX_MS   500.0
/* Indexed by cookie count. Holding for the full box is worth double a single
   -- which is the whole reason the greed decision has teeth. */
extern const float BOX_MULT[TRAY_CAP + 1];

/* -- Values and mess ------------------------------------------------- */
typedef enum {
    GRADE_PERFECT = 0,
    GRADE_SECONDS,
    GRADE_RAW,
    GRADE_BURNT,
    GRADE_COUNT
} Grade;

extern const int VALUE[GRADE_COUNT];   /* perfect 100, seconds 45, raw 0, burnt 0 */

#define MESS_SPILL    8.0f   /* dough or cookies on the floor */
#define MESS_BURNT    5.0f   /* a tray of charcoal */
#define MESS_FIRE_OUT 5.0f   /* the extinguisher makes its own mess */
#define MESS_MAX    100.0f

#define INSPECT_MS    4000.0
#define INSPECT_RESET   50.0f

/* -- The ramp --------------------------------------------------------
 * [easy, hard]. Lerped by smoothstep of song position: a slow open, a punchy
 * middle, and a plateau at the end so the last seconds are survivable rather
 * than a coin flip.
 *
 * These replaced a much slower first pass that turned out to have no skill
 * gradient at all: a simulated player reacting in 700ms scored the same as one
 * reacting in 140ms, because the line is strictly serial and the oven capped
 * throughput at ~13 cookies with the player idle in between. Halving the cycle
 * times and tripling belt speed makes the action windows comparable to a human
 * reaction budget, so the stations start competing for attention. Measured over
 * a full shift: 29 cookies at 140ms down to 12 at 700ms.
 *
 * Tune against real hands from here -- ready_ms and golden_ms are the two that
 * decide how much the mixer and the oven forgive. A Wiimote is not a keyboard,
 * so these are the first numbers to suspect if the port plays meaner than the
 * browser version; change them here, and change them in web/js/config.js too
 * or the two versions stop being the same game.
 */
#define RAMP_MIX_MS_EASY    1800.0f
#define RAMP_MIX_MS_HARD     900.0f
#define RAMP_READY_MS_EASY  2400.0f
#define RAMP_READY_MS_HARD   900.0f
#define RAMP_BAKE_MS_EASY   2000.0f
#define RAMP_BAKE_MS_HARD   1100.0f
#define RAMP_GOLDEN_MS_EASY 1800.0f
#define RAMP_GOLDEN_MS_HARD  700.0f
#define RAMP_BELT_PX_EASY    120.0f   /* px/sec */
#define RAMP_BELT_PX_HARD    240.0f
#define RAMP_STICK_MS_EASY  7000.0f
#define RAMP_STICK_MS_HARD  3000.0f
#define RAMP_LEAK_MS_EASY   6000.0f
#define RAMP_LEAK_MS_HARD   2600.0f

/* The hopper only starts leaking a third of the way in -- before that the
   player is still learning which button is which. */
#define LEAK_STARTS_AT 0.35f

/* -- Rush windows ----------------------------------------------------
 * The song is called makemecookies! x4, so it gets four. These are fractions
 * of the shift length rather than absolute times, so they stay on the music if
 * the track is ever re-encoded or re-trimmed.
 */
#define RUSH_COUNT 4
extern const float RUSH_AT[RUSH_COUNT];
#define RUSH_MS    3500.0
#define RUSH_BELT     1.35f
#define RUSH_SCORE       2

/* -- End-of-shift bonuses -------------------------------------------- */
#define CLEAN_BONUS_THRESHOLD 20.0f
#define CLEAN_BONUS_POINTS      500
#define CLEAN_BONUS_LABEL   "SPOTLESS"
#define TIDY_BONUS_THRESHOLD  50.0f
#define TIDY_BONUS_POINTS       250
#define TIDY_BONUS_LABEL       "TIDY"

/* -- The shift clock -------------------------------------------------
 * On the web the song IS the clock: main.js reads music.currentTime, and the
 * length comes from the browser on `durationchange` because Ogg carries no
 * duration header.
 *
 * None of that is available here. magnolia plays music through
 * ASND_SetInfiniteVoice, which loops forever and reports neither a position
 * nor an end. But raw PCM does not need to be asked: its duration is exactly
 * its byte count over its rate, known at build time and not estimated. So the
 * clock runs off clock_elapsed() started with the voice, and the length below
 * is derived rather than measured.
 *
 * Keep this in step with audio/music.pcm. tools/convert-audio.sh prints the
 * number it produced, and main.c asserts the two agree at startup rather than
 * letting a re-encoded track silently move all four RUSH windows.
 *
 *   51.248s * 24000 Hz * 1 channel * 2 bytes = 2459904 bytes
 */
#define MUSIC_RATE     24000          /* Hz, mono -- see tools/convert-audio.sh */
#define MUSIC_CHANNELS     1
#define SHIFT_MS     51248.0          /* what web/tests measured from the ogg */

/* -- Input -----------------------------------------------------------
 * Five stations need five instant actions, because the whole tension of the
 * game is switching attention between them under time pressure. Anything that
 * costs two presses to reach a station -- a cursor, a modifier -- spends that
 * tension rather than testing it.
 *
 * Held sideways, a Wiimote gives the D-pad to the left thumb and 1/2 to the
 * right. So the line is split across the hands in the order it appears on
 * screen: the left hand takes the front of the line, the right hand the back.
 *
 *   HOPPER    D-pad Left      MIXER  D-pad Up      CONVEYOR  D-pad Down
 *   OVEN      button 1        PACKING  button 2
 *
 * Indexed by Station, so re-mapping is this array and nothing else.
 */
extern const int STATION_BUTTON[S_COUNT];

/* Glyphs for the same, drawn under each bay where the web version draws its
   number key. */
extern const char *const STATION_GLYPH[S_COUNT];

/* -- Autopilot -------------------------------------------------------
 * Plays the shift itself, with no controller attached. Set to 1, rebuild, and
 * the title screen is skipped and the line runs unattended to the results
 * card.
 *
 * This is here because on this machine there is no other way to see gameplay.
 * Dolphin's emulated Wiimote reads the keyboard through DirectInput, which
 * does not observe injected keystrokes, so no script can press the five
 * stations -- see the note in AGENTS.md, which is worth reading before
 * spending an afternoon on SendInput. magnolia's own template recommends a
 * compile-time hook for exactly this reason.
 *
 * It is guarded rather than deleted because "does it still run on hardware"
 * is a question worth being able to answer in two minutes, and because the
 * web version's tuning was arrived at by simulating full shifts rather than
 * by playing them -- the same method wants the same tool here.
 *
 * AUTOPILOT_EVERY is how many frames pass between decisions, which is this
 * bot's whole notion of skill: at 60fps, 6 frames is a 100ms reaction and 42
 * is 700ms. The web version measured 29 cookies at 140ms against 12 at 700ms,
 * so a build here that shows no gap between those two settings means the ramp
 * has lost its skill gradient -- which is precisely what the first pass of
 * the tuning did, and what nobody noticed until it was measured.
 *
 * WHAT IT CANNOT TELL YOU: it is a perfect prioritiser. It never burns a tray,
 * never overfills the hopper and never summons the health inspector, so a
 * clean autopilot run says nothing about whether goldenMs is too generous or
 * whether the inspector ever appears in real play. Only hands can. Treat a
 * green autopilot run as "the port works", never as "the game is tuned".
 *
 * Guarded with #ifndef so a build can override it without editing this file:
 *   make CFLAGS="-g -O2 -Wall \$(MACHDEP) \$(INCLUDE) -DAUTOPILOT=1"
 */
#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef AUTOPILOT_EVERY
#define AUTOPILOT_EVERY 6        /* frames between decisions; 6 ~= 100ms at 60fps */
#endif

#endif
