/**
 * bench-shift.js — how many cookies a shift is worth, measured.
 *
 *     node bench-shift.js                 # the default ladder
 *     node bench-shift.js 140 300 700     # specific reaction times, in ms
 *     node bench-shift.js --json          # machine-readable, for tooling
 *     node bench-shift.js --check         # CI: the star ladder still slopes
 *
 * config.js records "29 cookies at 140ms down to 12 at 700ms" and nothing in
 * the repository could produce those numbers: the simulated player that
 * measured them was never committed. So the one figure the star thresholds and
 * the Game Center leaderboard hang off could not be re-derived after a tuning
 * change, which is the same failure this project keeps finding elsewhere -- a
 * claim with nothing checking it.
 *
 * This is that player, written down. It loads the shipped rules the way
 * test-simulation.js does, so it measures what ships rather than a model of it.
 *
 * ## What the bot is, and what it is not
 *
 * It is a strict priority list re-evaluated on a fixed reaction budget: every
 * `latency` milliseconds it looks at the line, picks the most urgent station
 * and presses it once. That is the honest way to produce a skill gradient,
 * because the game's difficulty is entirely about attention -- the stations
 * compete for a hand that can only be in one place.
 *
 * It is not a good player. It never holds a tray for the BOX_MULT bonus beyond
 * a full four, never anticipates, and never spends a press on anything that is
 * not already demanding one. A human who plans beats it on score at the same
 * reaction time. That gap is deliberate: a bot that played greedily would set
 * thresholds no human could reach with hands that also have to read the HUD.
 *
 * ## Read the cookie count, not the score
 *
 * Score folds in the greed decision and the clean-up bonus, both of which the
 * bot plays badly and inconsistently. Cookies shipped is what the oven allows
 * and what the player's hands earn, which is why the stars key on it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');

/** Deterministic PRNG, so a jam lands in the same place every run. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Constants declared with `const` land in the vm's global lexical scope rather
// than on the context object, so they are bridged over by name. The same trap
// test-simulation.js documents at length; this list is only what the bot reads.
const CONSTANTS = [
    'PRESS', 'S', 'TRAY_CAP', 'HOPPER_MAX', 'HOPPER_PER_MIX', 'SHIFT_MS_FALLBACK',
    'STARS',
    'FIRE_TAP_WINDOW', 'FIRE_TAPS',
];

function load(seed) {
    const ctx = vm.createContext({ console, Math: Object.create(Math) });
    ctx.Math.random = mulberry32(seed);
    for (const f of ['config.js', 'stations.js']) {
        vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
    }
    vm.runInContext(`globalThis.__k = { ${CONSTANTS.join(', ')} };`, ctx, { filename: 'bridge' });
    for (const k of CONSTANTS) {
        if (ctx.__k[k] === undefined) throw new Error(`constant ${k} did not load`);
        ctx[k] = ctx.__k[k];
    }
    return ctx;
}

/**
 * Which station wants a hand most, or -1 for none.
 *
 * Ordered by what it costs to ignore: a fire fills the mess meter every frame
 * it burns, a golden tray becomes burnt, a ready mixer becomes overmixed and
 * halves its cookies' value, and a jam stops the line. Everything below that
 * is keeping the line fed, which is only worth a press when nothing is
 * actively going wrong.
 */
function choose(ctx, st, now) {
    const o = st.oven, m = st.mixer;

    if (o.phase === 'fire' || o.phase === 'burning' || o.phase === 'golden') return ctx.S.OVEN;
    if (m.phase === 'ready' || m.phase === 'over') return ctx.S.MIXER;
    if (st.belt.items.some((i) => i.sticky)) return ctx.S.BELT;

    // Ship on a full tray, and never on a partial one: BOX_MULT peaks at four
    // and the bot has no way to judge whether a fifth is coming in time.
    if (st.pack.tray.length >= ctx.TRAY_CAP) return ctx.S.PACK;

    if (m.phase === 'idle' && st.hopper.units >= ctx.HOPPER_PER_MIX) return ctx.S.MIXER;

    // Refill only with room to spare: at HOPPER_MAX - 1 the sack goes on the
    // floor, which costs mess and locks the station.
    if (st.hopper.units < ctx.HOPPER_MAX - 1) return ctx.S.HOPPER;

    return -1;
}

function playShift(ctx, latency, step = 33) {
    const st = ctx.createShift();
    st.shiftMs = ctx.SHIFT_MS_FALLBACK;
    let now = 1e6;
    ctx.armShift(st, ctx.tune(st), now);

    let nextAct = now;
    while (st.elapsed < st.shiftMs) {
        now += step;
        st.elapsed += step;

        // The frozen line: main.js refuses presses while the inspector is in,
        // so the bot has to sit through it too or it would measure a game
        // nobody plays.
        const frozen = now < st.inspectUntil;

        if (!frozen && now >= nextAct) {
            const bay = choose(ctx, st, now);
            if (bay >= 0) {
                ctx.PRESS[bay](st, ctx.tune(st), now);
                // A fire needs FIRE_TAPS presses inside FIRE_TAP_WINDOW, which
                // no reaction budget above a third of that window can deliver
                // one press at a time. Mashing is a different motion from
                // reacting, so it gets the window rather than the budget.
                nextAct = now + (st.oven.phase === 'fire'
                    ? Math.min(latency, ctx.FIRE_TAP_WINDOW / (ctx.FIRE_TAPS + 1))
                    : latency);
            } else {
                nextAct = now + latency;
            }
        }

        ctx.updateShift(st, step, now);
    }

    // The last tray is worth shipping; a player watching the clock does this.
    if (st.pack.tray.length) ctx.PRESS[ctx.S.PACK](st, ctx.tune(st), now);
    const bonus = ctx.settleShift(st);

    return {
        cookies: st.shipped,
        score: st.score + (bonus ? bonus.points : 0),
        mess: Math.round(st.mess),
        bonus: bonus ? bonus.label : '-',
        inspections: st.inspections,
        ...st.tally,
    };
}

function mean(xs) {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function run(latencies, seeds = 12) {
    return latencies.map((latency) => {
        const runs = [];
        for (let seed = 1; seed <= seeds; seed++) runs.push(playShift(load(seed), latency));
        const avg = (key) => mean(runs.map((r) => r[key]));
        return {
            latency,
            cookies: +avg('cookies').toFixed(1),
            cookiesMin: Math.min(...runs.map((r) => r.cookies)),
            cookiesMax: Math.max(...runs.map((r) => r.cookies)),
            score: Math.round(avg('score')),
            perfect: +avg('perfect').toFixed(1),
            seconds: +avg('seconds').toFixed(1),
            burnt: +avg('burnt').toFixed(1),
            overmixed: +avg('overmixed').toFixed(1),
            spills: +avg('spills').toFixed(1),
            fires: +avg('fires').toFixed(1),
            inspections: +avg('inspections').toFixed(1),
            mess: Math.round(avg('mess')),
        };
    });
}

/**
 * The guard CI runs.
 *
 * STARS is derived from this bench, so a tuning change to the oven cycle can
 * silently move what a star is worth: three stars could become unreachable, or
 * one star could become something you get by standing still. Neither shows up
 * in a test of the rules, because the rules would still be correct.
 *
 * Deliberately a band rather than an exact number. The bot is a measurement
 * instrument, not a specification, and pinning it exactly would mean every
 * tuning commit also editing this file, which is how a check becomes something
 * people route around.
 */
function checkLadder() {
    const STARS = load(1).STARS;
    const [fast, mid, slow] = run([140, 450, 1000], 4);
    const fails = [];

    if (!(fast.cookies > mid.cookies && mid.cookies > slow.cookies)) {
        fails.push(`no skill gradient: ${fast.cookies} / ${mid.cookies} / ${slow.cookies} cookies `
            + 'at 140 / 450 / 1000ms. The stations have stopped competing for attention, '
            + 'which is the fault the current cycle times were chosen to fix.');
    }
    if (fast.cookies < STARS[2] + 4) {
        fails.push(`three stars needs ${STARS[2]} cookies and a 140ms hand ships only `
            + `${fast.cookies}. Too close to the ceiling to be worth reaching for.`);
    }
    if (slow.cookies >= STARS[1]) {
        fails.push(`two stars needs ${STARS[1]} cookies and a 1000ms hand already ships `
            + `${slow.cookies}. The middle star has stopped meaning anything.`);
    }

    console.log(`\n140ms ${fast.cookies}   450ms ${mid.cookies}   1000ms ${slow.cookies}   `
        + `stars at ${STARS.join(' / ')}`);
    for (const f of fails) console.log('  FAIL  ' + f);
    if (!fails.length) console.log('  the star ladder still slopes\n');
    return fails.length ? 1 : 0;
}

const args = process.argv.slice(2);
const json = args.includes('--json');
if (args.includes('--check')) process.exit(checkLadder());
const latencies = args.filter((a) => /^\d+$/.test(a)).map(Number);
const rows = run(latencies.length ? latencies : [100, 140, 200, 300, 450, 700, 1000]);

if (json) {
    console.log(JSON.stringify(rows, null, 2));
} else {
    console.log('\nreaction  cookies (min-max)   score   perfect  seconds  burnt  overmix  spill  fire  insp  mess');
    for (const r of rows) {
        console.log(
            String(r.latency + 'ms').padStart(8)
            + String(r.cookies).padStart(9)
            + ` (${r.cookiesMin}-${r.cookiesMax})`.padEnd(11)
            + String(r.score).padStart(7)
            + String(r.perfect).padStart(9)
            + String(r.seconds).padStart(9)
            + String(r.burnt).padStart(7)
            + String(r.overmixed).padStart(9)
            + String(r.spills).padStart(7)
            + String(r.fires).padStart(6)
            + String(r.inspections).padStart(6)
            + String(r.mess).padStart(6)
        );
    }
    console.log('\n12 seeds per row. Read the cookie count: score folds in greed and');
    console.log('clean-up, both of which the bot plays badly.\n');
}
