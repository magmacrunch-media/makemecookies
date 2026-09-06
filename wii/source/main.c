/* =====================================================================
 * main.c -- makemecookies!x4 (Wii)
 *
 * Wiring only: the engine, the clock, the controller and the song. Every rule
 * is in stations.c and every pixel is drawn by render.c, which is the same
 * split web/js/main.js keeps.
 *
 * PLACEHOLDER in the same sense render.c is: this runs a whole shift and
 * reports it, but there is no scoreboard, no sound effects and no attract
 * mode yet. What it is not is a sketch of the rules -- those are ported and
 * tested.
 * ===================================================================== */

#include <stdio.h>
#include <string.h>
#include <grrlib.h>

#include "magnolia.h"
#include "assets.h"
#include "stations.h"
#include "render.h"

/* -- Input mapping ---------------------------------------------------
 * Defined here rather than in config.h's neighbour stations.c because these
 * are magnolia's InputButton values, and stations.c is compiled by the host
 * tests with no engine in reach. Nothing in the simulation knows what a button
 * is; it is handed a Station.
 *
 * Held sideways, a Wiimote gives the D-pad to the left thumb and 1/2 to the
 * right, so the production line is split across the hands in the order it
 * appears on screen -- the left hand takes the front, the right hand the back.
 * Five stations, five buttons, one press each: anything that costs two presses
 * to reach a station spends the attention-switching the game is made of rather
 * than testing it.
 */
const int STATION_BUTTON[S_COUNT] = {
    INPUT_BTN_LEFT,   /* HOPPER   */
    INPUT_BTN_UP,     /* MIXER    */
    INPUT_BTN_DOWN,   /* CONVEYOR */
    INPUT_BTN_1,      /* OVEN     */
    INPUT_BTN_2,      /* PACKING  */
};

const char *const STATION_GLYPH[S_COUNT] = { "<", "^", "v", "1", "2" };

/* Empty unless the linked music.pcm and config.h's SHIFT_MS disagree. Shown on
   the title screen, because that is the only place a warning can actually be
   seen -- see the note where it is set. */
static char audio_warning[80];

/* -- The shift clock -------------------------------------------------
 * On the web the song IS the clock: main.js reads music.currentTime every
 * frame, so the difficulty ramp and the four RUSH windows stay on the music
 * even when the tab drops frames.
 *
 * That is not available here and cannot be made available. magnolia plays
 * music with ASND_SetInfiniteVoice, which loops forever and reports neither a
 * position nor an end -- the same gap that made the web version reject
 * adenosine's AdAudio, except there is no plain <audio> element to fall back
 * to.
 *
 * So the relationship inverts. Rather than reading the length off the track,
 * the track's length is *known*: raw PCM is exactly its byte count over its
 * rate, computed at build time and not estimated by a decoder. The clock then
 * runs off clock_elapsed(), started with the voice, and the song and the shift
 * stay together because they started together and neither can drift far in
 * fifty-one seconds.
 *
 * What is lost is the web version's self-correction. There, re-encoding the
 * ogg moved the RUSH windows automatically. Here SHIFT_MS is a constant, so a
 * re-encoded track and a stale constant would silently misplace all four
 * windows and end the shift early -- exactly the bug the web version hit when
 * it read the duration once. Hence the check below: the two are derived from
 * the same bytes, so they cannot disagree without saying so.
 */
static double music_ms_from_pcm(unsigned int bytes)
{
    return (double)bytes * 1000.0
         / ((double)MUSIC_RATE * (double)MUSIC_CHANNELS * 2.0);
}

/* -- Rush windows ---------------------------------------------------- */

static int rush_index(double elapsed, double shift_ms)
{
    int i;
    double f = elapsed / shift_ms;
    for (i = 0; i < RUSH_COUNT; i++) {
        if (f >= RUSH_AT[i] && elapsed < RUSH_AT[i] * shift_ms + RUSH_MS)
            return i;
    }
    return -1;
}

/* -- Autopilot -------------------------------------------------------
 * Compiled out entirely unless config.h's AUTOPILOT is 1. See the long note
 * there for why it exists and, more importantly, for what a clean autopilot
 * run does not prove.
 *
 * It reads the Shift struct rather than working to a stopwatch, so it acts on
 * what is actually happening -- pull when the tray is golden, eject when the
 * mixer is ready, unstick when the belt jams. A blind timed bot was tried
 * first and is not worth repeating: it drifts out of step the moment the ramp
 * tightens, and then every zero it produces looks like a bug in the game.
 *
 * The order below is the priority order, and it is the interesting part. The
 * oven comes first because it is the only station that makes mess on its own;
 * packing before the belt because a full tray blocks the oven behind it; the
 * hopper last because it is the only one that can wait.
 */
#if AUTOPILOT
static void autopilot(Shift *st, const Tuning *T, double now, int frame)
{
    int i, jammed = 0;

    if (frame % AUTOPILOT_EVERY) return;

    /* The oven, in the order it goes wrong. */
    if (st->oven.phase == OVEN_FIRE)    { mmc_press(st, S_OVEN, T, now); return; }
    if (st->oven.phase == OVEN_GOLDEN)  { mmc_press(st, S_OVEN, T, now); return; }
    if (st->oven.phase == OVEN_BURNING) { mmc_press(st, S_OVEN, T, now); return; }

    /* A full tray costs the next cookie, so ship before it overflows. Holding
       for the full four is the greedy line the multiplier rewards. */
    if (st->pack.n_tray >= TRAY_CAP)    { mmc_press(st, S_PACK, T, now); return; }

    for (i = 0; i < st->belt.n; i++) if (st->belt.items[i].sticky) jammed = 1;
    if (jammed)                         { mmc_press(st, S_BELT, T, now); return; }

    if (st->mixer.phase == MIX_READY || st->mixer.phase == MIX_OVER) {
        mmc_press(st, S_MIXER, T, now);
        return;
    }
    if (st->mixer.phase == MIX_IDLE) {
        if (st->hopper.units < HOPPER_PER_MIX) mmc_press(st, S_HOPPER, T, now);
        else                                   mmc_press(st, S_MIXER,  T, now);
        return;
    }

    /* Nothing urgent: top the hopper up, stopping short of the spill
       threshold, which is what a careful player does with a spare hand. */
    if (st->hopper.units < HOPPER_MAX - 1)  mmc_press(st, S_HOPPER, T, now);
}
#endif

/* -- A shift --------------------------------------------------------- */

static void play_shift(double shift_ms)
{
    Shift st;
    Tuning T;
    double now = 0.0;
    const char *bonus;
    int bonus_points = 0;
    int i;

    mmc_shift_init(&st, (unsigned int)clock_frame() * 2654435761u + 1u);
    st.shift_ms = shift_ms;

    T = mmc_tune(&st);
    mmc_arm_shift(&st, &T, now);

    audio_play_music_mem_fmt(music_pcm, music_pcm_size, AUDIO_MONO_16, MUSIC_RATE);
    clock_reset();

    while (st.elapsed < st.shift_ms) {
        float dt_ms;

        input_scan();
        if (input_home_pressed()) break;

        dt_ms = clock_dt() * 1000.0f;
        /* A long frame -- an SD read, a video mode change -- must not teleport
           the belt or skip a bake. Cap it and let the shift run a hair long
           rather than let one stall rewrite the line's state. */
        if (dt_ms > 100.0f) dt_ms = 100.0f;

        now        += dt_ms;
        st.elapsed += dt_ms;
        st.rush     = rush_index(st.elapsed, st.shift_ms);

        for (i = 0; i < S_COUNT; i++) {
            if (input_pressed(0, (InputButton)STATION_BUTTON[i])) {
                Tuning cur = mmc_tune(&st);
                mmc_press(&st, (Station)i, &cur, now);
            }
        }

#if AUTOPILOT
        autopilot(&st, &T, now, clock_frame());
#endif

        T = mmc_update_shift(&st, dt_ms, now);

        renderer_draw_background();
        render_shift(&st, &T);
        renderer_finish();
    }

    audio_stop_music();
    bonus = mmc_settle_shift(&st, &bonus_points);

#if AUTOPILOT
    /* Reported to the log as well as the screen, because reading numbers off a
       screenshot of an emulator is a poor way to measure: another window in
       front of it at the wrong moment silently captures something else
       entirely, and that happened repeatedly while this hook was being built.

       Needs magnolia 0.3.0 or newer, whose magnolia_init() calls
       SYS_STDIO_Report(true) -- before that libogc left stdout attached to
       nothing and this would have gone nowhere -- plus OSREPORT and
       WriteToFile in Dolphin's Logger.ini, which both default to False. */
    printf("autopilot: reaction=%d frames score=%d shipped=%d\n",
           AUTOPILOT_EVERY, st.score, st.shipped);
    printf("autopilot: perfect=%d seconds=%d raw=%d burnt=%d\n",
           st.tally.graded[GRADE_PERFECT], st.tally.graded[GRADE_SECONDS],
           st.tally.graded[GRADE_RAW], st.tally.graded[GRADE_BURNT]);
    printf("autopilot: overmixed=%d jams=%d spills=%d fires=%d inspections=%d "
           "boxes=%d peak_mess=%d bonus=%s\n",
           st.tally.overmixed, st.tally.jams, st.tally.spills, st.tally.fires,
           st.inspections, st.tally.boxes, (int)st.tally.peak_mess,
           bonus ? bonus : "none");
#endif

    /* The results card, until A or HOME -- except under autopilot, where no
       button can ever arrive and this would wait for one forever. Long enough
       to read, then it moves on by itself. */
    {
        double shown = 0.0;
        while (1) {
            input_scan();
            if (input_home_pressed() || input_a_pressed()) break;
            if (AUTOPILOT) {
                shown += clock_dt() * 1000.0;
                if (shown > 6000.0) break;
            }
            renderer_draw_background();
            render_results(&st, bonus, bonus_points);
            renderer_finish();
        }
    }
}

int main(void)
{
    const MagnoliaConfig cfg = {
        .app_name     = "makemecookies",
        .max_scores   = 10,
        .overscan_pct = 6
    };
    double shift_ms;
    int status = magnolia_init(&cfg);

    if (status == -2) return 1;      /* video never came up */

    input_init();
    audio_init();

    /* The song's real length, from the bytes that are actually linked in. If
       this and SHIFT_MS disagree the track was re-encoded without config.h
       being updated, and every RUSH window is in the wrong place -- so trust
       the bytes and say so, rather than playing a subtly wrong shift. */
    shift_ms = music_ms_from_pcm(music_pcm_size);
    if (shift_ms < SHIFT_MS - 250.0 || shift_ms > SHIFT_MS + 250.0) {
        /* On the title screen rather than through printf. printf does reach
           Dolphin's log since magnolia 0.3.0, but only with the right
           Logger.ini and only for somebody who thinks to look -- and this is
           not a trace, it is a mistake made while building that misplaces all
           four RUSH windows. The person who needs telling is looking at the
           screen. An earlier version of this check used printf at a time when
           printf reached nothing at all, which is how a handled-looking case
           went two days without ever being able to fire. */
        snprintf(audio_warning, sizeof(audio_warning),
                 "MUSIC IS %dms, CONFIG SAYS %d - RUSH WINDOWS WILL DRIFT",
                 (int)shift_ms, (int)SHIFT_MS);
    }

    while (1) {
        input_scan();
        if (input_home_pressed()) break;

        /* Under autopilot nobody is holding a controller, so the title screen
           would be a dead end -- clock on by itself, then quit after the one
           shift. Looping forever would mean a scripted run never ends and
           whatever is capturing it has to guess when to stop, which is how a
           screenshot of the *next* shift's empty scoreboard ends up being
           filed as the result of this one. */
        if (input_a_pressed() || AUTOPILOT) {
            play_shift(shift_ms);
            if (AUTOPILOT) break;
            continue;
        }

        renderer_draw_background();
        render_title(audio_warning);
        renderer_finish();
    }

    audio_shutdown();
    magnolia_shutdown();
    return 0;
}
