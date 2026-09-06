/* =====================================================================
 * render.h -- makemecookies!x4 (Wii)
 *
 * Reads state and draws it. Decides nothing: every rule lives in stations.c,
 * and that split is what lets the rules be tested on the host. The web version
 * keeps the same line between js/render.js and js/stations.js.
 *
 * PLACEHOLDER. What this draws now is a diagnostic view -- labelled bays,
 * phase names, the belt as dots, the meters -- enough to watch the simulation
 * run on a console and confirm the wiring, and not remotely the game's look.
 * web/js/render.js and web/js/pixels.js are what it has to grow into: a
 * pixel-art bakery with sprite sheets, not rectangles with text on them.
 * ===================================================================== */
#ifndef RENDER_H
#define RENDER_H

#include "stations.h"

/* One frame. Call between renderer_draw_background() and renderer_finish(). */
void render_shift(const Shift *st, const Tuning *T);

/* The end-of-shift card: score, what shipped, and the cleanliness bonus if one
   was earned. `bonus` is NULL when the shift was too messy to earn one. */
void render_results(const Shift *st, const char *bonus, int bonus_points);

/* The title card, shown until the player starts a shift. */
void render_title(void);

#endif
