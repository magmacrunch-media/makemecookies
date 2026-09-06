// =====================================================================
// stations.js — makemecookies!x4
// The five machines and the item flow between them.
//
// Deliberately DOM-free and audio-free. Everything here is a function of
// (state, tuning, dt), so the numbers in config.js can be tuned against a
// headless harness, and render.js can be swapped for sprite draws without
// touching a line of logic. Visual effects are pushed onto st.fx as plain
// data for the renderer to read — never drawn from here.
// =====================================================================

function createShift() {
  return {
    // clock — written by main.js from the song's currentTime
    elapsed: 0,
    shiftMs: SHIFT_MS_FALLBACK,
    startedAt: 0,
    rush: -1,          // index into RUSH_AT, or -1

    // outcome
    score: 0,
    shipped: 0,
    mess: 0,
    inspectUntil: 0,
    inspections: 0,

    hopper: { units: 4, lockUntil: 0, nextLeakAt: 0 },
    mixer:  { phase: 'idle', t: 0, quality: 'good' },
    belt:   { items: [], boostUntil: 0, nextStickAt: 0 },
    oven:   { phase: 'empty', t: 0, quality: 'good', taps: [] },
    pack:   { tray: [], boxUntil: 0, flying: [] },

    fx: { spills: [], pops: [], toast: null, shake: 0 },
  };
}

/** Called once when the shift starts, after shiftMs is known. */
function armShift(st, T, now) {
  st.startedAt = now;
  st.belt.nextStickAt = now + T.stickMs;
  st.hopper.nextLeakAt = 0;
}

// ── fx helpers (data only) ───────────────────────────────────────────

function pop(st, text, x, y, color) {
  st.fx.pops.push({ text, x, y, born: 0, color });
}

function toast(st, text, color) {
  st.fx.toast = { text, color, t: 0 };
}

function spill(st, x, y, amount) {
  st.fx.spills.push({ x, y, t: 0 });
  st.fx.shake = Math.max(st.fx.shake, 6);
  addMess(st, amount);
}

function addMess(st, amount) {
  st.mess = Math.min(MESS.max + 1, st.mess + amount);
}

// ── 1 · HOPPER ───────────────────────────────────────────────────────

function pressHopper(st, T, now) {
  const h = st.hopper;
  if (now < h.lockUntil) return;

  // Mashing `1` is not free. At 5 or 6 units the sack goes over the side.
  if (h.units >= HOPPER_MAX - 1) {
    h.units = Math.max(0, h.units - 1);
    h.lockUntil = now + SPILL_LOCK_MS;
    spill(st, BAYS[S.HOPPER].x + 60, FLOOR_Y, MESS.spill);
    toast(st, 'FLOUR EVERYWHERE', C.danger);
    return;
  }

  h.units = Math.min(HOPPER_MAX, h.units + HOPPER_PER_SACK);
  h.lockUntil = now + POUR_MS;
}

function updateHopper(st, T, dtMs, now) {
  const h = st.hopper;
  if (T.progress < LEAK_STARTS_AT) return;

  // The leak starts mid-shift, so the hopper stops being a fire-and-forget
  // station right about when the mixer stops leaving you spare hands.
  if (h.nextLeakAt === 0) { h.nextLeakAt = now + T.leakMs; return; }
  if (now >= h.nextLeakAt) {
    h.units = Math.max(0, h.units - 1);
    h.nextLeakAt = now + T.leakMs;
  }
}

// ── 2 · MIXER ────────────────────────────────────────────────────────

function pressMixer(st, T, now) {
  const m = st.mixer;

  if (m.phase === 'idle') {
    if (st.hopper.units < HOPPER_PER_MIX) { toast(st, 'NO FLOUR', C.danger); return; }
    st.hopper.units -= HOPPER_PER_MIX;
    m.phase = 'mixing'; m.t = 0; m.quality = 'good';
    return;
  }

  if (m.phase === 'ready' || m.phase === 'over') {
    pushOnBelt(st, m.quality);
    m.phase = 'idle'; m.t = 0;
  }
  // 'mixing' → nothing. There is no way to rush a batch, and that is the
  // point: the mixer sets the tempo everything else has to keep up with.
}

function updateMixer(st, T, dtMs) {
  const m = st.mixer;
  m.t += dtMs;

  if (m.phase === 'mixing' && m.t >= T.mixMs) {
    m.phase = 'ready'; m.t = 0;
  } else if (m.phase === 'ready' && m.t >= T.readyMs) {
    // Neglect degrades rather than blocks. The overmixed ball is still
    // sitting there and still has to be pressed out — it is just worth 45
    // instead of 100.
    m.phase = 'over'; m.quality = 'tough'; m.t = 0;
  }
}

// ── 3 · CONVEYOR ─────────────────────────────────────────────────────

function pushOnBelt(st, quality) {
  const b = st.belt;
  const last = b.items[b.items.length - 1];
  // Full, or the tail of a jam is still sitting under the mixer — either way
  // there is nowhere to put this ball. Checking the entry as well as the count
  // is what stops a jam from stacking dough on top of itself, and it is what
  // makes "stuck belt plus working mixer" cost a whole batch.
  if (b.items.length >= BELT_CAP || (last && last.x < BELT_X0 + ITEM_GAP)) {
    spill(st, BELT_X0, FLOOR_Y, MESS.spill);
    toast(st, 'BELT FULL', C.danger);
    return;
  }
  b.items.push({ quality, x: BELT_X0, sticky: false });
}

function updateBelt(st, T, dtMs, now) {
  const b = st.belt;
  const speed = (now < b.boostUntil ? T.beltPx * 2.2 : T.beltPx) * dtMs / 1000;

  // items[0] is nearest the oven. Walking front-to-back means each item's
  // blocker has already moved this frame, so a queue closes up in one pass
  // instead of one item per frame.
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i];
    if (it.sticky) continue;                     // a stuck item is a wall
    const ahead = b.items[i - 1];
    const limit = ahead ? ahead.x - ITEM_GAP : BELT_X1;
    if (limit > it.x) it.x = Math.min(it.x + speed, limit);
  }

  // Hand off only if the oven will take it. If it won't, the queue backs up
  // and it is the mixer's next ejection that pays for it.
  const head = b.items[0];
  if (head && head.x >= BELT_X1 - 0.5 && st.oven.phase === 'empty') {
    b.items.shift();
    loadOven(st, head.quality);
  }

  if (now >= b.nextStickAt) {
    const free = b.items.filter((i) => !i.sticky);
    if (free.length) {
      free[(Math.random() * free.length) | 0].sticky = true;
      toast(st, 'BELT JAM', C.warn);
    }
    b.nextStickAt = now + T.stickMs;
  }
}

function pressBelt(st, T, now) {
  st.belt.boostUntil = now + 900;
  for (const it of st.belt.items) it.sticky = false;
}

// ── 4 · OVEN ─────────────────────────────────────────────────────────

function loadOven(st, quality) {
  const o = st.oven;
  o.phase = 'baking'; o.t = 0; o.quality = quality;
}

function updateOven(st, T, dtMs) {
  const o = st.oven;
  if (o.phase === 'empty') return;

  o.t += dtMs;
  if (o.phase === 'baking' && o.t >= T.bakeMs) {
    o.phase = 'golden'; o.t = 0;
  } else if (o.phase === 'golden' && o.t >= T.goldenMs) {
    o.phase = 'burning'; o.t = 0;
  } else if (o.phase === 'burning' && o.t >= BURN_TO_FIRE_MS) {
    o.phase = 'fire'; o.t = 0; o.taps = [];
    toast(st, 'FIRE!', C.danger);
  } else if (o.phase === 'fire') {
    addMess(st, FIRE_MESS_RATE * dtMs / 1000);
  }
}

function pressOven(st, T, now) {
  const o = st.oven;

  if (o.phase === 'fire') {
    // Three taps inside two seconds — a mash, not a hold. A hold would let
    // you park on `4` and ignore everything else while it went out.
    o.taps = o.taps.filter((t) => now - t < FIRE_TAP_WINDOW);
    o.taps.push(now);
    if (o.taps.length >= FIRE_TAPS) {
      o.phase = 'empty'; o.t = 0; o.taps = [];
      addMess(st, MESS.fireOut);
      toast(st, 'FIRE OUT', C.ok);
    }
    return;
  }

  if (o.phase === 'empty') return;

  let grade;
  if (o.phase === 'baking') {
    grade = 'raw';                                  // panic move: frees the oven
  } else if (o.phase === 'golden') {
    grade = o.quality === 'good' ? 'perfect' : 'seconds';
  } else {
    grade = 'burnt';
    addMess(st, MESS.burnt);
  }

  o.phase = 'empty'; o.t = 0;
  toPack(st, grade, now);
}

// ── 5 · PACKING ──────────────────────────────────────────────────────

function toPack(st, grade, now) {
  const p = st.pack;
  if (p.tray.length >= TRAY_CAP) {
    spill(st, BAYS[S.PACK].x + 40, FLOOR_Y, MESS.spill);
    toast(st, 'TRAY OVERFLOW', C.danger);
    return;
  }
  p.tray.push(grade);
  if (grade === 'perfect') pop(st, 'PERFECT', BAYS[S.OVEN].x + 80, 200, C.ok);
}

function pressPack(st, T, now) {
  const p = st.pack;
  if (now < p.boxUntil || p.tray.length === 0) return;

  const n = p.tray.length;
  const sum = p.tray.reduce((a, g) => a + VALUE[g], 0);
  const mult = BOX_MULT[n] * (st.rush >= 0 ? RUSH_SCORE : 1);
  const gained = Math.round(sum * mult);

  st.score += gained;
  st.shipped += p.tray.filter((g) => VALUE[g] > 0).length;

  if (gained > 0) {
    pop(st, '+' + gained, BAYS[S.PACK].x + 60, 190,
        st.rush >= 0 ? C.neon : C.butter);
  }

  p.tray = [];
  p.boxUntil = now + BOX_MS;
  p.flying.push({ x: BAYS[S.PACK].x + 70, t: 0 });
}

function updatePack(st, T, dtMs, now) {
  const p = st.pack;
  for (const f of p.flying) f.t += dtMs;
  p.flying = p.flying.filter((f) => f.t < 900);
}

// ── The shift ────────────────────────────────────────────────────────

function updateShift(st, dtMs, now) {
  const T = tune(st);

  // fx ages even during an inspection — a frozen screen with frozen smoke
  // reads as a crash rather than a penalty.
  ageFx(st, dtMs);

  // The inspector freeze is the only thing that stops the line, and the
  // song keeps playing straight through it. That is precisely the penalty:
  // in a fixed-length round, four seconds is the currency.
  if (now < st.inspectUntil) return T;

  updateHopper(st, T, dtMs, now);
  updateMixer(st, T, dtMs);
  updateBelt(st, T, dtMs, now);
  updateOven(st, T, dtMs);
  updatePack(st, T, dtMs, now);

  if (st.mess >= MESS.max) {
    st.inspectUntil = now + INSPECT_MS;
    st.mess = INSPECT_RESET;
    st.inspections++;
    toast(st, 'HEALTH INSPECTION', C.danger);
  }

  return T;
}

function ageFx(st, dtMs) {
  const fx = st.fx;
  for (const s of fx.spills) s.t += dtMs;
  fx.spills = fx.spills.filter((s) => s.t < 1400);
  for (const p of fx.pops) p.born += dtMs;
  fx.pops = fx.pops.filter((p) => p.born < 900);
  if (fx.toast) { fx.toast.t += dtMs; if (fx.toast.t > 1300) fx.toast = null; }
  fx.shake = Math.max(0, fx.shake - dtMs / 45);
}

/** Final scoring. Returns the bonus applied, or null. */
function settleShift(st) {
  if (st.mess < CLEAN_BONUS.threshold) {
    st.score += CLEAN_BONUS.points;
    return CLEAN_BONUS;
  }
  if (st.mess < TIDY_BONUS.threshold) {
    st.score += TIDY_BONUS.points;
    return TIDY_BONUS;
  }
  return null;
}

// Bay index → the function that acts on it. Order matches BAYS / S.
const PRESS = [pressHopper, pressMixer, pressBelt, pressOven, pressPack];
