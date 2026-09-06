/**
 * test-simulation.js — makemecookies!x4 headless tests.
 *
 * js/config.js and js/stations.js are plain scripts that assign globals and
 * touch no DOM at all — that separation is deliberate, so the rules can be
 * exercised without a browser. The real shipped files are loaded into a vm
 * context and run. Nothing here is a reimplementation that could drift from
 * what ships.
 *
 * What this guards, in order of how much it would hurt:
 *
 *  1. The health inspector. The MESS meter filling to 100 freezes the line for
 *     four seconds, and it is the only failure state the game has. In a shift
 *     played competently it never fires, so it is the least-exercised path in
 *     the game and the one most likely to rot unnoticed — it has never once
 *     been seen in real play. Asserted here on both halves: that it triggers,
 *     and that the line really is frozen while it lasts.
 *
 *  2. The cascade. A jammed belt plus a working mixer is supposed to cost a
 *     whole batch, and that only holds if pushOnBelt refuses when the entry is
 *     occupied as well as when the belt is full. Without the entry check the
 *     dough silently stacks on itself instead — the bug looks like nothing at
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
 *  5. Frame-rate independence. Every quantity is scaled by dt, and the shift
 *     clock comes from the song rather than a frame counter. Three step sizes
 *     covering the same wall-clock time must agree.
 *
 * Run: node test-simulation.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');

// ── Harness ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function ok(cond, name, detail) {
    if (cond) { passed++; console.log('  PASS  ' + name); }
    else { failed++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

function eq(actual, expected, name) {
    ok(actual === expected, name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function near(a, b, tol, name) {
    ok(Math.abs(a - b) <= tol, name, `got ${a}, expected ${b} +/- ${tol}`);
}

/** Deterministic PRNG so a jam lands in the same place every run. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A fresh context holding the shipped rules, with randomness pinned.
 *
 * Both files declare their functions with `function` and their constants with
 * `const`. In a vm script only the former land on the context object -- `const`
 * goes to the global *lexical* scope, which is reachable from later scripts in
 * the same context but never as a property. So the constants are bridged over
 * explicitly rather than read off ctx, where they would silently be undefined
 * and every comparison against them would quietly pass.
 */
const CONSTANTS = [
    'C', 'BAYS', 'S', 'FLOOR_Y', 'BELT_X0', 'BELT_X1', 'ITEM_GAP', 'BELT_CAP',
    'HOPPER_MAX', 'HOPPER_PER_SACK', 'HOPPER_PER_MIX', 'POUR_MS', 'SPILL_LOCK_MS',
    'BURN_TO_FIRE_MS', 'FIRE_TAPS', 'FIRE_TAP_WINDOW', 'FIRE_MESS_RATE',
    'TRAY_CAP', 'BOX_MS', 'BOX_MULT', 'VALUE', 'MESS', 'INSPECT_MS',
    'INSPECT_RESET', 'RAMP', 'LEAK_STARTS_AT', 'RUSH_AT', 'RUSH_MS', 'RUSH_BELT',
    'RUSH_SCORE', 'CLEAN_BONUS', 'TIDY_BONUS', 'SHIFT_MS_FALLBACK',
    'smoothstep', 'lerp', 'clamp01', 'PRESS',
];

function load(seed = 1) {
    const ctx = vm.createContext({ console, Math: Object.create(Math) });
    ctx.Math.random = mulberry32(seed);
    for (const f of ['config.js', 'stations.js']) {
        vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
    }
    vm.runInContext(
        `globalThis.__k = { ${CONSTANTS.join(', ')} };`, ctx, { filename: 'bridge' });
    for (const k of CONSTANTS) {
        if (ctx.__k[k] === undefined) throw new Error(`constant ${k} did not load`);
        ctx[k] = ctx.__k[k];
    }
    return ctx;
}

/** A shift with a known length, armed at a known clock. */
function shift(ctx, at = 1e6) {
    const st = ctx.createShift();
    st.shiftMs = 51248;
    st.elapsed = 0;
    ctx.armShift(st, ctx.tune(st), at);
    return st;
}

/** Advance `ms` of simulated time in `step`-sized slices. */
function run(ctx, st, clock, ms, step = 33) {
    for (let i = 0; i < ms / step; i++) {
        clock.t += step;
        ctx.updateShift(st, step, clock.t);
    }
    return clock.t;
}

// ── 1. The health inspector ───────────────────────────────────────────────────

console.log('\nhealth inspector — the only failure state, and the least played');
{
    const ctx = load();
    const c = { t: 1e6 };
    const st = shift(ctx, c.t);

    st.mess = 99;
    st.oven.phase = 'fire';               // 12 mess/sec, so it crosses within a step

    // Stepped one frame at a time so the trigger instant is known. Measuring
    // the freeze from the end of a multi-frame run instead reports it short by
    // however long the run continued after it fired.
    let firedAt = null;
    for (let i = 0; i < 30 && firedAt === null; i++) {
        c.t += 33;
        ctx.updateShift(st, 33, c.t);
        if (st.inspectUntil) firedAt = c.t;
    }

    ok(firedAt !== null, 'crossing 100 mess summons the inspector');
    eq(st.inspections, 1, 'the visit is counted');
    eq(st.mess, ctx.INSPECT_RESET, 'mess resets to INSPECT_RESET, not to zero');
    eq(st.inspectUntil - firedAt, ctx.INSPECT_MS, 'the freeze lasts exactly INSPECT_MS');

    // The line must actually stop. A freeze that still runs the oven would let
    // a fire keep burning through the penalty it caused.
    const ovenBefore = st.oven.phase, messBefore = st.mess, tBefore = st.oven.t;
    run(ctx, st, c, 1000);
    eq(st.oven.phase, ovenBefore, 'oven does not advance while frozen');
    eq(st.oven.t, tBefore, 'oven timer does not advance while frozen');
    near(st.mess, messBefore, 0.001, 'mess does not accrue while frozen');

    // ...and must resume afterwards.
    run(ctx, st, c, 3500);
    ok(st.oven.t > tBefore, 'the line resumes once the inspector leaves');
}

// ── 2. The cascade: a jam must cost a batch, not stack dough ──────────────────

console.log('\nthe cascade — a jammed belt plus a working mixer');
{
    const ctx = load();
    const c = { t: 2e6 };
    const st = shift(ctx, c.t);

    ctx.pushOnBelt(st, 'good');
    st.belt.items[0].sticky = true;       // jam right at the entry

    const before = st.mess;
    ctx.pushOnBelt(st, 'good');
    ctx.pushOnBelt(st, 'good');

    eq(st.belt.items.length, 1, 'dough is refused while the entry is blocked');
    eq(st.mess - before, ctx.MESS.spill * 2, 'each refused batch costs a spill');

    const xs = st.belt.items.map((i) => i.x);
    eq(new Set(xs).size, xs.length, 'no two items share a position');
}

// A belt that is merely full, rather than jammed at the entry, also refuses.
{
    const ctx = load();
    const st = shift(ctx, 3e6);
    for (let i = 0; i < ctx.BELT_CAP; i++) st.belt.items.push({ quality: 'good', x: ctx.BELT_X1 - i * ctx.ITEM_GAP, sticky: false });
    const before = st.mess;
    ctx.pushOnBelt(st, 'good');
    eq(st.belt.items.length, ctx.BELT_CAP, 'a full belt takes no more');
    eq(st.mess - before, ctx.MESS.spill, 'and the batch hits the floor');
}

// The oven will not accept while occupied, which is what backs the queue up.
{
    const ctx = load();
    const c = { t: 4e6 };
    const st = shift(ctx, c.t);
    st.oven.phase = 'baking';
    st.belt.items.push({ quality: 'good', x: ctx.BELT_X1, sticky: false });
    run(ctx, st, c, 500);
    eq(st.belt.items.length, 1, 'the lead ball waits at the mouth for a busy oven');
}

// ── 3. Neglect degrades rather than blocks ────────────────────────────────────

console.log('\nneglect — every station degrades, none of them deadlocks');
{
    const ctx = load();
    const c = { t: 5e6 };
    const st = shift(ctx, c.t);
    const T = ctx.tune(st);

    // Mixer: good -> tough, and the tough ball still has to be pressed out.
    ctx.pressMixer(st, T, c.t);
    eq(st.mixer.phase, 'mixing', 'pressing an idle mixer starts it');
    eq(st.hopper.units, 4 - ctx.HOPPER_PER_MIX, 'and consumes flour');
    run(ctx, st, c, T.mixMs + 100);
    eq(st.mixer.phase, 'ready', 'it becomes ready on its own');
    run(ctx, st, c, T.readyMs + 100);
    eq(st.mixer.phase, 'over', 'neglected, it overmixes');
    eq(st.mixer.quality, 'tough', 'and the dough is downgraded, not destroyed');
    ctx.pressMixer(st, T, c.t);
    eq(st.mixer.phase, 'idle', 'the overmixed ball still ejects');
    eq(st.belt.items[0].quality, 'tough', 'carrying its downgrade onto the belt');
}

{
    const ctx = load();
    const c = { t: 6e6 };
    const st = shift(ctx, c.t);
    const T = ctx.tune(st);

    // Oven: bake -> golden -> burning -> fire, then three taps to douse.
    ctx.loadOven(st, 'good');
    run(ctx, st, c, T.bakeMs + 100);   eq(st.oven.phase, 'golden', 'the tray turns golden');
    run(ctx, st, c, T.goldenMs + 100); eq(st.oven.phase, 'burning', 'then burns if left');
    run(ctx, st, c, ctx.BURN_TO_FIRE_MS + 100);
    eq(st.oven.phase, 'fire', 'and finally catches fire');

    const m0 = st.mess;
    run(ctx, st, c, 1000);
    near(st.mess - m0, ctx.FIRE_MESS_RATE, 0.5, 'a fire costs FIRE_MESS_RATE per second');

    ctx.pressOven(st, T, c.t);
    ctx.pressOven(st, T, c.t + 1);
    eq(st.oven.phase, 'fire', 'two taps do not put it out');
    ctx.pressOven(st, T, c.t + 2);
    eq(st.oven.phase, 'empty', 'the third does');

    // Taps outside the window do not accumulate, or the mash would be a hold.
    ctx.loadOven(st, 'good');
    run(ctx, st, c, T.bakeMs + T.goldenMs + ctx.BURN_TO_FIRE_MS + 300);
    eq(st.oven.phase, 'fire', 'it can catch fire again');
    ctx.pressOven(st, T, c.t);
    ctx.pressOven(st, T, c.t + ctx.FIRE_TAP_WINDOW + 50);
    ctx.pressOven(st, T, c.t + ctx.FIRE_TAP_WINDOW + 100);
    eq(st.oven.phase, 'fire', 'taps spread beyond the window do not count');
}

{
    const ctx = load();
    const c = { t: 7e6 };
    const st = shift(ctx, c.t);
    const T = ctx.tune(st);

    // Hopper: overfilling spills rather than capping silently.
    st.hopper.units = ctx.HOPPER_MAX - 1;
    const m0 = st.mess;
    ctx.pressHopper(st, T, c.t);
    ok(st.hopper.units < ctx.HOPPER_MAX - 1, 'overfilling loses flour');
    eq(st.mess - m0, ctx.MESS.spill, 'and makes a mess');

    // An empty hopper stops the mixer without wedging it.
    st.hopper.units = 0;
    st.mixer.phase = 'idle';
    ctx.pressMixer(st, T, c.t + 2000);
    eq(st.mixer.phase, 'idle', 'no flour, no batch');
    st.hopper.units = ctx.HOPPER_MAX;
    ctx.pressMixer(st, T, c.t + 3000);
    eq(st.mixer.phase, 'mixing', 'and it starts again once refilled');
}

{
    const ctx = load();
    const c = { t: 8e6 };
    const st = shift(ctx, c.t);
    // Packing: a fifth cookie hits the floor rather than replacing one.
    st.pack.tray = ['perfect', 'perfect', 'perfect', 'perfect'];
    const m0 = st.mess;
    ctx.toPack(st, 'perfect', c.t);
    eq(st.pack.tray.length, ctx.TRAY_CAP, 'the tray does not overfill');
    eq(st.mess - m0, ctx.MESS.spill, 'the overflow costs a spill');
}

// ── 4. Scoring ────────────────────────────────────────────────────────────────

console.log('\nscoring — the greed decision, and what RUSH is worth');
{
    const ctx = load();
    const c = { t: 9e6 };

    const box = (tray, rush) => {
        const st = shift(ctx, c.t);
        st.rush = rush ? 0 : -1;
        st.pack.tray = tray.slice();
        st.pack.boxUntil = 0;
        ctx.pressPack(st, ctx.tune(st), c.t);
        return st;
    };

    const P = ctx.VALUE.perfect;
    eq(box(['perfect']).score, Math.round(P * ctx.BOX_MULT[1]), 'a single cookie pays face value');
    eq(box(['perfect', 'perfect', 'perfect', 'perfect']).score,
       Math.round(P * 4 * ctx.BOX_MULT[4]), 'a full box pays the x2 tier');
    ok(box(['perfect', 'perfect', 'perfect', 'perfect']).score > box(['perfect', 'perfect', 'perfect']).score * 4 / 3,
       'holding for the fourth beats shipping three');
    eq(box(['perfect', 'perfect', 'perfect', 'perfect'], true).score,
       Math.round(P * 4 * ctx.BOX_MULT[4] * ctx.RUSH_SCORE), 'RUSH doubles the box');

    const burnt = box(['perfect', 'burnt']);
    eq(burnt.shipped, 1, 'worthless cookies do not count as shipped');
    ok(burnt.score > 0, 'but they do not void the box either');

    // Overmixed dough is worth less, not nothing — the distinction the mixer
    // timer exists to create.
    ok(ctx.VALUE.seconds > 0 && ctx.VALUE.seconds < ctx.VALUE.perfect,
       'seconds are worth less than perfect and more than nothing');
    eq(ctx.VALUE.raw, 0, 'raw is worth nothing');
    eq(ctx.VALUE.burnt, 0, 'burnt is worth nothing');
}

{
    const ctx = load();
    const clean = shift(ctx); clean.mess = ctx.CLEAN_BONUS.threshold - 1;
    eq(ctx.settleShift(clean).points, ctx.CLEAN_BONUS.points, 'a spotless shift pays a bonus');
    const tidy = shift(ctx); tidy.mess = ctx.TIDY_BONUS.threshold - 1;
    eq(ctx.settleShift(tidy).points, ctx.TIDY_BONUS.points, 'a tidy one pays less');
    const filthy = shift(ctx); filthy.mess = ctx.TIDY_BONUS.threshold + 1;
    eq(ctx.settleShift(filthy), null, 'a filthy one pays nothing');
}

// ── 5. The ramp, and frame-rate independence ─────────────────────────────────

console.log('\nthe ramp and dt invariance');
{
    const ctx = load();
    const early = shift(ctx); early.elapsed = 0;
    const late = shift(ctx);  late.elapsed = late.shiftMs;
    const a = ctx.tune(early), b = ctx.tune(late);

    for (const k of ['mixMs', 'readyMs', 'bakeMs', 'goldenMs', 'stickMs', 'leakMs']) {
        ok(b[k] < a[k], `${k} tightens across the shift`);
    }
    ok(b.beltPx > a.beltPx, 'the belt speeds up across the shift');

    // Monotonic throughout, not merely at the ends: a ramp that dips in the
    // middle would make the game briefly easier as it is meant to bite.
    let monotonic = true, prev = ctx.tune({ ...early, elapsed: 0 }).bakeMs;
    for (let f = 0.05; f <= 1; f += 0.05) {
        const v = ctx.tune({ ...early, elapsed: f * early.shiftMs }).bakeMs;
        if (v > prev + 1e-9) monotonic = false;
        prev = v;
    }
    ok(monotonic, 'bakeMs is monotonic across the whole shift');

    // RUSH windows sit inside the shift and do not overlap.
    const w = ctx.RUSH_AT.map((f) => [f, f + ctx.RUSH_MS / 51248]);
    ok(w.every(([s, e]) => s >= 0 && e <= 1), 'every RUSH window falls inside the shift');
    ok(w.every(([, e], i) => i === w.length - 1 || e < w[i + 1][0]), 'RUSH windows do not overlap');
}

{
    // The same wall-clock time in different step sizes must agree. The belt is
    // the sensitive one: it integrates a speed every frame.
    const at = [];
    for (const step of [16, 33, 100]) {
        const ctx = load();
        const c = { t: 1e7 };
        const st = shift(ctx, c.t);
        st.belt.items.push({ quality: 'good', x: ctx.BELT_X0, sticky: false });
        st.belt.nextStickAt = Infinity;     // isolate motion from the jam timer
        run(ctx, st, c, 1980, step);
        at.push(st.belt.items.length ? st.belt.items[0].x : ctx.BELT_X1);
    }
    near(at[0], at[1], 1.5, 'belt travel agrees between 16ms and 33ms steps');
    near(at[1], at[2], 4.0, 'belt travel agrees between 33ms and 100ms steps');
}

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
