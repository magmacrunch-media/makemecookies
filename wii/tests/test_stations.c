/* =====================================================================
 * test_stations.c -- makemecookies!x4 (Wii) headless tests.
 *
 * source/stations.c is the whole simulation and touches no libogc, no GRRLIB
 * and no drawing -- that separation is deliberate, so the rules can be
 * exercised without a console or an emulator. This links the real shipped
 * translation unit. Nothing here is a reimplementation that could drift from
 * what ships.
 *
 * The checks are ported from web/tests/test-simulation.js, case for case, and
 * that is the point of them: the browser version is the source of truth for
 * rules and tuning, and two versions of one game are only one game for as long
 * as something keeps checking. What this guards, in order of how much it would
 * hurt:
 *
 *  1. The health inspector. The MESS meter filling to 100 freezes the line for
 *     four seconds, and it is the only failure state the game has. In a shift
 *     played competently it never fires, so it is the least-exercised path in
 *     the game and the one most likely to rot unnoticed. Asserted on both
 *     halves: that it triggers, and that the line really is frozen while it
 *     lasts.
 *
 *  2. The cascade. A jammed belt plus a working mixer is supposed to cost a
 *     whole batch, and that only holds if push_on_belt refuses when the entry
 *     is occupied as well as when the belt is full. Without the entry check the
 *     dough silently stacks on itself instead -- the bug looks like nothing at
 *     all, because the count still rises.
 *
 *  3. Neglect degrades rather than blocks. The mixer overmixing, the oven
 *     burning and then catching fire, the hopper spilling when overfilled: each
 *     has a specific consequence, and swapping "degrades" for "blocks" anywhere
 *     turns a recoverable mistake into a dead line.
 *
 *  4. Scoring. The box multiplier is the greed decision the whole packing
 *     station exists for, and RUSH doubling on top of it is what makes the four
 *     windows worth bracing for.
 *
 *  5. Frame-rate independence. Every quantity is scaled by dt. Three step sizes
 *     covering the same wall-clock time must agree -- which matters more here
 *     than in the browser, because a Wii frame is 1/60 on NTSC and 1/50 on PAL
 *     and the same shift has to play the same on both.
 *
 * Run: make test
 * ===================================================================== */

#include <stdio.h>
#include <string.h>
#include <math.h>
#include "stations.h"

/* -- Harness ---------------------------------------------------------
 * The same shape as magnolia's tests/harness.h, reproduced rather than
 * included because the host build links this game's sources alone -- CI runs
 * `make test` from a single checkout with no engine beside it.
 */

static int checks = 0;
static int failures = 0;

static void check(int cond, const char *what) {
    checks++;
    if (!cond) { printf("  FAIL: %s\n", what); failures++; }
}

static void check_int(int got, int want, const char *what) {
    checks++;
    if (got != want) { printf("  FAIL: %s (got %d, want %d)\n", what, got, want); failures++; }
}

static void check_near(double got, double want, double tol, const char *what) {
    checks++;
    if (fabs(got - want) > tol) {
        printf("  FAIL: %s (got %g, want %g +/- %g)\n", what, got, want, tol);
        failures++;
    }
}

static void check_str(const char *got, const char *want, const char *what) {
    checks++;
    if (!got || !want || strcmp(got, want) != 0) {
        printf("  FAIL: %s (got \"%s\", want \"%s\")\n",
               what, got ? got : "(null)", want ? want : "(null)");
        failures++;
    }
}

/* -- Fixtures --------------------------------------------------------
 * `now` starts at 1e6 rather than 0 so that a rule comparing against an
 * uninitialised zero timestamp shows up as a failure instead of passing by
 * accident -- the same reason the web harness arms its shift at 1e6.
 */

#define AT0 1000000.0

static double now;

static void shift(Shift *st)
{
    Tuning T;
    mmc_shift_init(st, 1);          /* seed 1, as the web harness pins it */
    st->shift_ms = SHIFT_MS;
    st->elapsed  = 0.0;
    now = AT0;
    T = mmc_tune(st);
    mmc_arm_shift(st, &T, now);
}

/* Advance `ms` of simulated time in `step`-sized slices. */
static void run_for(Shift *st, double ms, float step)
{
    int i, n = (int)(ms / step);
    for (i = 0; i < n; i++) {
        now += step;
        mmc_update_shift(st, step, now);
    }
}

static void run(Shift *st, double ms) { run_for(st, ms, 33.0f); }

static void press(Shift *st, Station s)
{
    Tuning T = mmc_tune(st);
    mmc_press(st, s, &T, now);
}

/* -- 1. The health inspector ----------------------------------------- */

static void test_inspector(void)
{
    Shift st;
    double fired_at = -1.0;
    int i;
    OvenPhase oven_before;
    float t_before, mess_before;

    printf("the health inspector\n");
    shift(&st);

    /* Overfill the hopper on repeat. Each spill is MESS_SPILL, and the
       SPILL_LOCK_MS lock means this takes a while -- which is the point: the
       inspector is meant to be hard to summon. */
    for (i = 0; i < 400 && fired_at < 0.0; i++) {
        press(&st, S_HOPPER);
        run(&st, 120.0);
        if (st.inspections > 0 && fired_at < 0.0) fired_at = now;
    }

    check(fired_at > 0.0, "crossing 100 mess summons the inspector");
    check_int(st.inspections, 1, "the visit is counted");
    check_near(st.mess, INSPECT_RESET, 0.001, "mess resets to INSPECT_RESET, not to zero");
    check(st.inspect_until > now, "the freeze is still running");

    /* The line must be genuinely frozen, not merely flagged. */
    press(&st, S_HOPPER);
    press(&st, S_MIXER);
    run(&st, 60.0);
    press(&st, S_MIXER);              /* try to get something into the oven */
    st.oven.phase = OVEN_BAKING;      /* plant a tray so there is something to advance */
    st.oven.t     = 0.0f;
    oven_before   = st.oven.phase;
    t_before      = st.oven.t;
    mess_before   = st.mess;

    run(&st, 500.0);
    check_int((int)st.oven.phase, (int)oven_before, "oven does not advance while frozen");
    check_near(st.oven.t, t_before, 0.001, "oven timer does not advance while frozen");
    check_near(st.mess, mess_before, 0.001, "mess does not accrue while frozen");

    /* And it must come back. */
    run(&st, INSPECT_MS + 200.0);
    check(st.oven.t > t_before, "the line resumes once the inspector leaves");
}

/* -- 2. The cascade: a jam must cost a batch, not stack dough --------- */

static void test_cascade(void)
{
    Shift st;
    float before;
    int i, j, distinct;

    printf("the jam cascade\n");

    /* A ball parked at the belt entry blocks the next ejection. */
    shift(&st);
    st.hopper.units = HOPPER_MAX;
    st.belt.items[0].quality = Q_GOOD;
    st.belt.items[0].x       = BELT_X0;
    st.belt.items[0].sticky  = 1;      /* stuck under the mixer */
    st.belt.n = 1;

    before = st.mess;
    for (i = 0; i < 2; i++) {
        st.mixer.phase   = MIX_READY;
        st.mixer.quality = Q_GOOD;
        press(&st, S_MIXER);           /* eject onto a blocked entry */
        st.hopper.units = HOPPER_MAX;
    }
    check_int(st.belt.n, 1, "dough is refused while the entry is blocked");
    check_near(st.mess - before, MESS_SPILL * 2.0f, 0.001,
               "each refused batch costs a spill");

    /* No two items may occupy one place -- the failure the entry check exists
       to prevent looks exactly like nothing at all, because the count rises
       either way. */
    distinct = 1;
    for (i = 0; i < st.belt.n; i++)
        for (j = i + 1; j < st.belt.n; j++)
            if (st.belt.items[i].x == st.belt.items[j].x) distinct = 0;
    check(distinct, "no two items share a position");

    /* A full belt takes no more, whatever the entry looks like. */
    shift(&st);
    for (i = 0; i < BELT_CAP; i++) {
        st.belt.items[i].quality = Q_GOOD;
        st.belt.items[i].x       = BELT_X1 - (float)i * ITEM_GAP;
        st.belt.items[i].sticky  = 0;
    }
    st.belt.n = BELT_CAP;
    before = st.mess;
    st.mixer.phase = MIX_READY;
    st.hopper.units = HOPPER_MAX;
    press(&st, S_MIXER);
    check_int(st.belt.n, BELT_CAP, "a full belt takes no more");
    check_near(st.mess - before, MESS_SPILL, 0.001, "and the batch hits the floor");

    /* The lead ball waits at the mouth while the oven is busy. */
    shift(&st);
    st.belt.items[0].quality = Q_GOOD;
    st.belt.items[0].x       = BELT_X1 - 20.0f;
    st.belt.items[0].sticky  = 0;
    st.belt.n      = 1;
    st.oven.phase  = OVEN_BAKING;
    st.oven.t      = 0.0f;
    run(&st, 800.0);
    check_int(st.belt.n, 1, "the lead ball waits at the mouth for a busy oven");
    check(st.belt.items[0].x <= BELT_X1 + 0.001f, "and does not run past it");
}

/* -- 3. Neglect degrades rather than blocks -------------------------- */

static void test_mixer(void)
{
    Shift st;
    Tuning T;

    printf("the mixer degrades rather than blocks\n");
    shift(&st);
    T = mmc_tune(&st);
    st.hopper.units = 4;

    press(&st, S_MIXER);
    check_int((int)st.mixer.phase, (int)MIX_MIXING, "pressing an idle mixer starts it");
    check_int(st.hopper.units, 4 - HOPPER_PER_MIX, "and consumes flour");

    run(&st, T.mix_ms + 100.0);
    check_int((int)st.mixer.phase, (int)MIX_READY, "it becomes ready on its own");

    run(&st, T.ready_ms + 100.0);
    check_int((int)st.mixer.phase, (int)MIX_OVER, "neglected, it overmixes");
    check_int((int)st.mixer.quality, (int)Q_TOUGH,
              "and the dough is downgraded, not destroyed");

    press(&st, S_MIXER);
    check_int((int)st.mixer.phase, (int)MIX_IDLE, "the overmixed ball still ejects");
    check_int(st.belt.n, 1, "onto the belt");
    check_int((int)st.belt.items[0].quality, (int)Q_TOUGH,
              "carrying its downgrade onto the belt");

    /* A batch cannot be rushed -- that is what makes the mixer the metronome. */
    shift(&st);
    st.hopper.units = 4;
    press(&st, S_MIXER);
    press(&st, S_MIXER);
    check_int((int)st.mixer.phase, (int)MIX_MIXING, "a mixing batch cannot be rushed");
}

static void test_oven(void)
{
    Shift st;
    Tuning T;
    float m0;

    printf("the oven burns, then catches fire\n");
    shift(&st);
    T = mmc_tune(&st);

    st.oven.phase   = OVEN_BAKING;
    st.oven.t       = 0.0f;
    st.oven.quality = Q_GOOD;

    run(&st, T.bake_ms + 100.0);
    check_int((int)st.oven.phase, (int)OVEN_GOLDEN, "the tray turns golden");
    run(&st, T.golden_ms + 100.0);
    check_int((int)st.oven.phase, (int)OVEN_BURNING, "then burns if left");
    run(&st, BURN_TO_FIRE_MS + 100.0);
    check_int((int)st.oven.phase, (int)OVEN_FIRE, "and finally catches fire");

    m0 = st.mess;
    run(&st, 1000.0);
    check_near(st.mess - m0, FIRE_MESS_RATE, 0.5,
               "a fire costs FIRE_MESS_RATE per second");

    /* Three taps inside the window, not two. */
    press(&st, S_OVEN);
    press(&st, S_OVEN);
    check_int((int)st.oven.phase, (int)OVEN_FIRE, "two taps do not put it out");
    press(&st, S_OVEN);
    check_int((int)st.oven.phase, (int)OVEN_EMPTY, "the third does");

    /* It can happen again -- putting a fire out is not immunity. */
    st.oven.phase = OVEN_BURNING;
    st.oven.t     = 0.0f;
    run(&st, BURN_TO_FIRE_MS + 100.0);
    check_int((int)st.oven.phase, (int)OVEN_FIRE, "it can catch fire again");

    /* Taps spread beyond the window do not accumulate. */
    press(&st, S_OVEN);
    run(&st, FIRE_TAP_WINDOW + 200.0);
    press(&st, S_OVEN);
    run(&st, FIRE_TAP_WINDOW + 200.0);
    press(&st, S_OVEN);
    check_int((int)st.oven.phase, (int)OVEN_FIRE,
              "taps spread beyond the window do not count");

    /* Pulling a baking tray early is a panic move that frees the oven. */
    shift(&st);
    st.oven.phase   = OVEN_BAKING;
    st.oven.quality = Q_GOOD;
    press(&st, S_OVEN);
    check_int((int)st.oven.phase, (int)OVEN_EMPTY, "an early pull frees the oven");
    check_int(st.tally.graded[GRADE_RAW], 1, "and yields a raw cookie");

    /* Golden quality carries the mixer's downgrade through. */
    shift(&st);
    st.oven.phase   = OVEN_GOLDEN;
    st.oven.quality = Q_TOUGH;
    press(&st, S_OVEN);
    check_int(st.tally.graded[GRADE_SECONDS], 1, "tough dough bakes into seconds");

    shift(&st);
    st.oven.phase   = OVEN_GOLDEN;
    st.oven.quality = Q_GOOD;
    press(&st, S_OVEN);
    check_int(st.tally.graded[GRADE_PERFECT], 1, "good dough bakes into perfect");
}

static void test_hopper(void)
{
    Shift st;
    float m0;

    printf("the hopper spills when overfilled\n");
    /* Seeded one below the cap, as the web suite does: the spill branch fires
       at HOPPER_MAX - 1 and takes a unit off, so starting at the cap itself
       lands back on the threshold and the check cannot tell a spill from a
       silent cap. */
    shift(&st);
    st.hopper.units = HOPPER_MAX - 1;
    m0 = st.mess;

    press(&st, S_HOPPER);
    check(st.hopper.units < HOPPER_MAX - 1, "overfilling loses flour");
    check_near(st.mess - m0, MESS_SPILL, 0.001, "and makes a mess");

    /* No flour, no batch -- but the station is not broken by it. */
    shift(&st);
    st.hopper.units = 0;
    press(&st, S_MIXER);
    check_int((int)st.mixer.phase, (int)MIX_IDLE, "no flour, no batch");

    st.hopper.units = HOPPER_PER_MIX;
    press(&st, S_MIXER);
    check_int((int)st.mixer.phase, (int)MIX_MIXING, "and it starts again once refilled");

    /* The leak holds off until the player has found the buttons. */
    shift(&st);
    st.elapsed = 0.0;
    st.hopper.units = 4;
    run(&st, 3000.0);
    check_int(st.hopper.units, 4, "the hopper does not leak in the opening third");
}

static void test_tray_overflow(void)
{
    Shift st;
    float m0;
    int i;

    printf("the packing tray overflows\n");
    shift(&st);
    m0 = st.mess;

    for (i = 0; i < TRAY_CAP + 1; i++) {
        st.oven.phase   = OVEN_GOLDEN;
        st.oven.quality = Q_GOOD;
        press(&st, S_OVEN);
    }
    check_int(st.pack.n_tray, TRAY_CAP, "the tray does not overfill");
    check_near(st.mess - m0, MESS_SPILL, 0.001, "the overflow costs a spill");
}

/* -- 4. Scoring ------------------------------------------------------ */

/* Boxes a given tray and returns the shift, so score and shipped can both be
   read off it. */
static void box(Shift *st, const Grade *tray, int n, int rush)
{
    int i;
    shift(st);
    for (i = 0; i < n; i++) st->pack.tray[i] = tray[i];
    st->pack.n_tray = n;
    st->rush = rush ? 0 : -1;
    press(st, S_PACK);
}

static void test_scoring(void)
{
    Shift st;
    const Grade one[]  = { GRADE_PERFECT };
    const Grade three[]= { GRADE_PERFECT, GRADE_PERFECT, GRADE_PERFECT };
    const Grade four[] = { GRADE_PERFECT, GRADE_PERFECT, GRADE_PERFECT, GRADE_PERFECT };
    const Grade mixed[]= { GRADE_PERFECT, GRADE_BURNT };
    const int P = VALUE[GRADE_PERFECT];
    int s1, s3, s4, s4r;

    printf("scoring and the greed decision\n");

    box(&st, one, 1, 0);   s1 = st.score;
    box(&st, three, 3, 0); s3 = st.score;
    box(&st, four, 4, 0);  s4 = st.score;
    box(&st, four, 4, 1);  s4r = st.score;

    check_int(s1, (int)((double)P * BOX_MULT[1] + 0.5),
              "a single cookie pays face value");
    check_int(s4, (int)((double)(P * 4) * BOX_MULT[4] + 0.5),
              "a full box pays the full multiplier");
    check(s4 > s3 * 4 / 3, "a full box beats filling three and shipping early");
    check_int(s4r, (int)((double)(P * 4) * BOX_MULT[4] * RUSH_SCORE + 0.5),
              "RUSH doubles on top of the box multiplier");

    box(&st, mixed, 2, 0);
    check_int(st.shipped, 1, "worthless cookies do not count as shipped");
    check(st.score > 0, "but they do not void the box either");

    check(VALUE[GRADE_SECONDS] > 0 && VALUE[GRADE_SECONDS] < VALUE[GRADE_PERFECT],
          "seconds are worth something, but less than perfect");
    check_int(VALUE[GRADE_RAW], 0, "raw is worth nothing");
    check_int(VALUE[GRADE_BURNT], 0, "burnt is worth nothing");

    /* An empty tray ships nothing rather than scoring zero and burning the
       box cooldown. */
    shift(&st);
    press(&st, S_PACK);
    check_int(st.tally.boxes, 0, "an empty tray does not ship");

    /* The box cooldown holds. */
    shift(&st);
    st.pack.tray[0] = GRADE_PERFECT;
    st.pack.n_tray  = 1;
    press(&st, S_PACK);
    st.pack.tray[0] = GRADE_PERFECT;
    st.pack.n_tray  = 1;
    press(&st, S_PACK);
    check_int(st.tally.boxes, 1, "a second box inside BOX_MS is refused");
}

static void test_bonuses(void)
{
    Shift st;
    const char *label;
    int points = -1;

    printf("end-of-shift bonuses\n");

    shift(&st);
    st.mess = CLEAN_BONUS_THRESHOLD - 1.0f;
    label = mmc_settle_shift(&st, &points);
    check_str(label, CLEAN_BONUS_LABEL, "a spotless shift pays a bonus");
    check_int(points, CLEAN_BONUS_POINTS, "worth CLEAN_BONUS_POINTS");

    shift(&st);
    st.mess = TIDY_BONUS_THRESHOLD - 1.0f;
    label = mmc_settle_shift(&st, &points);
    check_str(label, TIDY_BONUS_LABEL, "a tidy one pays less");
    check_int(points, TIDY_BONUS_POINTS, "worth TIDY_BONUS_POINTS");

    shift(&st);
    st.mess = TIDY_BONUS_THRESHOLD + 1.0f;
    label = mmc_settle_shift(&st, &points);
    check(label == 0, "a filthy one pays nothing");
    check_int(points, 0, "and adds no points");
}

/* -- 5. The ramp, and frame-rate independence ------------------------ */

static void test_ramp(void)
{
    Shift st;
    Tuning a, b, prev, cur;
    int i, monotonic = 1, inside = 1, ordered = 1;

    printf("the difficulty ramp\n");
    shift(&st);

    st.elapsed = 0.0;                a = mmc_tune(&st);
    st.elapsed = st.shift_ms;        b = mmc_tune(&st);

    check(b.mix_ms    < a.mix_ms,    "mix_ms tightens across the shift");
    check(b.ready_ms  < a.ready_ms,  "ready_ms tightens across the shift");
    check(b.bake_ms   < a.bake_ms,   "bake_ms tightens across the shift");
    check(b.golden_ms < a.golden_ms, "golden_ms tightens across the shift");
    check(b.stick_ms  < a.stick_ms,  "stick_ms tightens across the shift");
    check(b.leak_ms   < a.leak_ms,   "leak_ms tightens across the shift");
    check(b.belt_px   > a.belt_px,   "the belt speeds up across the shift");

    st.elapsed = 0.0;
    prev = mmc_tune(&st);
    for (i = 1; i <= 100; i++) {
        st.elapsed = st.shift_ms * i / 100.0;
        cur = mmc_tune(&st);
        if (cur.bake_ms > prev.bake_ms + 0.0001f) monotonic = 0;
        prev = cur;
    }
    check(monotonic, "bake_ms is monotonic across the whole shift");

    /* Progress is clamped, so a shift that overruns its track plateaus rather
       than ramping past the end of the curve. */
    st.elapsed = st.shift_ms * 2.0;
    check_near(mmc_tune(&st).progress, 1.0, 0.0001, "progress clamps at 1");
    st.elapsed = -1000.0;
    check_near(mmc_tune(&st).progress, 0.0, 0.0001, "progress clamps at 0");

    /* Every RUSH window falls inside the shift and none overlaps the next. */
    for (i = 0; i < RUSH_COUNT; i++) {
        double start = RUSH_AT[i];
        double end   = RUSH_AT[i] + RUSH_MS / SHIFT_MS;
        if (start < 0.0 || end > 1.0) inside = 0;
        if (i < RUSH_COUNT - 1 && end >= RUSH_AT[i + 1]) ordered = 0;
    }
    check(inside, "every RUSH window falls inside the shift");
    check(ordered, "RUSH windows do not overlap");
    check_int(RUSH_COUNT, 4, "the song is called x4, so it gets four");
}

static void test_dt_invariance(void)
{
    /* A Wii frame is 1/60 on NTSC and 1/50 on PAL, and a slow frame is longer
       than either. The same wall-clock time must move the belt the same
       distance whichever way it is sliced. */
    static const float steps[3] = { 16.0f, 33.0f, 100.0f };
    float travelled[3];
    int i;

    printf("frame-rate independence\n");

    for (i = 0; i < 3; i++) {
        Shift st;
        shift(&st);
        st.belt.items[0].quality = Q_GOOD;
        st.belt.items[0].x       = BELT_X0;
        st.belt.items[0].sticky  = 0;
        st.belt.n = 1;
        st.belt.next_stick_at = AT0 + 1e9;   /* no jams; this measures travel */
        st.oven.phase = OVEN_BAKING;         /* keep the oven shut so nothing leaves */
        st.oven.t     = 0.0f;

        run_for(&st, 1000.0, steps[i]);
        travelled[i] = st.belt.n ? st.belt.items[0].x - BELT_X0 : -1.0f;
    }

    check_near(travelled[0], travelled[1], 1.5,
               "belt travel agrees between 16ms and 33ms steps");
    check_near(travelled[1], travelled[2], 4.0,
               "belt travel agrees between 33ms and 100ms steps");
}

/* -- 6. The seeded generator -----------------------------------------
 * Not in the web suite, which pins Math.random from outside. Here the
 * generator is part of the state, so it is worth asserting that it really is
 * reproducible -- a jam that moves between runs makes every test above
 * intermittent rather than failing.
 */

static void test_rng(void)
{
    Shift a, b;
    int i, same = 1, in_range = 1;

    printf("the seeded generator\n");
    mmc_shift_init(&a, 1);
    mmc_shift_init(&b, 1);
    for (i = 0; i < 64; i++) {
        double x = mmc_rand(&a), y = mmc_rand(&b);
        if (x != y) same = 0;
        if (x < 0.0 || x >= 1.0) in_range = 0;
    }
    check(same, "one seed gives one sequence");
    check(in_range, "every value falls in [0,1)");

    mmc_shift_init(&b, 2);
    same = 1;
    for (i = 0; i < 8; i++) if (mmc_rand(&a) == mmc_rand(&b)) continue; else same = 0;
    check(!same, "a different seed gives a different sequence");
}

/* -- Results --------------------------------------------------------- */

int main(void)
{
    test_inspector();
    test_cascade();
    test_mixer();
    test_oven();
    test_hopper();
    test_tray_overflow();
    test_scoring();
    test_bonuses();
    test_ramp();
    test_dt_invariance();
    test_rng();

    printf("\n%d checks, %d failures\n", checks, failures);
    return failures ? 1 : 0;
}
