// =====================================================================
// config.js — makemecookies!x4
// Geometry, palette, and every tunable number in one place.
//
// The whole difficulty curve is expressed as [easy, hard] pairs in RAMP,
// lerped by song position. Nothing else in the game reads the clock to
// decide how hard it should be — tune() is the only place that happens.
// =====================================================================

const CANVAS_W = 960;
const CANVAS_H = 420;

// ── Palette ──────────────────────────────────────────────────────────
// Kitsch bakery neon. Deliberately warm — this sits next to tetris's cold
// Nordic set in the same arcade and should not be mistaken for it.
const C = {
  dough:    '#F2D8A7',
  frosting: '#FF5FA2',
  sprinkle: '#41E8D1',
  butter:   '#FFC93C',
  choc:     '#4B2E1E',
  burnt:    '#2A1A12',
  neon:     '#FF2E9C',
  bg:       '#180C18',
  panel:    '#26122A',
  tile:     '#34163A',
  steel:    '#8E7B96',
  steelLo:  '#5C4C64',
  danger:   '#FF3B3B',
  ok:       '#41E8D1',
  warn:     '#FFC93C',
};

// ── Station bays ─────────────────────────────────────────────────────
// x/w are the canvas columns each station owns. The neon frame, the
// urgency meter and the keycap are all drawn from these, so moving a
// station is a one-line edit here.
const BAYS = [
  { key: '1', name: 'HOPPER',   x:  20, w: 150, color: C.dough },
  { key: '2', name: 'MIXER',    x: 178, w: 152, color: C.frosting },
  { key: '3', name: 'CONVEYOR', x: 338, w: 282, color: C.sprinkle },
  { key: '4', name: 'OVEN',     x: 628, w: 162, color: C.butter },
  { key: '5', name: 'PACKING',  x: 798, w: 142, color: C.neon },
];

const S = { HOPPER: 0, MIXER: 1, BELT: 2, OVEN: 3, PACK: 4 };

const FLOOR_Y = 300;   // top of the checkerboard floor
const BELT_Y  = 250;   // top of the belt surface

// ── Belt geometry ────────────────────────────────────────────────────
const BELT_X0   = 348;  // where the mixer drops dough
const BELT_X1   = 604;  // the oven mouth
const ITEM_GAP  = 34;   // minimum spacing; a stuck item blocks at this range
const BELT_CAP  = 5;

// ── Hopper ───────────────────────────────────────────────────────────
const HOPPER_MAX      = 6;
const HOPPER_PER_SACK = 2;
const HOPPER_PER_MIX  = 2;
const POUR_MS         = 350;
const SPILL_LOCK_MS   = 700;

// ── Oven ─────────────────────────────────────────────────────────────
const BURN_TO_FIRE_MS = 2500;
const FIRE_TAPS       = 3;      // taps of `4` needed...
const FIRE_TAP_WINDOW = 2000;   // ...within this window, to put it out
const FIRE_MESS_RATE  = 12;     // mess per second while burning

// ── Packing ──────────────────────────────────────────────────────────
const TRAY_CAP = 4;
const BOX_MS   = 500;
// Index by cookie count. Holding for the full box is worth double a
// single — which is the whole reason the greed decision has teeth.
const BOX_MULT = [0, 1, 1.2, 1.5, 2];

// ── Values and mess ──────────────────────────────────────────────────
const VALUE = { perfect: 100, seconds: 45, raw: 0, burnt: 0 };

const MESS = {
  spill:  8,   // dough or cookies on the floor
  burnt:  5,   // a tray of charcoal
  fireOut: 5,  // the extinguisher makes its own mess
  max:    100,
};
const INSPECT_MS    = 4000;
const INSPECT_RESET = 50;

// ── The ramp ─────────────────────────────────────────────────────────
// [easy, hard]. Lerped by smoothstep of song position: a slow open, a
// punchy middle, and a plateau at the end so the last seconds are
// survivable rather than a coin flip.
const RAMP = {
  mixMs:    [1800, 900],
  readyMs:  [2400, 900],
  bakeMs:   [2000, 1100],
  goldenMs: [1800, 700],
  beltPx:   [120, 240],    // px/sec
  stickMs:  [7000, 3000],
  leakMs:   [6000, 2600],
};
// These replaced a much slower first pass that turned out to have no skill
// gradient at all: a simulated player reacting in 700ms scored the same as one
// reacting in 140ms, because the line is strictly serial and the oven capped
// throughput at ~13 cookies with the player idle in between. Halving the cycle
// times and tripling belt speed makes the action windows comparable to a human
// reaction budget, so the stations start competing for attention. Measured over
// a full shift: 29 cookies at 140ms down to 12 at 700ms. Tune against real
// hands from here — readyMs and goldenMs are the two that decide how much the
// oven and the mixer forgive.

// The hopper only starts leaking a third of the way in — before that the
// player is still learning which key is which.
const LEAK_STARTS_AT = 0.35;

// ── Rush windows ─────────────────────────────────────────────────────
// The song is called makemecookies! x4, so it gets four. These are
// fractions of the *measured* duration, not absolute times, so they stay
// on the music if the ogg is ever re-encoded.
const RUSH_AT    = [0.18, 0.38, 0.60, 0.82];
const RUSH_MS    = 3500;
const RUSH_BELT  = 1.35;
const RUSH_SCORE = 2;

// ── End-of-shift bonuses ─────────────────────────────────────────────
const CLEAN_BONUS  = { threshold: 20, points: 500, label: 'SPOTLESS' };
const TIDY_BONUS   = { threshold: 50, points: 250, label: 'TIDY' };

const SHIFT_MS_FALLBACK = 51000;

// ── Interpolation ────────────────────────────────────────────────────
const smoothstep = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Every timing the simulation needs, resolved for right now.
 * Called once per frame and passed down — no station reads the clock.
 */
function tune(st) {
  const t = smoothstep(clamp01(st.elapsed / st.shiftMs));
  const out = {};
  for (const k in RAMP) out[k] = lerp(RAMP[k][0], RAMP[k][1], t);
  if (st.rush >= 0) out.beltPx *= RUSH_BELT;
  out.progress = t;
  return out;
}
