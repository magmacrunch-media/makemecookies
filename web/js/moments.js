// =====================================================================
// moments.js — makemecookies!x4
// What just happened, as data.
//
// The App Store build injects shims that need to know when something
// notable happened: haptics first, Game Center achievements after. The
// alternative is each shim re-deriving the rules from the shift object,
// which is a second copy of the game in all but name — so the game says
// so itself, once, here.
//
// Two constraints decided where this lives, and both are worth knowing
// before moving it.
//
// It is NOT in stations.js. `wii/source/stations.c` is a line-for-line
// port of that file, and a dispatch with no C counterpart is exactly
// the drift that pairing exists to catch. The Wii build has no shims to
// talk to and never will, so the seam has no business in the rules.
//
// It is not in main.js either, so that it can be tested. main.js reads
// the DOM on sight; this file touches nothing but a shift object, which
// is what lets web/tests/ load it the same way it loads the rules. A
// seam that fires twice, or not at all, is the kind of bug that shows
// up as a phone buzzing wrong three weeks later.
//
// So: the rules keep `st.tally`, which they already did for the ?debug
// report. This file diffs two snapshots of it. main.js turns the
// difference into CustomEvents. Nothing in the rules changed, and
// nothing holding a DOM reference decides what counts as notable.
// =====================================================================

// The counters worth watching, and the moment each one becomes. Every
// one of these is already maintained by stations.js for its own
// reasons, which is the point: a moment cannot drift from the rules
// when the rules are what defines it.
const MOMENT_OF = {
  perfect: 'perfect',   // pulled golden, from a good mix
  burnt: 'burnt',
  spills: 'spill',
  jams: 'jam',
  fires: 'fire',
  firesOut: 'fire-out',
  boxes: 'box',
};

const WATCHED = Object.keys(MOMENT_OF);

/** The numbers a moment can be derived from, flattened. */
function snapshot(st) {
  const mark = { score: st.score, shipped: st.shipped, rush: st.rush,
                 inspections: st.inspections };
  for (const key of WATCHED) mark[key] = st.tally[key];
  return mark;
}

/**
 * What happened between `prev` and now, as `{ name, detail }` objects.
 *
 * A counter that moved by more than one in a single frame reports once
 * with a `count`, rather than repeating. Two spills in one frame is one
 * thing going wrong, and a shim that buzzed twice for it would feel
 * like a stutter; an achievement that wants the total can add the
 * counts up. `rush` rides along on every detail because every consumer
 * so far has wanted it and no caller should have to remember.
 */
function momentsSince(prev, st) {
  const out = [];
  const rush = st.rush >= 0;

  // The rush window opening is the one moment that is not a counter:
  // it is a transition, and it is the only warning the player gets.
  if (prev.rush < 0 && st.rush >= 0) {
    out.push({ name: 'rush', detail: { count: 1, rush, index: st.rush } });
  }

  if (st.inspections > prev.inspections) {
    out.push({
      name: 'inspection',
      detail: { count: st.inspections - prev.inspections, rush },
    });
  }

  for (const key of WATCHED) {
    const count = st.tally[key] - prev[key];
    if (count <= 0) continue;
    const detail = { count, rush };
    if (key === 'boxes') {
      // What the box was worth, which neither the tally nor the shift
      // object records on its own: the score and the shipped count are
      // the only trace a box leaves.
      detail.gained = st.score - prev.score;
      detail.cookies = st.shipped - prev.shipped;
    }
    out.push({ name: MOMENT_OF[key], detail });
  }

  return out;
}
