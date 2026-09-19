/**
 * Taptic Engine feedback. Bundled by package.mjs into www/shim/.
 *
 * The site has no haptics and no reason to gain a Capacitor dependency, so
 * this lives here rather than in web/ -- the same rule as css/ios.css.
 *
 * ## It listens; it does not patch
 *
 * web/js/main.js announces what happened as `cookies:*` CustomEvents, named
 * for the game rather than for any platform, and js/moments.js decides what
 * is notable by diffing the tally the rules already keep. So nothing here
 * re-derives a rule, reaches into the shift object, or has to survive the
 * game's internals being rearranged. In a browser the events are dispatched
 * into a document with no listeners and cost one allocation.
 *
 * That matters more here than the general argument suggests: wrapping the
 * stations directly would mean buzzing on presses that did nothing, since a
 * locked hopper and a full tray both answer a press by ignoring it, and a
 * game played by mashing would be buzzing constantly for no information.
 *
 * ## One buzz per thing that happened
 *
 * A moment carries a `count` rather than repeating, so two spills in one
 * frame arrive as one event. That decision lives in moments.js and this file
 * relies on it: nothing here throttles, debounces or keeps a timer.
 *
 * ## 'HEAVY' and 'SUCCESS' are not typos for something the plugin matches
 *
 * @capacitor/haptics 8.0.2 string-matches MEDIUM and LIGHT for style, and
 * WARNING and ERROR for type; anything else falls through to the initial
 * values, which are .heavy and .success respectively
 * (node_modules/@capacitor/haptics/ios/Sources/HapticsPlugin/HapticsPlugin.swift).
 * So these two are the documented API and they do the right thing, just by
 * default rather than by comparison. Passing '' would behave identically,
 * which is exactly why they are spelled out here.
 *
 * ## The plugin may not be there
 *
 * Capacitor injects window.Capacitor.Plugins.* from the native side at
 * document start. In a browser -- including any static server pointed at
 * ios/www -- there is no injection, plugin() is null, and every call here is
 * a no-op.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mmc_haptics';

  function plugin() {
    var cap = typeof window !== 'undefined' ? window.Capacitor : null;
    return (cap && cap.Plugins && cap.Plugins.Haptics) || null;
  }

  var haptics = plugin();
  if (!haptics) return;

  var enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch (e) {
    // Private mode, or storage disabled. Default to on.
  }

  function impact(style) {
    if (!enabled) return;
    try {
      var p = haptics.impact({ style: style });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      // A device with no Taptic Engine rejects these. Never the player's
      // problem, and never worth interrupting a shift for.
    }
  }

  function notify(type) {
    if (!enabled) return;
    try {
      var p = haptics.notification({ type: type });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function on(name, fn) {
    document.addEventListener('cookies:' + name, fn);
  }

  // ---- the good outcomes ---------------------------------------------------

  // A tray pulled golden from a good mix. The most frequent thing worth
  // feeling, so it has to stay under the threshold where it becomes something
  // you notice rather than something you register.
  on('perfect', function () {
    impact('LIGHT');
  });

  // A box shipped: the payoff the whole packing station exists for.
  //
  // A box inside a RUSH window scores double, and that is the one the player
  // was bracing for, so it gets a notification pattern instead. Multi-tap and
  // categorically unlike any impact, which is the point: it should not feel
  // like an ordinary box. `rush` rides along on every moment, so this needs no
  // knowledge of where the windows are.
  on('box', function (e) {
    if (e.detail && e.detail.rush) notify('SUCCESS');
    else impact('MEDIUM');
  });

  // ---- the mistakes --------------------------------------------------------

  // Burnt trays and spills are the same class of event by feel: something you
  // could have prevented, and now there is mess on the floor. One thud each,
  // deliberately not distinguished, because by the time you feel it you are
  // already looking at which station went wrong.
  on('burnt', function () {
    impact('HEAVY');
  });
  on('spill', function () {
    impact('HEAVY');
  });

  // A jam stops the belt rather than costing anything directly, so it is a
  // nudge rather than a thud. Pressing 3 clears it.
  on('jam', function () {
    impact('MEDIUM');
  });

  // ---- the emergencies -----------------------------------------------------

  // The oven catching fire is recoverable, by mashing 4, and it fills the mess
  // meter while it burns. WARNING is the pattern for something that wants
  // hands now.
  on('fire', function () {
    notify('WARNING');
  });

  // The health inspector freezing the line is the only failure state in the
  // game, and the only moment where nothing the player does helps. ERROR is
  // reserved for it.
  on('inspection', function () {
    notify('ERROR');
  });

  // ---- the shift ends ------------------------------------------------------

  // The song ending. A clean-up bonus is the difference between a good shift
  // and a shipped one, so the two do not feel the same.
  on('shift-end', function (e) {
    if (e.detail && e.detail.bonus > 0) notify('SUCCESS');
    else impact('HEAVY');
  });

  // The RUSH window opening, which is the only warning the player gets and
  // arrives while both hands are busy. Three taps read as a fanfare rather
  // than as one more thing going wrong.
  on('rush', function () {
    impact('MEDIUM');
    setTimeout(function () { impact('MEDIUM'); }, 90);
    setTimeout(function () { impact('MEDIUM'); }, 180);
  });

  window.GameCookies = window.GameCookies || {};
  window.GameCookies.haptics = {
    get available() {
      return true;
    },
    get enabled() {
      return enabled;
    },
    set: function (value) {
      enabled = !!value;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch (e) {}
      return enabled;
    },
  };
})();
