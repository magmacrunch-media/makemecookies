/**
 * BEST SHIFTS, on the device. Bundled by package.mjs into www/shim/, loaded
 * after the ScoreClient bootstrap and before the game's own scripts.
 *
 * ## Why the app needs this at all
 *
 * The browser version's board is the magmacrunch arcade's: `loadScores()` asks
 * `scoreClient.load()` for it, and SUBMIT posts back with three initials.
 * A bundle has neither half. `package.mjs` disconnects the ScoreClient, and
 * `ios.css` hides the initials field, because Game Center already takes every
 * finished shift without asking (shim/gamekit.js) and a second, weaker
 * leaderboard asking a player to name a score that is going nowhere is worse
 * than no leaderboard.
 *
 * Between them, nothing was left to write a row: the card would have read
 * NO SHIFTS LOGGED for ever. This files each finished shift instead, so the
 * table means "your ten best on this phone" -- which is also the only board a
 * player who declined Game Center will ever see, and the reason this is worth
 * having rather than hiding the button.
 *
 * ## It writes the store the ScoreClient already falls back to
 *
 * `adenosine-score-client.js` keeps a localStorage copy under
 * `adenosine_scores_<game>` and reads it whenever the socket is not connected
 * -- which in a bundle is always. So there is no second store here and no
 * patching of the game: `loadScores()` picks these rows up by itself on the
 * next launch, through the documented fallback path.
 *
 * `localScores` is assigned as well, for the shift that has just finished:
 * `loadScores()` ran at startup and will not run again, so without this a shift
 * would not appear in the table until the app was relaunched. It is a top-level
 * `let` in js/main.js -- a global lexical binding rather than a property of
 * window, the same shape as `st` -- so it is reachable by bare name from here.
 * tools/screenshots/shots.js seeds the same two places for the same reason.
 *
 * Not written through `scoreClient.save()`, which would be the obvious route:
 * it upper-cases the name and slices it to three characters, for an arcade
 * cabinet's initials. A date does not survive that, and a date is what this
 * column is for in the app.
 */
(function () {
  'use strict';

  var KEY = 'adenosine_scores_makemecookies';

  /* The table renders every row it is given -- `renderScores()` iterates
     `localScores` rather than a top slice -- so what is stored IS what is
     shown. The ScoreClient keeps up to 100; ten is what the web board shows
     and what `addScoreToTable()` trims to, so ten it is here. */
  var MAX = 10;

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /* The WHO column becomes WHEN, so a date is what goes in it. Deliberately
     not the time: two shifts a minute apart are told apart by their scores,
     and the column is eight characters wide on a phone. */
  function stamp(ms) {
    var d = new Date(ms);
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function read() {
    try {
      var rows = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(rows)) return [];
      // A row this file did not write must not take the table down:
      // renderScores() calls toLocaleString() on score.
      return rows.filter(function (r) {
        return r && typeof r.score === 'number';
      });
    } catch (e) {
      return [];                      // private browsing, or a full quota
    }
  }

  document.addEventListener('cookies:shift-end', function (e) {
    var d = (e && e.detail) || {};
    if (typeof d.score !== 'number') return;

    var rows = read();
    rows.push({
      initials: stamp(Date.now()),
      score: d.score,
      shipped: typeof d.shipped === 'number' ? d.shipped : null,
    });
    rows.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    rows = rows.slice(0, MAX);

    try {
      localStorage.setItem(KEY, JSON.stringify(rows));
    } catch (err) {}                  // a lost history is not worth a crash

    try {
      localScores = rows;             // eslint-disable-line no-undef
    } catch (err) {}                  // main.js not parsed yet: nothing to show
  });

  /* Two labels that are true on the site and false in a bundle. Done here
     rather than as a package.mjs transform because they belong to the same
     decision as the rest of this file: change what the board IS, and the words
     for it change with it. */
  document.addEventListener('DOMContentLoaded', function () {
    var head = document.querySelector('#modal-scores thead th:nth-child(2)');
    if (head) head.textContent = 'WHEN';
    var sub = document.querySelector('#modal-scores .modal-sub');
    if (sub) sub.textContent = 'on this device';
  });

  /* A way to clear it while testing, beside GameCookies.gameCenter.reset().
     Nothing in the UI calls this: a player who wants the history gone can
     delete the app, and a button that wipes a board is one mis-tap. */
  window.GameCookies = window.GameCookies || {};
  window.GameCookies.bests = {
    get rows() { return read(); },
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      try { localScores = []; } catch (e) {}  // eslint-disable-line no-undef
    },
  };
})();
