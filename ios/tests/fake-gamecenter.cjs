/**
 * A fake GameCenter plugin, for a consumer's shim tests.
 *
 * VENDORED. This file is the shell's, copied byte-identical into each consumer
 * by `node tools/sync.mjs <game>`, and `--check` fails if a copy has drifted.
 * Edit it here and sync out; editing a copy is caught from both ends.
 *
 * ## Why this is the shell's file and not each game's
 *
 * It is a model of `native/GameCenterPlugin.swift`, which is also this repo's
 * and also vendored. The two belong together: every condition below exists
 * because the Swift rejects on it, so a guard added there wants a line added
 * here, and the guard-to-model correspondence is the only thing making either
 * game's shim tests mean anything.
 *
 * They had already drifted when this file was written, within a day of the
 * second copy being made, and in the direction that matters: makemecookies'
 * copy modelled the three `guard let` argument rejections and george-boole's
 * did not, so george-boole's suite would have passed a shim that submitted a
 * score of `undefined`. Nothing could have noticed. That is the whole argument
 * for this file existing.
 *
 * ## What a fake that always resolves would prove
 *
 * Nothing, and worse than nothing. Half of what a shim suite is for is the
 * refusal path: an achievement earned while signed out, a board asked for by a
 * player who declined, a report that fails and has to be owed rather than
 * banked. A stub that resolved unconditionally would pass every one of those
 * tests while the app lost achievements on a phone, which is exactly the bug
 * both games shipped.
 *
 * ## `.cjs`, and why the extension rather than the directory
 *
 * It runs inside a consumer's `ios/tests/`, which is CommonJS, so this has to
 * be CommonJS. But this repo is `"type": "module"`, which makes a `.js` file
 * here ESM no matter how it is loaded -- `createRequire` does not escape that,
 * which is worth knowing because it looks as though it should.
 *
 * So `.cjs`, which is CommonJS everywhere and needs nothing else to say so. The
 * alternative was a `testkit/package.json` carrying `"type": "commonjs"` to
 * scope this directory, which works and hides the fact in a file nobody reads
 * on the way to this one. The extension states it at every site instead,
 * including inside each consumer, where `.js` would have been legal and would
 * have made the shell's constraint invisible.
 */

'use strict';

/**
 * Mirrors GameCenterPlugin.swift method for method, including the order its
 * guards run in, which decides which rejection a caller gets.
 *
 * Every switch below is a refusal the real plugin can produce:
 *
 *   authenticated    GKLocalPlayer.local.isAuthenticated. Everything but
 *                    signIn() is guarded on it.
 *   failSignIn       signIn() rejecting, rather than answering false.
 *   throwOnSignIn    the bridge proxy THROWING rather than returning a
 *   throwOnShow      rejected promise. Capacitor's does not do this today, and
 *   throwOnReport    a shim that treats the two as interchangeable is relying
 *                    on that rather than stating it. george-boole's refresh()
 *                    was, and one throw at load would have taken its whole
 *                    scores shim out for the session.
 */
function makeGameCenter(opts) {
  const calls = {
    signIn: 0,
    submitScore: [],
    showLeaderboard: [],
    reportAchievement: [],
  };

  const refused = (why) => Promise.reject(new Error(why));
  const NOT_SIGNED_IN = 'not signed in to Game Center';

  const gc = {
    calls,
    authenticated: !!(opts && opts.authenticated),
    failSignIn: false,
    throwOnSignIn: false,
    throwOnShow: false,
    throwOnReport: false,

    /**
     * Answers from the current state on every call, not just the first. The
     * Swift's `reported` flag exists precisely so a second signIn() is not
     * queued behind a handler that has already fired and may never fire again,
     * which is what makes a re-check on returning to the app safe.
     */
    signIn() {
      calls.signIn++;
      if (gc.throwOnSignIn) throw new Error('the bridge threw');
      if (gc.failSignIn) return refused('sign-in failed');
      return Promise.resolve({ authenticated: gc.authenticated });
    },

    /**
     * Note the order: both argument guards come BEFORE the auth guard in the
     * Swift, so a signed-out call with a bad id is refused for the id.
     *
     * `score` must be a whole number because the Swift reads it with
     * call.getInt, which refuses anything else. Neither game can currently
     * produce a fraction; modelling it is what makes that a fact rather than
     * an accident nobody checks.
     */
    submitScore(o) {
      calls.submitScore.push(o);
      if (!o || typeof o.leaderboardId !== 'string') return refused('leaderboardId is required');
      if (typeof o.score !== 'number' || !Number.isInteger(o.score)) {
        return refused('score is required');
      }
      if (!gc.authenticated) return refused(NOT_SIGNED_IN);
      return Promise.resolve();
    },

    /**
     * The one method with NO argument guard, and that is deliberate upstream: a
     * null or absent leaderboardId is a shim asking for the leaderboard LIST,
     * which george-boole sends for a mode with no board of its own. Validating
     * it here would fail a call the real plugin honours.
     */
    showLeaderboard(o) {
      calls.showLeaderboard.push(o);
      if (gc.throwOnShow) throw new Error('the bridge threw');
      if (!gc.authenticated) return refused(NOT_SIGNED_IN);
      return Promise.resolve();
    },

    /** `percent` is optional upstream, defaulting to 100, so it is not guarded. */
    reportAchievement(o) {
      calls.reportAchievement.push(o);
      if (gc.throwOnReport) throw new Error('the bridge threw');
      if (!o || typeof o.achievementId !== 'string') return refused('achievementId is required');
      if (!gc.authenticated) return refused(NOT_SIGNED_IN);
      return Promise.resolve();
    },
  };

  return gc;
}

module.exports = { makeGameCenter };
