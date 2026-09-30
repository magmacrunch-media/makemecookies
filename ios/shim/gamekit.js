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
 * ## Reporting once, and not losing the ones that fail
 *
 * GameKit tolerates re-reporting at 100%, but it can re-show the banner, and a
 * banner for something earned three weeks ago reads as a bug. So the ids Game
 * Center has accepted are kept per device.
 *
 * Two sets rather than one, and the second is the fix for a real loss. This
 * file used to record an id as reported BEFORE the round trip, on the grounds
 * that a slow submission must not produce two banners. That is right about the
 * banner and wrong about everything else: GameCenterPlugin.swift rejects
 * reportAchievement outright when the player is not signed in, the rejection
 * was caught and dropped here, and the id was already banked. A player who
 * declined the sign-in sheet -- which is a button Apple puts in front of
 * everybody -- lost every achievement they went on to earn, for good,
 * including after signing in later. So:
 *
 *   mmc_achievements          accepted by Game Center. Never reported again.
 *   mmc_achievements_pending  earned, not yet accepted. Retried.
 *
 * and the no-two-banners promise is kept by an in-memory in-flight list
 * instead, which is what it needed in the first place. Found in george-boole
 * first, whose two gamekit files are this one split apart; both games carry
 * the same fix, and ios/tests/test-shim.js is the suite that caught it.
 *
 * ## The sign-in is asked about more than once
 *
 * `authenticated` used to be latched from one fire-and-forget signIn() at load
 * and never revisited, and what it gates here is the GAME CENTER button. So a
 * player who declined Apple's sheet at launch, signed in through Settings or
 * the Game Center app and came back was never offered the board for the rest
 * of the session, and this file went on telling anything that asked it was
 * signed out.
 *
 * refresh() is called at load and again on every visibilitychange that brings
 * the app back, which is the only notice a webview gets that the player has
 * been somewhere else -- and leaving to sign in and returning is exactly the
 * case that matters. GameCenterPlugin.swift was already built for the second
 * call: its `reported` flag exists so a later signIn() answers from
 * GKLocalPlayer.local.isAuthenticated rather than queueing behind a handler
 * that has already fired and may never fire again. Nothing here ever made one.
 * Repeating it is a bridge round trip and no network traffic.
 *
 * Gaining a sign-in also flushes what is owed. Scores are not resubmitted, and
 * need no queue: bests.js has kept every shift on the device either way, and
 * Game Center holds each player's best per leaderboard, so a declined sheet
 * costs one session's standing rather than a record.
 */
(function () {
  'use strict';

  var PREFIX = 'com.magmacrunch.makemecookies.';
  var LEADERBOARD = PREFIX + 'shift';
  var STORAGE_KEY = 'mmc_achievements';
  // Earned, not yet accepted. A second key rather than a field inside the
  // first, so a device carrying an mmc_achievements from an earlier build keeps
  // its history exactly as it is and simply has nothing pending.
  var PENDING_KEY = 'mmc_achievements_pending';

  var IDS = ['shipped', 'star1', 'star2', 'star3',
    'rushbox', 'fullhouse', 'spotless', 'fireout'];

  function plugin() {
    var cap = typeof window !== 'undefined' ? window.Capacitor : null;
    return (cap && cap.Plugins && cap.Plugins.GameCenter) || null;
  }

  var authenticated = false;

  function loadIds(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveIds(key, ids) {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch (e) {
      // Storage full or disabled. The worst case is a repeated banner, which
      // is not worth failing an achievement over.
    }
  }

  var reported = loadIds(STORAGE_KEY);
  var pending = loadIds(PENDING_KEY);
  // Reports the native side has been handed and has not answered yet. In
  // memory only, deliberately: it exists to stop one box producing two
  // banners, and a relaunch has no calls in flight to protect.
  var inFlight = [];

  function without(list, id) {
    var at = list.indexOf(id);
    if (at !== -1) list.splice(at, 1);
  }

  /** Earned. Recorded as owed until Game Center takes it. */
  function markEarned(id) {
    if (reported.indexOf(id) !== -1 || pending.indexOf(id) !== -1) return;
    pending.push(id);
    saveIds(PENDING_KEY, pending);
  }

  /** Accepted. This is the only thing that ever writes to the reported set. */
  function markReported(id) {
    if (reported.indexOf(id) === -1) {
      reported.push(id);
      saveIds(STORAGE_KEY, reported);
    }
    if (pending.indexOf(id) !== -1) {
      without(pending, id);
      saveIds(PENDING_KEY, pending);
    }
  }

  /**
   * Hand one id to the native side.
   *
   * Nothing reaches the reported set until the report has been accepted; see
   * the header on why it used to, and what that cost. A rejection leaves the id
   * pending, so the next box or the next return to the app tries it again.
   */
  function send(id) {
    if (!id) return;
    if (reported.indexOf(id) !== -1 || inFlight.indexOf(id) !== -1) return;

    var p = plugin();
    if (!p || typeof p.reportAchievement !== 'function') {
      // No native half yet. It stays pending: the player earned this, and the
      // day the plugin lands they should get it rather than having it silently
      // written off now.
      return;
    }

    inFlight.push(id);
    Promise.resolve()
      .then(function () {
        return p.reportAchievement({ achievementId: id, percent: 100 });
      })
      .then(function () {
        without(inFlight, id);
        markReported(id);
      })
      .catch(function () {
        // Not signed in, offline, or GameKit unhappy. Not the player's problem
        // and not worth a dialog -- but not worth forgetting either.
        without(inFlight, id);
      });
  }

  /** Everything still owed, tried again. Safe to call at any time. */
  function flush() {
    pending.slice().forEach(send);
  }

  function award(name) {
    var id = PREFIX + name;
    if (IDS.indexOf(name) === -1 || reported.indexOf(id) !== -1) return;
    markEarned(id);
    send(id);
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

  // The button exists exactly while the player is signed in, and syncing it is
  // one function rather than an add and a remove so that invariant cannot drift.
  //
  // Injected rather than written into web/index.html: the site has no Game
  // Center, and a button that opens nothing is worse than no button. So it
  // appears only once sign-in has actually succeeded -- on a later sign-in as
  // well as the one at load, which is what refresh() is for -- and it comes
  // back out on a sign-out, which is the same argument pointed the other way.
  // A player who signs out mid-shift was being left with a live GAME CENTER
  // button whose every tap was refused by GameCenterPlugin.swift's
  // isAuthenticated guard.
  function syncLeaderboardButton() {
    var row = document.querySelector('#modal-scores .controls');
    if (!row) return;

    var existing = document.getElementById('btn-game-center');
    if (!authenticated) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) return;

    var btn = document.createElement('button');
    btn.className = 'btn gold';
    btn.id = 'btn-game-center';
    btn.textContent = 'GAME CENTER';
    btn.addEventListener('click', function () {
      showBoard();
    });
    row.insertBefore(btn, row.firstChild);
  }

  /**
   * Open Game Center's own full-screen board, and resolve false rather than
   * reject if it will not open.
   *
   * Every rejection in this file is caught, and this one was not until
   * 2026-09-29: it handed the caller a promise nobody was holding, so a tap
   * while signed out -- or any call at all from the public API below, where the
   * return value was dropped on the floor -- raised an unhandled rejection in
   * the webview. Not a crash, and not visible on a phone, which is exactly the
   * kind of thing ios/tests/test-shim.js now fails on.
   */
  function showBoard() {
    var p = plugin();
    if (!p || typeof p.showLeaderboard !== 'function') return Promise.resolve(false);
    return Promise.resolve()
      .then(function () {
        return p.showLeaderboard({ leaderboardId: LEADERBOARD });
      })
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  // ---- sign in -------------------------------------------------------------

  /**
   * Ask the native side where the player stands, and remember the answer.
   *
   * At load and on every return to the app, for the reason in the header. A
   * gained sign-in is the moment to settle what is owed; a lost one is worth
   * noticing too, so anything reading `authenticated` is reading the current
   * state rather than the state at launch, and the button follows it either
   * way. A rejected signIn() counts as signed out: it is what the plugin says
   * when it cannot tell, and offering a board on a maybe is the worse guess.
   */
  function refresh() {
    var p = plugin();
    if (!p || typeof p.signIn !== 'function') return Promise.resolve(false);
    return Promise.resolve()
      .then(function () { return p.signIn(); })
      .then(function (result) {
        var now = !!(result && result.authenticated);
        var gained = now && !authenticated;
        authenticated = now;
        syncLeaderboardButton();
        if (gained) flush();
        return now;
      })
      .catch(function () {
        authenticated = false;
        syncLeaderboardButton();
        return false;
      });
  }

  // Fire and forget: the shift is playable signed out, and blocking the first
  // frame on a round trip to Apple would be a poor trade.
  refresh();

  // The only notice a webview gets that the player has been somewhere else,
  // and so the only seam at which a sign-in made outside the app can be
  // noticed at all. flush() as well as refresh(), because a report can also
  // have been refused while signed in -- offline, or GameKit unhappy -- and
  // that leaves a debt with no sign-in to gain. The double call costs nothing:
  // send() refuses an id that is already reported or in flight.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      refresh();
      flush();
    }
  });

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
    // Earned and still owed to Game Center.
    get pending() {
      return pending.slice();
    },
    flush: flush,
    // Re-checks and returns the current state. Here so a sign-in button, if
    // the card ever grows one, has something to call that cannot hang.
    signIn: refresh,
    // Resolves true if the board opened, false if it could not. Never
    // rejects: see showBoard().
    show: showBoard,
    // Exists so a device can be put back to a known state while testing
    // against the Game Center sandbox, which has its own reset.
    reset: function () {
      reported = [];
      pending = [];
      inFlight = [];
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PENDING_KEY);
      } catch (e) {}
    },
  };
})();
