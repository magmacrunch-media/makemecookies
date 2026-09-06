/* =====================================================================
 * stations.h -- makemecookies!x4 (Wii)
 * The five machines and the item flow between them.
 *
 * A port of web/js/stations.js, and deliberately the same shape: everything
 * here is a function of (state, tuning, dt), with no libogc, no GRRLIB, no
 * audio and no drawing anywhere in the translation unit. That is what lets
 * tests/test_stations.c link the real shipped rules on the host machine
 * instead of reimplementing them, exactly as the web suite loads the real
 * modules into a vm context.
 *
 * Keep it. A GRRLIB call in stations.c costs the entire suite, and the suite
 * is the only thing standing between this port and the browser version
 * quietly becoming two different games.
 *
 * Visual effects are pushed onto st->fx as plain data for render.c to read --
 * never drawn from here.
 * ===================================================================== */
#ifndef STATIONS_H
#define STATIONS_H

#include "config.h"

/* -- Item qualities and phases --------------------------------------- */

typedef enum { Q_GOOD = 0, Q_TOUGH } Quality;

typedef enum { MIX_IDLE = 0, MIX_MIXING, MIX_READY, MIX_OVER } MixerPhase;

typedef enum { OVEN_EMPTY = 0, OVEN_BAKING, OVEN_GOLDEN, OVEN_BURNING, OVEN_FIRE }
    OvenPhase;

/* -- Effects, as data ------------------------------------------------
 * The web version pushes onto growable arrays. Fixed caps here: the Wii has
 * no business calling malloc sixty times a second, and an effect that cannot
 * be shown is a dropped sparkle rather than a dropped rule. Oldest is evicted
 * when full, so a burst shows its most recent members.
 */
#define FX_SPILLS_MAX 12
#define FX_POPS_MAX   12
#define FLYING_MAX     6
#define POP_TEXT_MAX  16

typedef struct { float x, y, t; } Spill;
typedef struct { char text[POP_TEXT_MAX]; float x, y, born; unsigned int color; } Pop;
typedef struct { float x, t; } Flying;
typedef struct { char text[24]; unsigned int color; float t; int active; } Toast;

typedef struct {
    Spill spills[FX_SPILLS_MAX];  int n_spills;
    Pop   pops[FX_POPS_MAX];      int n_pops;
    Toast toast;
    float shake;
} Fx;

/* -- The belt -------------------------------------------------------- */

typedef struct {
    Quality quality;
    float   x;
    int     sticky;
} BeltItem;

/* -- Counters for a playtest report ----------------------------------
 * Plain numbers, so stations.c stays free of anything that would cost it the
 * host suite. What these are for: `overmixed` says whether ready_ms is too
 * tight, `burnt` says the same of golden_ms, and both are things a bot cannot
 * tell you about real hands.
 */
typedef struct {
    int   graded[GRADE_COUNT];   /* indexed by Grade */
    int   overmixed, spills, jams, boxes, fires;
    float fire_ms, peak_mess;
} Tally;

/* -- The shift ------------------------------------------------------- */

typedef struct {
    /* clock -- written by main.c from the shift timer */
    double elapsed;
    double shift_ms;
    double started_at;
    int    rush;                 /* index into RUSH_AT, or -1 */

    /* outcome */
    int    score;
    int    shipped;
    float  mess;
    double inspect_until;
    int    inspections;

    struct { int units; double lock_until; double next_leak_at; } hopper;
    struct { MixerPhase phase; float t; Quality quality; } mixer;
    struct {
        BeltItem items[BELT_CAP];
        int      n;
        double   boost_until;
        double   next_stick_at;
    } belt;
    struct {
        OvenPhase phase; float t; Quality quality;
        double taps[FIRE_TAPS]; int n_taps;
    } oven;
    struct {
        Grade  tray[TRAY_CAP]; int n_tray;
        double box_until;
        Flying flying[FLYING_MAX]; int n_flying;
    } pack;

    Fx    fx;
    Tally tally;

    /* Jam placement is random. The web version calls Math.random(), which the
       test harness replaces with a seeded mulberry32 so a jam lands in the
       same place every run. There is nothing to replace here, so the generator
       lives in the state: the simulation stays a pure function of what it is
       handed, and a test seeds it by assignment. */
    unsigned int rng;
} Shift;

/* -- Tuning ----------------------------------------------------------
 * Every timing the simulation needs, resolved for right now. Computed once per
 * frame and passed down -- no station reads the clock.
 */
typedef struct {
    float mix_ms, ready_ms, bake_ms, golden_ms, belt_px, stick_ms, leak_ms;
    float progress;
} Tuning;

Tuning mmc_tune(const Shift *st);

/* -- Lifecycle ------------------------------------------------------- */

void mmc_shift_init(Shift *st, unsigned int seed);
/* Called once when the shift starts, after shift_ms is known. */
void mmc_arm_shift(Shift *st, const Tuning *T, double now);

/* Advances one step. `dt_ms` is the step, `now` the absolute clock in ms.
   Returns the tuning it resolved, which render.c reads for urgency meters. */
Tuning mmc_update_shift(Shift *st, float dt_ms, double now);

/* Acts on one station. Safe for any Station value. */
void mmc_press(Shift *st, Station s, const Tuning *T, double now);

/* Final scoring. Returns the bonus label applied and its points, or NULL and
   zero when the shift was too messy to earn one. */
const char *mmc_settle_shift(Shift *st, int *points_out);

/* -- Interpolation, exposed for the tests and the renderer ----------- */
float mmc_smoothstep(float t);
float mmc_lerp(float a, float b, float t);
float mmc_clamp01(float v);

/* The seeded generator, in [0,1). Exposed so a test can assert that a fixed
   seed really does reproduce a fixed jam. */
double mmc_rand(Shift *st);

#endif
