// =====================================================================
// pixels.js — makemecookies!x4
// Pixel-art sprite data and the tiny blitter that draws it.
//
// Sprites are authored as string rows, one character per pixel, so they
// can be edited by eye in a text editor. Everything is drawn on a PIXEL-
// sized grid and every position is snapped to it, which is what actually
// sells the look — a smooth-moving sprite on a chunky grid reads as a
// bug. Text and meters stay at full canvas resolution on purpose: a
// low-res backing store would render Press Start 2P at 3px and make the
// whole HUD illegible.
// =====================================================================

const PIXEL = 4;

const snap = (v) => Math.round(v / PIXEL) * PIXEL;

// Shared character palette. Lowercase letters are the shadow of their
// uppercase counterpart, so a sprite reads as lit from the top-left.
const PAL = {
  K: '#1A0E1C',   // outline, near-black plum
  S: '#8E7B96',   // steel
  s: '#5C4C64',   // steel shadow
  H: '#B9A6C1',   // steel highlight
  D: '#F2D8A7',   // dough
  d: '#D6BC8B',   // dough shadow
  T: '#C9A97B',   // overmixed dough / cardboard
  t: '#A98A5F',   // its shadow
  G: '#FFC93C',   // butter, baked golden
  g: '#D9A420',   // its shadow
  O: '#FF7C1F',   // oven orange
  R: '#FF3B3B',   // danger
  P: '#FF2E9C',   // neon pink
  M: '#41E8D1',   // mint
  C: '#4B2E1E',   // chocolate
  B: '#2A1A12',   // burnt
  W: '#EAD9EC',   // near-white
  n: '#26122A',   // panel dark
  X: '#F2D8A7',   // recolourable: overridden per call
};

/**
 * Blit a string-row sprite. Runs of the same character become one
 * fillRect, which keeps a full frame in the low hundreds of draw calls
 * rather than the low thousands.
 */
function sprite(ctx, rows, ox, oy, scale, over) {
  const s = scale || PIXEL;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      if (ch === '.' || ch === ' ') { c++; continue; }
      let n = 1;
      while (c + n < row.length && row[c + n] === ch) n++;
      const col = (over && over[ch]) || PAL[ch];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(ox + c * s, oy + r * s, n * s, s);
      }
      c += n;
    }
  }
}

/** A rectangle measured in grid cells rather than pixels. */
function cells(ctx, cx, cy, cw, ch, color, scale) {
  const s = scale || PIXEL;
  ctx.fillStyle = color;
  ctx.fillRect(cx, cy, cw * s, ch * s);
}

const spriteH = (rows, s) => rows.length * (s || PIXEL);

// ── 1 · HOPPER ───────────────────────────────────────────────────────
// 26 x 26. Interior is rows 2-10, cols 3-22 — flour is drawn into that
// box first and the shell blitted over it, so the walls stay in front.
const SPR_HOPPER = [
  '..SSSSSSSSSSSSSSSSSSSSSS..',
  '..SHHHHHHHHHHHHHHHHHHHHS..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..S....................S..',
  '..s....................s..',
  '...S..................S...',
  '...s..................s...',
  '....S................S....',
  '.....S..............S.....',
  '......S............S......',
  '.......S..........S.......',
  '........S........S........',
  '.........S......S.........',
  '..........S....S..........',
  '...........S..S...........',
  '...........S..S...........',
  '..........SSssSS..........',
  '..........SsssSS..........',
  '..........SSSSSS..........',
];
const HOPPER_BOX = { col: 3, row: 2, w: 20, h: 9 };

// ── 2 · MIXER ────────────────────────────────────────────────────────
// 28 x 20. Bowl interior is roughly rows 10-16, centred on col 14.
const SPR_MIXER = [
  '.........SSSSSSSSSS.........',
  '.........SHHHHHHHHS.........',
  '.........SHssssssHS.........',
  '.........SHHHHHHHHS.........',
  '.........SSSSSSSSSS.........',
  '............SssS............',
  '............SssS............',
  '............SssS............',
  'SSSSSSSSSSSSSSSSSSSSSSSSSSSS',
  'SHHHHHHHHHHHHHHHHHHHHHHHHHHS',
  'Ss........................sS',
  '.S........................S.',
  '.S........................S.',
  '.S........................S.',
  '..S......................S..',
  '..s......................s..',
  '...S....................S...',
  '....SS................SS....',
  '......SSS..........SSS......',
  '.........SSSSSSSSSS.........',
];

// The whisk is four frames of half-width rather than a rotation: on a
// pixel grid a rotated line shimmers, but a bar stepping in and out of
// the centre reads cleanly as spin.
const WHISK_HALF = [5, 3, 1, 3];

// ── 4 · OVEN ─────────────────────────────────────────────────────────
// 32 x 24. The door glass is 'W', recoloured per phase by the caller.
const SPR_OVEN = [
  'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
  'SHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHS',
  'SH............................HS',
  'SH.KKKKKKKKKKKKKKKKKKKKKKKKKK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KWWWWWWWWWWWWWWWWWWWWWWWWK.HS',
  'SH.KKKKKKKKKKKKKKKKKKKKKKKKKK.HS',
  'SH............................HS',
  'SH...GG....GG.................HS',
  'SH............................HS',
  'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
  '.s............................s.',
  '.S............................S.',
  '.SS..........................SS.',
];
// Door glass, by oven phase.
const OVEN_GLASS = {
  empty:   '#1A0E1C',
  baking:  '#3E2714',
  golden:  '#B85C12',
  burning: '#3A1608',
  fire:    '#7A1E08',
};

// ── 5 · PACKING ──────────────────────────────────────────────────────
const SPR_TABLE = [
  'SSSSSSSSSSSSSSSSSSSSSSSSSS',
  'SHHHHHHHHHHHHHHHHHHHHHHHHS',
  'SssssssssssssssssssssssssS',
  '..SS..................SS..',
  '..SS..................SS..',
  '..SS..................SS..',
  '..ss..................ss..',
];

const SPR_BOX = [
  'CCCCCCCCCC',
  'CTTTTTTTTC',
  'CTTTTTTTTC',
  'CTTTWWTTTC',
  'CTTTWWTTTC',
  'CTTTWWTTTC',
  'CTTTTTTTTC',
  'CCCCCCCCCC',
];

// ── Items on the line ────────────────────────────────────────────────
// 'X' is recoloured per call so one ball serves dough and overmixed dough.
const SPR_BALL = [
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
];

const SPR_COOKIE = [
  '..XXXX..',
  '.XXCXXX.',
  'XXXXXXCX',
  'XCXXXXXX',
  'XXXXXCXX',
  'XXCXXXXX',
  '.XXXXXX.',
  '..XXXX..',
];

// Two flame frames, alternated. Emoji would break the grid — they render
// at whatever size the system font decides and antialias against it.
const SPR_FLAME = [
  [
    '...O....',
    '..OO.O..',
    '.OOOOOO.',
    'OOGGGOOO',
    'OOGGGGOO',
    '.OGGGGO.',
    '..OGGO..',
    '...OO...',
  ],
  [
    '....O...',
    '..O.OO..',
    '.OOOOOO.',
    'OOOGGGOO',
    'OOGGGGOO',
    '.OGGGGO.',
    '..OGGO..',
    '...OO...',
  ],
];

// Rising smoke, three frames.
const SPR_SMOKE = [
  '.ss.',
  'sSs.',
  '.sSs',
  '.ss.',
];

// A pull-tab of dough left mid-air when something spills.
const SPR_SPLAT = [
  '.X..X...X.',
  'XXXXXXXXXX',
  '.XXXXXXXX.',
];
