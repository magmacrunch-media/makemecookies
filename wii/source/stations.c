/* =====================================================================
 * stations.c -- makemecookies!x4 (Wii)
 *
 * A line-for-line port of web/js/stations.js. Where the two differ it is
 * because C has no growable arrays and no string-keyed objects, never because
 * a rule was reconsidered: the browser version is the source of truth for
 * rules and tuning, and tests/test_stations.c is the check that this one still
 * agrees with it.
 *
 * No libogc, no GRRLIB, no drawing. See stations.h for why that matters.
 * ===================================================================== */

#include <string.h>
#include <stdio.h>
#include "stations.h"

/* -- Tables ----------------------------------------------------------
 * Defined here rather than in main.c so the host tests, which link only this
 * translation unit, get them too.
 */

const Bay BAYS[S_COUNT] = {
    { "HOPPER",    20, 150, C_DOUGH    },
    { "MIXER",    178, 152, C_FROSTING },
    { "CONVEYOR", 338, 282, C_SPRINKLE },
    { "OVEN",     628, 162, C_BUTTER   },
    { "PACKING",  798, 142, C_NEON     },
};

/* Index by cookie count; [0] is unused and present so the array indexes
   directly by tray length the way the web version's BOX_MULT does. */
const float BOX_MULT[TRAY_CAP + 1] = { 0.0f, 1.0f, 1.2f, 1.5f, 2.0f };

const int VALUE[GRADE_COUNT] = { 100, 45, 0, 0 };   /* perfect, seconds, raw, burnt */

const float RUSH_AT[RUSH_COUNT] = { 0.18f, 0.38f, 0.60f, 0.82f };

/* -- Small helpers --------------------------------------------------- */

float mmc_clamp01(float v)              { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }
float mmc_smoothstep(float t)           { return t * t * (3.0f - 2.0f * t); }
float mmc_lerp(float a, float b, float t) { return a + (b - a) * t; }

static float fmaxf_(float a, float b) { return a > b ? a : b; }
static float fminf_(float a, float b) { return a < b ? a : b; }
static int   imax_(int a, int b)      { return a > b ? a : b; }
static int   imin_(int a, int b)      { return a < b ? a : b; }

/* mulberry32, the same generator the web test harness pins Math.random to.
   Reproduced rather than reached for so that a seeded run here and a seeded
   run there place a jam identically -- which is what makes the cascade test
   comparable across the two versions. */
double mmc_rand(Shift *st)
{
    unsigned int a = (st->rng += 0x6D2B79F5u);
    unsigned int t = a ^ (a >> 15);
    t *= 1u | a;
    t ^= t + (unsigned int)((unsigned long long)(t ^ (t >> 7)) * (unsigned long long)(61u | t));
    return (t ^ (t >> 14)) / 4294967296.0;
}

/* -- Tuning ---------------------------------------------------------- */

Tuning mmc_tune(const Shift *st)
{
    Tuning T;
    float t = mmc_smoothstep(mmc_clamp01((float)(st->elapsed / st->shift_ms)));

    T.mix_ms    = mmc_lerp(RAMP_MIX_MS_EASY,    RAMP_MIX_MS_HARD,    t);
    T.ready_ms  = mmc_lerp(RAMP_READY_MS_EASY,  RAMP_READY_MS_HARD,  t);
    T.bake_ms   = mmc_lerp(RAMP_BAKE_MS_EASY,   RAMP_BAKE_MS_HARD,   t);
    T.golden_ms = mmc_lerp(RAMP_GOLDEN_MS_EASY, RAMP_GOLDEN_MS_HARD, t);
    T.belt_px   = mmc_lerp(RAMP_BELT_PX_EASY,   RAMP_BELT_PX_HARD,   t);
    T.stick_ms  = mmc_lerp(RAMP_STICK_MS_EASY,  RAMP_STICK_MS_HARD,  t);
    T.leak_ms   = mmc_lerp(RAMP_LEAK_MS_EASY,   RAMP_LEAK_MS_HARD,   t);

    if (st->rush >= 0) T.belt_px *= RUSH_BELT;
    T.progress = t;
    return T;
}

/* -- Lifecycle ------------------------------------------------------- */

void mmc_shift_init(Shift *st, unsigned int seed)
{
    memset(st, 0, sizeof(*st));
    st->shift_ms      = SHIFT_MS;
    st->rush          = -1;
    st->hopper.units  = 4;
    st->mixer.phase   = MIX_IDLE;
    st->mixer.quality = Q_GOOD;
    st->oven.phase    = OVEN_EMPTY;
    st->oven.quality  = Q_GOOD;
    st->rng           = seed;
}

void mmc_arm_shift(Shift *st, const Tuning *T, double now)
{
    st->started_at         = now;
    st->belt.next_stick_at = now + T->stick_ms;
    st->hopper.next_leak_at = 0.0;
}

/* -- fx helpers (data only) ------------------------------------------
 * Each pushes onto a fixed array, evicting the oldest when full. A dropped
 * sparkle is a cosmetic loss; the rule that queued it has already run.
 */

static void pop(Shift *st, const char *text, float x, float y, unsigned int color)
{
    Pop *p;
    if (st->fx.n_pops >= FX_POPS_MAX) {
        memmove(&st->fx.pops[0], &st->fx.pops[1], sizeof(Pop) * (FX_POPS_MAX - 1));
        st->fx.n_pops = FX_POPS_MAX - 1;
    }
    p = &st->fx.pops[st->fx.n_pops++];
    snprintf(p->text, POP_TEXT_MAX, "%s", text);
    p->x = x; p->y = y; p->born = 0.0f; p->color = color;
}

static void toast(Shift *st, const char *text, unsigned int color)
{
    snprintf(st->fx.toast.text, sizeof(st->fx.toast.text), "%s", text);
    st->fx.toast.color  = color;
    st->fx.toast.t      = 0.0f;
    st->fx.toast.active = 1;
}

static void add_mess(Shift *st, float amount)
{
    st->mess = fminf_(MESS_MAX + 1.0f, st->mess + amount);
}

static void spill(Shift *st, float x, float y, float amount)
{
    Spill *s;
    st->tally.spills++;
    if (st->fx.n_spills >= FX_SPILLS_MAX) {
        memmove(&st->fx.spills[0], &st->fx.spills[1], sizeof(Spill) * (FX_SPILLS_MAX - 1));
        st->fx.n_spills = FX_SPILLS_MAX - 1;
    }
    s = &st->fx.spills[st->fx.n_spills++];
    s->x = x; s->y = y; s->t = 0.0f;
    st->fx.shake = fmaxf_(st->fx.shake, 6.0f);
    add_mess(st, amount);
}

/* -- 1 . HOPPER ------------------------------------------------------ */

static void press_hopper(Shift *st, const Tuning *T, double now)
{
    (void)T;
    if (now < st->hopper.lock_until) return;

    /* Mashing the hopper is not free. At 5 or 6 units the sack goes over the
       side. */
    if (st->hopper.units >= HOPPER_MAX - 1) {
        st->hopper.units      = imax_(0, st->hopper.units - 1);
        st->hopper.lock_until = now + SPILL_LOCK_MS;
        spill(st, (float)BAYS[S_HOPPER].x + 60.0f, (float)FLOOR_Y, MESS_SPILL);
        toast(st, "FLOUR EVERYWHERE", C_DANGER);
        return;
    }

    st->hopper.units      = imin_(HOPPER_MAX, st->hopper.units + HOPPER_PER_SACK);
    st->hopper.lock_until = now + POUR_MS;
}

static void update_hopper(Shift *st, const Tuning *T, float dt_ms, double now)
{
    (void)dt_ms;
    if (T->progress < LEAK_STARTS_AT) return;

    /* The leak starts mid-shift, so the hopper stops being a fire-and-forget
       station right about when the mixer stops leaving you spare hands. */
    if (st->hopper.next_leak_at == 0.0) {
        st->hopper.next_leak_at = now + T->leak_ms;
        return;
    }
    if (now >= st->hopper.next_leak_at) {
        st->hopper.units        = imax_(0, st->hopper.units - 1);
        st->hopper.next_leak_at = now + T->leak_ms;
    }
}

/* -- 3 . CONVEYOR (declared early; the mixer ejects onto it) ---------- */

static void push_on_belt(Shift *st, Quality quality)
{
    BeltItem *it;
    const BeltItem *last = st->belt.n ? &st->belt.items[st->belt.n - 1] : 0;

    /* Full, or the tail of a jam is still sitting under the mixer -- either way
       there is nowhere to put this ball. Checking the entry as well as the
       count is what stops a jam from stacking dough on top of itself, and it is
       what makes "stuck belt plus working mixer" cost a whole batch. */
    if (st->belt.n >= BELT_CAP || (last && last->x < BELT_X0 + ITEM_GAP)) {
        spill(st, BELT_X0, (float)FLOOR_Y, MESS_SPILL);
        toast(st, "BELT FULL", C_DANGER);
        return;
    }

    it = &st->belt.items[st->belt.n++];
    it->quality = quality;
    it->x       = BELT_X0;
    it->sticky  = 0;
}

/* -- 2 . MIXER ------------------------------------------------------- */

static void press_mixer(Shift *st, const Tuning *T, double now)
{
    (void)T; (void)now;

    if (st->mixer.phase == MIX_IDLE) {
        if (st->hopper.units < HOPPER_PER_MIX) { toast(st, "NO FLOUR", C_DANGER); return; }
        st->hopper.units -= HOPPER_PER_MIX;
        st->mixer.phase   = MIX_MIXING;
        st->mixer.t       = 0.0f;
        st->mixer.quality = Q_GOOD;
        return;
    }

    if (st->mixer.phase == MIX_READY || st->mixer.phase == MIX_OVER) {
        push_on_belt(st, st->mixer.quality);
        st->mixer.phase = MIX_IDLE;
        st->mixer.t     = 0.0f;
    }
    /* MIX_MIXING -> nothing. There is no way to rush a batch, and that is the
       point: the mixer sets the tempo everything else has to keep up with. */
}

static void update_mixer(Shift *st, const Tuning *T, float dt_ms)
{
    st->mixer.t += dt_ms;

    if (st->mixer.phase == MIX_MIXING && st->mixer.t >= T->mix_ms) {
        st->mixer.phase = MIX_READY;
        st->mixer.t     = 0.0f;
    } else if (st->mixer.phase == MIX_READY && st->mixer.t >= T->ready_ms) {
        /* Neglect degrades rather than blocks. The overmixed ball is still
           sitting there and still has to be pressed out -- it is just worth 45
           instead of 100. */
        st->mixer.phase   = MIX_OVER;
        st->mixer.quality = Q_TOUGH;
        st->mixer.t       = 0.0f;
        st->tally.overmixed++;
    }
}

/* -- 4 . OVEN (declared early; the belt hands off to it) -------------- */

static void load_oven(Shift *st, Quality quality)
{
    st->oven.phase   = OVEN_BAKING;
    st->oven.t       = 0.0f;
    st->oven.quality = quality;
}

/* -- 3 . CONVEYOR, continued ----------------------------------------- */

static void update_belt(Shift *st, const Tuning *T, float dt_ms, double now)
{
    float speed = (now < st->belt.boost_until ? T->belt_px * 2.2f : T->belt_px)
                  * dt_ms / 1000.0f;
    int i;

    /* items[0] is nearest the oven. Walking front-to-back means each item's
       blocker has already moved this frame, so a queue closes up in one pass
       instead of one item per frame. */
    for (i = 0; i < st->belt.n; i++) {
        BeltItem *it = &st->belt.items[i];
        float limit;
        if (it->sticky) continue;                       /* a stuck item is a wall */
        limit = i > 0 ? st->belt.items[i - 1].x - ITEM_GAP : BELT_X1;
        if (limit > it->x) it->x = fminf_(it->x + speed, limit);
    }

    /* Hand off only if the oven will take it. If it won't, the queue backs up
       and it is the mixer's next ejection that pays for it. */
    if (st->belt.n && st->belt.items[0].x >= BELT_X1 - 0.5f
        && st->oven.phase == OVEN_EMPTY) {
        Quality q = st->belt.items[0].quality;
        memmove(&st->belt.items[0], &st->belt.items[1],
                sizeof(BeltItem) * (size_t)(st->belt.n - 1));
        st->belt.n--;
        load_oven(st, q);
    }

    if (now >= st->belt.next_stick_at) {
        int free_idx[BELT_CAP];
        int n_free = 0;
        for (i = 0; i < st->belt.n; i++)
            if (!st->belt.items[i].sticky) free_idx[n_free++] = i;
        if (n_free) {
            int pick = (int)(mmc_rand(st) * (double)n_free);
            if (pick >= n_free) pick = n_free - 1;       /* rand() < 1, but be sure */
            st->belt.items[free_idx[pick]].sticky = 1;
            st->tally.jams++;
            toast(st, "BELT JAM", C_WARN);
        }
        st->belt.next_stick_at = now + T->stick_ms;
    }
}

static void press_belt(Shift *st, const Tuning *T, double now)
{
    int i;
    (void)T;
    st->belt.boost_until = now + 900.0;
    for (i = 0; i < st->belt.n; i++) st->belt.items[i].sticky = 0;
}

/* -- 5 . PACKING (declared early; the oven hands off to it) ---------- */

static void to_pack(Shift *st, Grade grade, double now)
{
    (void)now;
    if (st->pack.n_tray >= TRAY_CAP) {
        spill(st, (float)BAYS[S_PACK].x + 40.0f, (float)FLOOR_Y, MESS_SPILL);
        toast(st, "TRAY OVERFLOW", C_DANGER);
        return;
    }
    st->pack.tray[st->pack.n_tray++] = grade;
    if (grade == GRADE_PERFECT)
        pop(st, "PERFECT", (float)BAYS[S_OVEN].x + 80.0f, 200.0f, C_OK);
}

/* -- 4 . OVEN, continued --------------------------------------------- */

static void update_oven(Shift *st, const Tuning *T, float dt_ms)
{
    if (st->oven.phase == OVEN_EMPTY) return;

    st->oven.t += dt_ms;
    if (st->oven.phase == OVEN_BAKING && st->oven.t >= T->bake_ms) {
        st->oven.phase = OVEN_GOLDEN;
        st->oven.t     = 0.0f;
    } else if (st->oven.phase == OVEN_GOLDEN && st->oven.t >= T->golden_ms) {
        st->oven.phase = OVEN_BURNING;
        st->oven.t     = 0.0f;
    } else if (st->oven.phase == OVEN_BURNING && st->oven.t >= BURN_TO_FIRE_MS) {
        st->oven.phase  = OVEN_FIRE;
        st->oven.t      = 0.0f;
        st->oven.n_taps = 0;
        st->tally.fires++;
        toast(st, "FIRE!", C_DANGER);
    } else if (st->oven.phase == OVEN_FIRE) {
        add_mess(st, FIRE_MESS_RATE * dt_ms / 1000.0f);
        st->tally.fire_ms += dt_ms;
    }
}

static void press_oven(Shift *st, const Tuning *T, double now)
{
    Grade grade;
    (void)T;

    if (st->oven.phase == OVEN_FIRE) {
        /* Three taps inside two seconds -- a mash, not a hold. A hold would let
           you park on the oven and ignore everything else while it went out. */
        int i, keep = 0;
        for (i = 0; i < st->oven.n_taps; i++)
            if (now - st->oven.taps[i] < FIRE_TAP_WINDOW)
                st->oven.taps[keep++] = st->oven.taps[i];
        st->oven.n_taps = keep;

        if (st->oven.n_taps < FIRE_TAPS) st->oven.taps[st->oven.n_taps++] = now;

        if (st->oven.n_taps >= FIRE_TAPS) {
            st->oven.phase  = OVEN_EMPTY;
            st->oven.t      = 0.0f;
            st->oven.n_taps = 0;
            add_mess(st, MESS_FIRE_OUT);
            toast(st, "FIRE OUT", C_OK);
        }
        return;
    }

    if (st->oven.phase == OVEN_EMPTY) return;

    if (st->oven.phase == OVEN_BAKING) {
        grade = GRADE_RAW;                              /* panic move: frees the oven */
    } else if (st->oven.phase == OVEN_GOLDEN) {
        grade = st->oven.quality == Q_GOOD ? GRADE_PERFECT : GRADE_SECONDS;
    } else {
        grade = GRADE_BURNT;
        add_mess(st, MESS_BURNT);
    }

    st->oven.phase = OVEN_EMPTY;
    st->oven.t     = 0.0f;
    st->tally.graded[grade]++;
    to_pack(st, grade, now);
}

/* -- 5 . PACKING, continued ------------------------------------------ */

static void press_pack(Shift *st, const Tuning *T, double now)
{
    int n, sum = 0, gained, i;
    float mult;
    (void)T;

    if (now < st->pack.box_until || st->pack.n_tray == 0) return;

    n = st->pack.n_tray;
    for (i = 0; i < n; i++) sum += VALUE[st->pack.tray[i]];
    mult   = BOX_MULT[n] * (st->rush >= 0 ? (float)RUSH_SCORE : 1.0f);
    gained = (int)((double)sum * (double)mult + 0.5);   /* Math.round */

    st->score += gained;
    for (i = 0; i < n; i++)
        if (VALUE[st->pack.tray[i]] > 0) st->shipped++;

    if (gained > 0) {
        char buf[POP_TEXT_MAX];
        snprintf(buf, sizeof(buf), "+%d", gained);
        pop(st, buf, (float)BAYS[S_PACK].x + 60.0f, 190.0f,
            st->rush >= 0 ? C_NEON : C_BUTTER);
    }

    st->pack.n_tray = 0;
    st->tally.boxes++;
    st->pack.box_until = now + BOX_MS;

    if (st->pack.n_flying >= FLYING_MAX) {
        memmove(&st->pack.flying[0], &st->pack.flying[1],
                sizeof(Flying) * (FLYING_MAX - 1));
        st->pack.n_flying = FLYING_MAX - 1;
    }
    st->pack.flying[st->pack.n_flying].x = (float)BAYS[S_PACK].x + 70.0f;
    st->pack.flying[st->pack.n_flying].t = 0.0f;
    st->pack.n_flying++;
}

static void update_pack(Shift *st, const Tuning *T, float dt_ms, double now)
{
    int i, keep = 0;
    (void)T; (void)now;
    for (i = 0; i < st->pack.n_flying; i++) {
        st->pack.flying[i].t += dt_ms;
        if (st->pack.flying[i].t < 900.0f) st->pack.flying[keep++] = st->pack.flying[i];
    }
    st->pack.n_flying = keep;
}

/* -- Dispatch --------------------------------------------------------
 * Bay index -> the function that acts on it. Order matches BAYS and Station.
 */
typedef void (*PressFn)(Shift *, const Tuning *, double);

static const PressFn PRESS[S_COUNT] = {
    press_hopper, press_mixer, press_belt, press_oven, press_pack
};

void mmc_press(Shift *st, Station s, const Tuning *T, double now)
{
    if (s < 0 || s >= S_COUNT) return;
    PRESS[s](st, T, now);
}

/* -- The shift ------------------------------------------------------- */

static void age_fx(Shift *st, float dt_ms)
{
    int i, keep;

    for (i = 0, keep = 0; i < st->fx.n_spills; i++) {
        st->fx.spills[i].t += dt_ms;
        if (st->fx.spills[i].t < 1400.0f) st->fx.spills[keep++] = st->fx.spills[i];
    }
    st->fx.n_spills = keep;

    for (i = 0, keep = 0; i < st->fx.n_pops; i++) {
        st->fx.pops[i].born += dt_ms;
        if (st->fx.pops[i].born < 900.0f) st->fx.pops[keep++] = st->fx.pops[i];
    }
    st->fx.n_pops = keep;

    if (st->fx.toast.active) {
        st->fx.toast.t += dt_ms;
        if (st->fx.toast.t > 1300.0f) st->fx.toast.active = 0;
    }

    st->fx.shake = fmaxf_(0.0f, st->fx.shake - dt_ms / 45.0f);
}

Tuning mmc_update_shift(Shift *st, float dt_ms, double now)
{
    Tuning T = mmc_tune(st);

    /* fx ages even during an inspection -- a frozen screen with frozen smoke
       reads as a crash rather than a penalty. */
    age_fx(st, dt_ms);

    /* The inspector freeze is the only thing that stops the line, and the song
       keeps playing straight through it. That is precisely the penalty: in a
       fixed-length round, four seconds is the currency. */
    if (now < st->inspect_until) return T;

    update_hopper(st, &T, dt_ms, now);
    update_mixer(st, &T, dt_ms);
    update_belt(st, &T, dt_ms, now);
    update_oven(st, &T, dt_ms);
    update_pack(st, &T, dt_ms, now);

    if (st->mess > st->tally.peak_mess) st->tally.peak_mess = st->mess;

    if (st->mess >= MESS_MAX) {
        st->inspect_until = now + INSPECT_MS;
        st->mess          = INSPECT_RESET;
        st->inspections++;
        toast(st, "HEALTH INSPECTION", C_DANGER);
    }

    return T;
}

const char *mmc_settle_shift(Shift *st, int *points_out)
{
    if (st->mess < CLEAN_BONUS_THRESHOLD) {
        st->score += CLEAN_BONUS_POINTS;
        if (points_out) *points_out = CLEAN_BONUS_POINTS;
        return CLEAN_BONUS_LABEL;
    }
    if (st->mess < TIDY_BONUS_THRESHOLD) {
        st->score += TIDY_BONUS_POINTS;
        if (points_out) *points_out = TIDY_BONUS_POINTS;
        return TIDY_BONUS_LABEL;
    }
    if (points_out) *points_out = 0;
    return 0;
}
