/* =====================================================================
 * render.c -- makemecookies!x4 (Wii)
 *
 * PLACEHOLDER, and deliberately an honest one: labelled bays, phase names, the
 * belt as dots and the two meters. It exists so the simulation can be watched
 * running on a console before a single sprite has been drawn, which is the
 * order that keeps a port truthful -- the rules are already verified by the
 * host suite, so anything wrong on screen from here is this file's fault and
 * not the game's.
 *
 * The real thing is web/js/render.js plus web/js/pixels.js: a pixel-art bakery
 * with sprite sheets, a checkerboard floor, steam, fire and flying boxes. None
 * of that is here yet.
 *
 * Reads state, decides nothing. See render.h.
 * ===================================================================== */

#include <stdio.h>
#include <string.h>
#include <grrlib.h>

#include "magnolia.h"
#include "render.h"

/* The simulation is written in the web version's 960x420 playfield, because
   that is what the belt geometry, the bay columns and every tuned number are
   expressed in. magnolia's UI helpers are written against a 640x480 design
   space. This is the only place the two meet: keep the conversion here and the
   rules never have to know which screen they are on. */
#define PF_LEFT   16               /* design-space margin around the playfield */
#define PF_TOP    70
#define PF_W     (UI_DESIGN_WIDTH - 2 * PF_LEFT)

static int px(float playfield_x)
{
    return PF_LEFT + (int)(playfield_x * (float)PF_W / (float)PLAYFIELD_W);
}

static int py(float playfield_y)
{
    /* The playfield is 960x420 and the space left under the HUD is shorter, so
       y is scaled by its own factor rather than x's -- squashing is right here,
       stretching the belt off the bottom of a CRT is not. */
    return PF_TOP + (int)(playfield_y * 300.0f / (float)PLAYFIELD_H);
}

static void fill(int dx, int dy, int dw, int dh, u32 color)
{
    GRRLIB_Rectangle(ui_map_x(dx), ui_map_y(dy),
                     ui_map_w(dw), ui_map_h(dh), color, 1);
}

static const char *mixer_phase_name(MixerPhase p)
{
    switch (p) {
        case MIX_IDLE:   return "IDLE";
        case MIX_MIXING: return "MIXING";
        case MIX_READY:  return "READY";
        case MIX_OVER:   return "TOUGH";
    }
    return "?";
}

static const char *oven_phase_name(OvenPhase p)
{
    switch (p) {
        case OVEN_EMPTY:   return "EMPTY";
        case OVEN_BAKING:  return "BAKING";
        case OVEN_GOLDEN:  return "GOLDEN";
        case OVEN_BURNING: return "BURNING";
        case OVEN_FIRE:    return "FIRE!";
    }
    return "?";
}

/* -- The bays -------------------------------------------------------- */

static void draw_bay(const Shift *st, int i)
{
    const Bay *b = &BAYS[i];
    int x = px((float)b->x);
    int w = px((float)(b->x + b->w)) - x;
    int y = PF_TOP;
    char line[32];
    const char *status = "";

    fill(x, y, w, 120, C_PANEL);
    fill(x, y, w, 2, b->color);

    ui_draw_text_shadow(x + 4, y + 6, b->name, 10, b->color);
    ui_draw_text_shadow(x + 4, y + 104, STATION_GLYPH[i], 12, C_STEEL);

    switch (i) {
        case S_HOPPER:
            snprintf(line, sizeof(line), "%d/%d", st->hopper.units, HOPPER_MAX);
            status = line;
            break;
        case S_MIXER:
            status = mixer_phase_name(st->mixer.phase);
            break;
        case S_BELT:
            snprintf(line, sizeof(line), "%d on belt", st->belt.n);
            status = line;
            break;
        case S_OVEN:
            status = oven_phase_name(st->oven.phase);
            break;
        case S_PACK:
            snprintf(line, sizeof(line), "tray %d/%d", st->pack.n_tray, TRAY_CAP);
            status = line;
            break;
        default:
            break;
    }
    ui_draw_text_shadow(x + 4, y + 24, status, 10,
                        st->oven.phase == OVEN_FIRE && i == S_OVEN ? C_DANGER : C_DOUGH);
}

/* -- The belt -------------------------------------------------------- */

static void draw_belt(const Shift *st)
{
    int i;
    int y = py((float)BELT_Y);

    fill(px(BELT_X0), y, px(BELT_X1) - px(BELT_X0), 4, C_STEEL_LO);

    for (i = 0; i < st->belt.n; i++) {
        const BeltItem *it = &st->belt.items[i];
        u32 c = it->sticky ? C_DANGER
                           : (it->quality == Q_GOOD ? C_DOUGH : C_CHOC);
        fill(px(it->x) - 3, y - 8, 7, 7, c);
    }
}

/* -- Meters and HUD -------------------------------------------------- */

static void draw_hud(const Shift *st, const Tuning *T)
{
    char buf[48];
    int mess_w, shift_w;

    snprintf(buf, sizeof(buf), "SCORE %d", st->score);
    ui_draw_text_shadow(PF_LEFT, 10, buf, 14, C_BUTTER);

    snprintf(buf, sizeof(buf), "SHIPPED %d", st->shipped);
    ui_draw_text_shadow(PF_LEFT + 200, 10, buf, 14, C_SPRINKLE);

    if (st->rush >= 0)
        ui_draw_text_shadow(PF_LEFT + 400, 10, "RUSH x2", 14, C_NEON);

    /* MESS. The only failure state the game has, so it gets the loud bar. */
    ui_draw_text_shadow(PF_LEFT, 32, "MESS", 10, C_STEEL);
    fill(PF_LEFT + 50, 32, 240, 10, C_TILE);
    mess_w = (int)(240.0f * (st->mess / MESS_MAX));
    if (mess_w > 240) mess_w = 240;
    if (mess_w > 0)
        fill(PF_LEFT + 50, 32, mess_w,  10,
             st->mess > 70.0f ? C_DANGER : (st->mess > 40.0f ? C_WARN : C_OK));

    /* The shift clock, which is the song. */
    shift_w = (int)(240.0f * mmc_clamp01((float)(st->elapsed / st->shift_ms)));
    fill(PF_LEFT + 330, 32, 240, 10, C_TILE);
    if (shift_w > 0) fill(PF_LEFT + 330, 32, shift_w, 10, C_FROSTING);

    (void)T;
}

void render_shift(const Shift *st, const Tuning *T)
{
    int i;

    for (i = 0; i < S_COUNT; i++) draw_bay(st, i);
    draw_belt(st);
    draw_hud(st, T);

    if (st->fx.toast.active)
        ui_draw_centered_text(PF_TOP + 200, st->fx.toast.text, 16, st->fx.toast.color);

    if (st->inspect_until > st->elapsed + st->started_at)
        ui_draw_centered_text(PF_TOP + 230, "HEALTH INSPECTION", 18, C_DANGER);
}

void render_results(const Shift *st, const char *bonus, int bonus_points)
{
    char buf[64];

    ui_draw_centered_text(80, "END OF SHIFT", 24, C_NEON);

    snprintf(buf, sizeof(buf), "SCORE %d", st->score);
    ui_draw_centered_text(140, buf, 20, C_BUTTER);

    snprintf(buf, sizeof(buf), "SHIPPED %d", st->shipped);
    ui_draw_centered_text(175, buf, 14, C_SPRINKLE);

    snprintf(buf, sizeof(buf), "PERFECT %d   SECONDS %d   BURNT %d",
             st->tally.graded[GRADE_PERFECT],
             st->tally.graded[GRADE_SECONDS],
             st->tally.graded[GRADE_BURNT]);
    ui_draw_centered_text(205, buf, 10, C_DOUGH);

    snprintf(buf, sizeof(buf), "INSPECTIONS %d   FIRES %d   SPILLS %d",
             st->inspections, st->tally.fires, st->tally.spills);
    ui_draw_centered_text(225, buf, 10, C_STEEL);

    if (bonus) {
        snprintf(buf, sizeof(buf), "%s  +%d", bonus, bonus_points);
        ui_draw_centered_text(265, buf, 16, C_OK);
    }

    ui_draw_centered_text(330, "PRESS A FOR ANOTHER SHIFT", 12, C_STEEL);
    ui_draw_centered_text(355, "HOME TO QUIT", 10, C_STEEL_LO);
}

void render_title(void)
{
    ui_draw_centered_text(90,  "makemecookies!", 26, C_NEON);
    ui_draw_centered_text(125, "x4", 26, C_FROSTING);
    ui_draw_centered_text(175, "one song, one shift", 12, C_DOUGH);

    ui_draw_centered_text(230, "HOLD THE WIIMOTE SIDEWAYS", 10, C_STEEL);
    ui_draw_centered_text(255, "< HOPPER    ^ MIXER    v CONVEYOR", 10, C_SPRINKLE);
    ui_draw_centered_text(275, "1 OVEN      2 PACKING", 10, C_SPRINKLE);

    ui_draw_centered_text(330, "PRESS A TO CLOCK ON", 14, C_BUTTER);
}
