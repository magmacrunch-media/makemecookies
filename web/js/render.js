// =====================================================================
// render.js — makemecookies!x4
// Every pixel. Canvas 2D primitives and emoji only; no sprite sheets yet.
//
// Each station draws behind its own draw* function, so swapping any one of
// them for drawImage() off a sprite-forge sheet later is a local edit.
// =====================================================================

const BAY_Y     = 60;
const BAY_H     = 236;   // 60 .. 296
const FLOOR_TOP = 296;
const FLOOR_BOT = 320;
const METER_Y   = 336;
const METER_H   = 8;
const LABEL_Y   = 362;

const PX = "'Press Start 2P', monospace";

// ── small helpers ────────────────────────────────────────────────────

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, s, x, y, size, color, font, align) {
  ctx.font = size + 'px ' + (font || PX);
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

function glowRect(ctx, x, y, w, h, color, alpha, width) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

/** Does this station need the player right now? Drives the frame pulse. */
function wantsAttention(st, i) {
  const h = st.hopper, m = st.mixer, b = st.belt, o = st.oven, p = st.pack;
  switch (i) {
    case S.HOPPER: return h.units < HOPPER_PER_MIX || h.units >= HOPPER_MAX - 1;
    case S.MIXER:  return m.phase === 'ready' || m.phase === 'over';
    case S.BELT:   return b.items.some((it) => it.sticky) || b.items.length >= BELT_CAP;
    case S.OVEN:   return o.phase === 'golden' || o.phase === 'burning' || o.phase === 'fire';
    case S.PACK:   return p.tray.length >= TRAY_CAP;
  }
  return false;
}

/**
 * One number and one colour per station: how full, and how worried.
 * This single bar is what makes five simultaneous timers legible — the
 * machines themselves are scenery.
 */
function meterFor(st, T, i) {
  const h = st.hopper, m = st.mixer, b = st.belt, o = st.oven, p = st.pack;
  switch (i) {
    case S.HOPPER:
      return { v: h.units / HOPPER_MAX,
               c: h.units < HOPPER_PER_MIX ? C.danger : h.units >= HOPPER_MAX - 1 ? C.warn : C.ok };
    case S.MIXER:
      if (m.phase === 'idle')   return { v: 0, c: C.steelLo };
      if (m.phase === 'mixing') return { v: m.t / T.mixMs, c: C.ok };
      if (m.phase === 'ready')  return { v: 1 - m.t / T.readyMs, c: C.warn };
      return { v: 1, c: C.danger };
    case S.BELT: {
      const stuck = b.items.some((it) => it.sticky);
      return { v: b.items.length / BELT_CAP,
               c: stuck || b.items.length >= BELT_CAP ? C.danger
                 : b.items.length >= 3 ? C.warn : C.ok };
    }
    case S.OVEN:
      if (o.phase === 'empty')   return { v: 0, c: C.steelLo };
      if (o.phase === 'baking')  return { v: o.t / T.bakeMs, c: C.ok };
      if (o.phase === 'golden')  return { v: 1 - o.t / T.goldenMs, c: C.warn };
      return { v: 1, c: C.danger };
    case S.PACK:
      return { v: p.tray.length / TRAY_CAP,
               c: p.tray.length >= TRAY_CAP ? C.danger : p.tray.length ? C.ok : C.steelLo };
  }
  return { v: 0, c: C.steelLo };
}

// ── backdrop ─────────────────────────────────────────────────────────

function drawBackdrop(ctx, now) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Diner checkerboard floor band.
  for (let x = 0; x < CANVAS_W; x += 24) {
    ctx.fillStyle = ((x / 24) | 0) % 2 ? C.tile : C.panel;
    ctx.fillRect(x, FLOOR_TOP, 24, FLOOR_BOT - FLOOR_TOP);
  }
  ctx.fillStyle = 'rgba(255,46,156,0.35)';
  ctx.fillRect(0, FLOOR_TOP, CANVAS_W, 1);

  // HUD strip under the floor.
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, FLOOR_BOT, CANVAS_W, CANVAS_H - FLOOR_BOT);

  // Flickering neon sign. The flicker is deterministic on `now` so it does
  // not strobe differently for every frame rate.
  const flick = 0.72 + 0.28 * Math.abs(Math.sin(now / 190)) * (Math.sin(now / 47) > -0.9 ? 1 : 0.2);
  ctx.save();
  ctx.globalAlpha = flick;
  ctx.shadowColor = C.neon;
  ctx.shadowBlur = 18;
  text(ctx, 'MAKEMECOOKIES!', CANVAS_W / 2, 50, 20, C.neon);
  ctx.restore();
}

function drawShiftBar(ctx, st) {
  const x = 20, w = CANVAS_W - 40, y = 12, h = 10;
  ctx.fillStyle = C.panel;
  ctx.fillRect(x, y, w, h);

  const p = clamp01(st.elapsed / st.shiftMs);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, C.sprinkle);
  g.addColorStop(1, C.neon);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w * p, h);

  // Rush windows are telegraphed, not sprung — the fun is bracing for one.
  for (let i = 0; i < RUSH_AT.length; i++) {
    const tx = x + w * RUSH_AT[i];
    const tw = Math.max(3, w * (RUSH_MS / st.shiftMs));
    ctx.fillStyle = st.rush === i ? '#ffffff' : 'rgba(255,46,156,0.85)';
    ctx.fillRect(tx, y - 3, tw, h + 6);
  }

  ctx.strokeStyle = C.steelLo;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// ── 1 · HOPPER ───────────────────────────────────────────────────────
// Each station sits on the pixel grid at a fixed origin. Keeping these as
// constants rather than deriving them per frame means a sprite never
// half-steps between grid cells when a bay is resized.
// The machines are drawn at a coarser grid than the things travelling
// between them. At PIXEL they left the top third of every bay empty; at MACH
// they fill it, and the items stay at PIXEL so a ball is never wider than
// ITEM_GAP and two on the belt cannot visually overlap.
const MACH = 5;
const HOPPER_XY = [30, 118];
const MIXER_XY  = [184, 148];
const OVEN_XY   = [629, 154];
const PACK_XY   = [804, 244];

function drawHopper(ctx, st, b, now) {
  const P = PIXEL;
  const [ox, oy] = HOPPER_XY;
  const box = HOPPER_BOX;

  // Flour goes down first and the shell over the top of it, so the walls
  // stay in front of the fill instead of being buried by it.
  const filled = Math.round((st.hopper.units / HOPPER_MAX) * box.h);
  for (let i = 0; i < filled; i++) {
    ctx.fillStyle = i === filled - 1 ? PAL.D : PAL.d;
    ctx.fillRect(ox + box.col * MACH, oy + (box.row + box.h - 1 - i) * MACH,
                 box.w * MACH, MACH);
  }
  sprite(ctx, SPR_HOPPER, ox, oy, MACH);

  // A sack going in: a slug of flour falling through the open rim.
  if (now < st.hopper.lockUntil) {
    ctx.fillStyle = PAL.D;
    ctx.fillRect(ox + 9 * MACH, oy - 7 * MACH, 8 * MACH, 7 * MACH);
  }

  if (st.hopper.units < HOPPER_PER_MIX) text(ctx, 'EMPTY', b.x + b.w / 2, 272, 9, C.danger);
  else if (st.hopper.units >= HOPPER_MAX - 1) text(ctx, 'FULL', b.x + b.w / 2, 272, 9, C.warn);
}

// ── 2 · MIXER ────────────────────────────────────────────────────────

function drawMixer(ctx, st, b, now) {
  const P = PIXEL;
  const [ox, oy] = MIXER_XY;
  const m = st.mixer;

  sprite(ctx, SPR_MIXER, ox, oy, MACH);

  if (m.phase !== 'idle') {
    const tough = m.phase === 'over';
    const scale = m.phase === 'mixing' ? 4 : 5;
    sprite(ctx, SPR_BALL, ox + 14 * MACH - 4 * scale, oy + 17 * MACH - 8 * scale,
           scale, { X: tough ? PAL.T : PAL.D });
  }

  // The whisk steps between four half-widths instead of rotating: a rotated
  // line shimmers on a pixel grid, a stepping bar reads as spin.
  const half = m.phase === 'mixing' ? WHISK_HALF[((now / 90) | 0) % 4] : 3;
  ctx.fillStyle = PAL.H;
  ctx.fillRect(ox + (14 - half) * MACH, oy + 9 * MACH, MACH, 6 * MACH);
  ctx.fillRect(ox + (14 + half) * MACH, oy + 9 * MACH, MACH, 6 * MACH);
  ctx.fillRect(ox + (14 - half) * MACH, oy + 15 * MACH, (half * 2 + 1) * MACH, MACH);

  if (m.phase === 'over') text(ctx, 'TOUGH', b.x + b.w / 2, 272, 9, C.danger);
  else if (m.phase === 'ready') text(ctx, 'READY', b.x + b.w / 2, 272, 9, C.ok);
}

// ── 3 · CONVEYOR ─────────────────────────────────────────────────────

function drawBelt(ctx, st, b, now) {
  const P = PIXEL;
  const y = BELT_Y;
  const x0 = snap(BELT_X0 - 24), x1 = snap(BELT_X1 + 24);
  const wCells = (x1 - x0) / P;

  cells(ctx, x0, y, wCells, 1, PAL.H);
  cells(ctx, x0, y + P, wCells, 3, PAL.S);
  cells(ctx, x0, y + 4 * P, wCells, 1, PAL.s);

  // Treads scroll in whole cells at the belt's real speed, so a boost or a
  // jam is legible from the tread motion alone, with no label.
  const T = st.__T || { beltPx: RAMP.beltPx[0] };
  const spd = now < st.belt.boostUntil ? T.beltPx * 2.2 : T.beltPx;
  const off = Math.floor(now * spd / 1000 / P) % 5;
  ctx.fillStyle = PAL.s;
  for (let c = off; c < wCells; c += 5) {
    ctx.fillRect(x0 + c * P, y + P, P, 3 * P);
  }

  for (const rx of [x0 - 2 * P, x1]) {
    ctx.fillStyle = PAL.S;
    ctx.fillRect(rx, y - P, 2 * P, 7 * P);
    ctx.fillStyle = PAL.H;
    ctx.fillRect(rx, y - P, 2 * P, P);
  }

  for (const it of st.belt.items) {
    const ix = snap(it.x - 16), iy = y - 8 * P;
    sprite(ctx, SPR_BALL, ix, iy, P, { X: it.quality === 'tough' ? PAL.T : PAL.D });
    if (it.sticky) {
      ctx.fillStyle = PAL.R;
      ctx.fillRect(ix - P, iy - P, 10 * P, P);
      ctx.fillRect(ix - P, iy + 8 * P, 10 * P, P);
      ctx.fillRect(ix - P, iy, P, 8 * P);
      ctx.fillRect(ix + 8 * P, iy, P, 8 * P);
      text(ctx, '!', ix + 16, iy - 10, 10, C.danger);
    }
  }

  // The most common stall is the oven, not the belt: the lead ball parks at
  // the mouth and the line backs up behind a closed door. Pressing 3 does
  // nothing for that, so name the real blocker — in the oven's gold, not the
  // jam's red, so the two failure modes stay distinguishable.
  const head = st.belt.items[0];
  if (head && !head.sticky && head.x >= BELT_X1 - 1 && st.oven.phase !== 'empty') {
    const baking = st.oven.phase === 'baking';
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(now / 130));
    text(ctx, 'OVEN BUSY', BELT_X1 - 44, y - 44, 9, C.butter);
    // Saying "press 4" during the bake would be bad advice: it yields a raw
    // cookie worth nothing. Only say it once pulling actually pays.
    text(ctx, baking ? 'WAIT' : 'PRESS 4', BELT_X1 - 44, y - 30, 8,
         baking ? C.steel : C.butter);
    ctx.restore();
  }

  if (now < st.belt.boostUntil) {
    text(ctx, '>> BOOST >>', (x0 + x1) / 2, y + 38, 9, C.sprinkle);
  }
}

// ── 4 · OVEN ─────────────────────────────────────────────────────────

function drawOven(ctx, st, b, now) {
  const P = PIXEL;
  const [ox, oy] = OVEN_XY;
  const o = st.oven;

  sprite(ctx, SPR_OVEN, ox, oy, MACH, { W: OVEN_GLASS[o.phase] });

  if (o.phase === 'fire') {
    const f = SPR_FLAME[((now / 110) | 0) % 2];
    for (const dx of [7, 14, 21]) {
      sprite(ctx, f, ox + dx * MACH, oy + 8 * MACH, MACH);
    }
  } else if (o.phase !== 'empty') {
    const col = o.phase === 'baking' ? PAL.D : o.phase === 'golden' ? PAL.G : PAL.B;
    sprite(ctx, SPR_COOKIE, ox + 12 * MACH, oy + 6 * MACH, MACH, { X: col });
    if (o.phase === 'burning') {
      const drift = ((now / 160) | 0) % 3;
      sprite(ctx, SPR_SMOKE, ox + (14 + drift) * MACH, oy - 4 * MACH, MACH);
    }
  }

  const capY = oy + spriteH(SPR_OVEN, MACH) + 14;
  if (o.phase === 'fire') {
    const need = FIRE_TAPS - o.taps.filter((t) => now - t < FIRE_TAP_WINDOW).length;
    text(ctx, 'MASH 4 x' + Math.max(1, need), b.x + b.w / 2, capY, 9, C.danger);
  } else if (o.phase === 'burning') {
    text(ctx, 'BURNING', b.x + b.w / 2, capY, 9, C.danger);
  } else if (o.phase === 'golden') {
    text(ctx, 'PULL IT', b.x + b.w / 2, capY, 9, C.butter);
  }
}

// ── 5 · PACKING ──────────────────────────────────────────────────────

const TRAY_COLOR = { perfect: PAL.G, seconds: PAL.T, raw: PAL.D, burnt: PAL.B };

function drawPack(ctx, st, b, now) {
  const P = PIXEL;
  const [ox, oy] = PACK_XY;
  const p = st.pack;

  sprite(ctx, SPR_TABLE, ox, oy, MACH);

  // Bottom row sits *on* the tabletop rather than hovering above it — a gap
  // there read as cookies floating in mid-air.
  p.tray.forEach((g, i) => {
    sprite(ctx, SPR_COOKIE,
           ox + 14 + (i % 2) * 60,
           oy - 32 - (((i / 2) | 0) * 34),
           P, { X: TRAY_COLOR[g] });
  });

  for (const f of p.flying) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - f.t / 900);
    sprite(ctx, SPR_BOX, snap(ox + 34 + f.t * 0.14), snap(oy - 44 - f.t * 0.05));
    ctx.restore();
  }

  if (p.tray.length >= TRAY_CAP) text(ctx, 'SHIP IT', b.x + b.w / 2, 272, 9, C.danger);
  else if (p.tray.length) text(ctx, 'x' + BOX_MULT[p.tray.length], b.x + b.w / 2, 272, 9, C.butter);
}

// ── station chrome ───────────────────────────────────────────────────

function drawBayChrome(ctx, st, T, i, now) {
  const b = BAYS[i];
  const want = wantsAttention(st, i);
  const pulse = want ? 0.55 + 0.45 * Math.abs(Math.sin(now / 120)) : 0.28;
  glowRect(ctx, b.x, BAY_Y, b.w, BAY_H, b.color, pulse, want ? 2.5 : 1.5);

  // Meter.
  const m = meterFor(st, T, i);
  const mx = b.x + 10, mw = b.w - 20;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(mx, METER_Y, mw, METER_H);
  ctx.fillStyle = m.c;
  ctx.fillRect(mx, METER_Y, mw * clamp01(m.v), METER_H);
  ctx.strokeStyle = C.steelLo;
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, METER_Y + 0.5, mw - 1, METER_H - 1);

  // Keycap.
  const kx = b.x + 10, ky = LABEL_Y - 13;
  ctx.fillStyle = want ? b.color : C.tile;
  rr(ctx, kx, ky, 18, 18, 3);
  ctx.fill();
  ctx.strokeStyle = b.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, b.key, kx + 9, ky + 13, 10, want ? C.bg : b.color);

  text(ctx, b.name, kx + 26, LABEL_Y, 9, want ? b.color : C.steel, PX, 'left');
}

// ── overlays ─────────────────────────────────────────────────────────

function drawMessMeter(ctx, st) {
  const w = 220, x = CANVAS_W - w - 20, y = 392, h = 10;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, w, h);
  const v = clamp01(st.mess / MESS.max);
  ctx.fillStyle = v > 0.75 ? C.danger : v > 0.45 ? C.warn : C.ok;
  ctx.fillRect(x, y, w * v, h);
  ctx.strokeStyle = C.steelLo;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  text(ctx, 'MESS', x - 8, y + 9, 9, C.steel, PX, 'right');
}

function drawFx(ctx, st, now) {
  for (const s of st.fx.spills) {
    const a = Math.max(0, 1 - s.t / 1400);
    ctx.save();
    ctx.globalAlpha = a * 0.8;
    // A sprite, not an ellipse: one smooth curve is enough to give the
    // whole pixel grid away.
    const sc = Math.round(3 + Math.min(2, s.t / 500));
    sprite(ctx, SPR_SPLAT, snap(s.x - 5 * sc), snap(s.y + 4), sc, { X: PAL.D });
    ctx.restore();
  }
  for (const p of st.fx.pops) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.born / 900);
    text(ctx, p.text, p.x, p.y - p.born * 0.03, 11, p.color);
    ctx.restore();
  }
  if (st.fx.toast) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - st.fx.toast.t / 1300);
    text(ctx, st.fx.toast.text, CANVAS_W / 2, 110, 11, st.fx.toast.color);
    ctx.restore();
  }
}

function drawRush(ctx, st, now) {
  if (st.rush < 0) return;
  const a = 0.6 + 0.4 * Math.abs(Math.sin(now / 90));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(255,46,156,0.18)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.shadowColor = C.neon;
  ctx.shadowBlur = 16;
  text(ctx, 'MAKE ME COOKIES!  x' + (st.rush + 1), CANVAS_W / 2, 78, 16, '#ffffff');
  ctx.restore();
}

function drawInspection(ctx, st, now) {
  if (now >= st.inspectUntil) return;
  const left = Math.ceil((st.inspectUntil - now) / 1000);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = 'rgba(255,59,59,0.9)';
  ctx.fillRect(0, 160, CANVAS_W, 90);
  text(ctx, 'HEALTH INSPECTION', CANVAS_W / 2, 200, 20, '#ffffff');
  text(ctx, 'LINE STOPPED — ' + left, CANVAS_W / 2, 228, 11, '#2A0808');
}

// ── the frame ────────────────────────────────────────────────────────

function render() {
  const now = performance.now();
  const T = st.__T || tune(st);

  ctx.save();
  if (st.fx.shake > 0.2) {
    ctx.translate((Math.random() - 0.5) * st.fx.shake,
                  (Math.random() - 0.5) * st.fx.shake);
  }

  drawBackdrop(ctx, now);
  drawShiftBar(ctx, st);

  drawHopper(ctx, st, BAYS[S.HOPPER], now);
  drawMixer(ctx, st, BAYS[S.MIXER], now);
  drawBelt(ctx, st, BAYS[S.BELT], now);
  drawOven(ctx, st, BAYS[S.OVEN], now);
  drawPack(ctx, st, BAYS[S.PACK], now);

  for (let i = 0; i < BAYS.length; i++) drawBayChrome(ctx, st, T, i, now);

  drawMessMeter(ctx, st);
  drawFx(ctx, st, now);
  drawRush(ctx, st, now);
  drawInspection(ctx, st, now);

  ctx.restore();
}
