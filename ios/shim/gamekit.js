/**
 * Game Center: one leaderboard, eight achievements. Bundled by package.mjs
 * into www/shim/, loaded after the ScoreClient bootstrap and before the
 * game's own scripts.
 *
 * ## One file where george-boole has two
 *
 * That game splits scores from achievements because its scores half is mostly
 * a 237-line rebuild of a scoreboard modal that Game Center has to sit inside.
 * This game's scoreboard is four columns and a close button, so the split
 * would be two files of preamble around thirty lines of work. If a third iOS
 * game arrives and this file grows a UI, split it then.
 *
 * ## What this file does NOT do
 *
 * It does not implement Game Center. It defines the interface the native side
 * has to provide and degrades to doing nothing when that side is missing,
 * which is always in a browser and in the app until GameCenterPlugin is
 * registered. A refused sign-in must cost the player nothing: the shift plays
 * identically, and the only difference is that nothing is reported.
 *
 * ## The contract
 *
 * A Capacitor plugin registered as `GameCenter`, with:
 *
 *     signIn()                                       -> { authenticated: boolean }
 *     submitScore({ leaderboardId, score })          -> void
 *     showLeaderboard({ leaderboardId })             -> void
 *     reportAchievement({ achievementId, percent })  -> void
 *
 * All four may reject, and nothing here treats a rejection as fatal.
 *
 * ## Everything comes from the seam
 *
 * web/js/main.js announces `cookies:*` and js/moments.js decides what is
 * notable, so this file reads game moments rather than game internals. Two of
 * these achievements are the reason the seam grew `cookies:fire-out` and
 * `bonusLabel`: without them, `fireout` and `spotless` could only be earned by
 * re-deriving a rule here, and a tuning change would break them silently.
 *
 * The one thing read from the game rather than from an event is `TRAY_CAP`,
 * and that is reading the config, not re-deriving a rule. It is a `const` in
 * js/config.js, so it is a global lexical binding rather than a property of
 * window: reachable by bare name from this script, and only after config.js
 * has run, which is why the read happens inside the handler.
 *
 * ## Ids are permanent
 *
 * An id cannot be renamed or reused once it exists in App Store Connect. The
 * table below and the one in ios/AGENTS.md are the same table; change them
 * together, and only while nothing has been created.
 *
 *     shipped    10    ship a box
 *     star1      50    8 cookies in a shift
 *     star2     100    15 cookies
 *     star3     200    22 cookies
 *     rushbox    50    ship a box inside a RUSH window
 *     fullhouse  50    ship a box of four
 *     spotless  100    finish with the SPOTLESS bonus
 *     fireout    50    put out an oven fire
 *                ---
 *                610   of App Store Connect's 1000, leaving room for a ninth
 *
 * ## Reporting once
 *
 * GameKit tolerates re-reporting at 100%, but it can re-show the banner, and a
 * banner for something earned three weeks ago reads as a bug. The ids already
 * sent are kept per device.
 */
(function () {
  'use strict';

  var PREFIX = 'com.magmacrunch.makemecookies.';
  var LEADERBOARD = PREFIX + 'shift';
  var STORAGE_KEY = 'mmc_achievements';

  var IDS = ['shipped', 'star1', 'star2', 'star3',
    'rushbox', 'fullhouse', 'spotless', 'fireout'];

  function plugin() {
    var cap = typeof window !== 'undefined' ? window.Capacitor : null;
    return (cap && cap.Plugins && cap.Plugins.GameCenter) || null;
  }

  var authenticated = false;

  function loadReported() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  var reported = loadReported();

  function remember(id) {
    if (reported.indexOf(id) !== -1) return;
    reported.push(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reported));
    } catch (e) {
      // Storage full or disabled. The worst case is a repeated banner, which
      // is not worth failing an achievement over.
    }
  }

  function award(name) {
    var id = PREFIX + name;
    if (IDS.indexOf(name) === -1 || reported.indexOf(id) !== -1) return;

    var p = plugin();
    if (!p || typeof p.reportAchievement !== 'function') {
      // No native half. Do NOT remember it: the player earned this, and the
      // day the plugin lands they should get it on their next shift rather
      // than having it silently written off now.
      return;
    }

    // Optimistic: recorded before the round trip, so a slow or failed
    // submission cannot produce two banners. GameKit queues and retries
    // submissions itself once signed in again.
    remember(id);
    Promise.resolve()
      .then(function () {
        return p.reportAchievement({ achievementId: id, percent: 100 });
      })
      .catch(function () {
        // A failed report is not the player's problem and not worth a dialog.
      });
  }

  function on(name, fn) {
    document.addEventListener('cookies:' + name, fn);
  }

  // ---- the leaderboard -----------------------------------------------------

  // Every finished shift is submitted, whatever it scored. Game Center keeps
  // each player's best per leaderboard itself, so a worse shift is harmless,
  // and submitting only good ones would make the board a record of the days
  // somebody remembered to care.
  on('shift-end', function (e) {
    var d = e.detail || {};
    var p = plugin();
    if (p && typeof p.submitScore === 'function' && typeof d.score === 'number') {
      Promise.resolve()
        .then(function () {
          return p.submitScore({ leaderboardId: LEADERBOARD, score: d.score });
        })
        .catch(function () {});
    }

    if (d.stars >= 1) award('star1');
    if (d.stars >= 2) award('star2');
    if (d.stars >= 3) award('star3');

    // The label rather than the points or the mess. Both of those move when
    // the bonus is retuned; the label is what the bonus IS.
    if (d.bonusLabel === 'SPOTLESS') award('spotless');
  });

  // ---- the shift itself ----------------------------------------------------

  on('box', function (e) {
    var d = e.detail || {};
    award('shipped');
    if (d.rush) award('rushbox');
    // TRAY_CAP is config.js's, read at call time for the reason in the header.
    // If it ever stops being a number this stops awarding rather than awarding
    // wrongly, which is the right way round for an id that cannot be redone.
    if (typeof TRAY_CAP === 'number' && d.cookies >= TRAY_CAP) award('fullhouse');
  });

  on('fire-out', function () {
    award('fireout');
  });

  // ---- a way into the board ------------------------------------------------

  // Injected rather than written into web/index.html: the site has no Game
  // Center, and a button that opens nothing is worse than no button. Added
  // only once sign-in has actually succeeded, so a player who declined never
  // sees it.
  function addLeaderboardButton() {
    var row = document.querySelector('#modal-scores .controls');
    if (!row || document.getElementById('btn-game-center')) return;

    var btn = document.createElement('button');
    btn.className = 'btn gold';
    btn.id = 'btn-game-center';
    btn.textContent = 'GAME CENTER';
    btn.addEventListener('click', function () {
      var p = plugin();
      if (!p || typeof p.showLeaderboard !== 'function') return;
      Promise.resolve()
        .then(function () {
          return p.showLeaderboard({ leaderboardId: LEADERBOARD });
        })
        .catch(function () {});
    });
    row.insertBefore(btn, row.firstChild);
  }

  // ---- sign in -------------------------------------------------------------

  // Once, at load. GameKit presents its own sheet if the player has never
  // signed in, and answers from cache afterwards; nothing here retries, since
  // a player who declined has declined.
  (function signIn() {
    var p = plugin();
    if (!p || typeof p.signIn !== 'function') return;
    Promise.resolve()
      .then(function () { return p.signIn(); })
      .then(function (result) {
        authenticated = !!(result && result.authenticated);
        if (authenticated) addLeaderboardButton();
      })
      .catch(function () {});
  })();

  window.GameCookies = window.GameCookies || {};
  window.GameCookies.gameCenter = {
    leaderboardId: LEADERBOARD,
    ids: IDS.map(function (name) { return PREFIX + name; }),
    get authenticated() {
      return authenticated;
    },
    get reported() {
      return reported.slice();
    },
    show: function () {
      var p = plugin();
      if (p && typeof p.showLeaderboard === 'function') {
        p.showLeaderboard({ leaderboardId: LEADERBOARD });
      }
    },
    // Exists so a device can be put back to a known state while testing
    // against the Game Center sandbox, which has its own reset.
    reset: function () {
      reported = [];
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    },
  };
})();
