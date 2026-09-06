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

        T = mmc_update_shift(&st, dt_ms, now);

        renderer_draw_background();
        render_shift(&st, &T);
        renderer_finish();
    }

    audio_stop_music();
    bonus = mmc_settle_shift(&st, &bonus_points);

    /* The results card, until A or HOME. */
    while (1) {
        input_scan();
        if (input_home_pressed() || input_a_pressed()) break;
        renderer_draw_background();
        render_results(&st, bonus, bonus_points);
        renderer_finish();
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
        printf("audio/music.pcm is %.0fms; config.h SHIFT_MS says %.0fms.\n",
               shift_ms, SHIFT_MS);
        printf("Using the file. Update SHIFT_MS to match, or the four RUSH "
               "windows drift from the music.\n");
    }

    while (1) {
        input_scan();
        if (input_home_pressed()) break;

        if (input_a_pressed()) {
            play_shift(shift_ms);
            continue;
        }

        renderer_draw_background();
        render_title();
        renderer_finish();
    }

    audio_shutdown();
    magnolia_shutdown();
    return 0;
}
