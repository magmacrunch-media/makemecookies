/**
 * test-shim.js -- the app-only half, tested.
 *
 * Run: node ios/tests/test-shim.js   (from ios/, or from anywhere)
 *
 * ## Why this file exists
 *
 * Everything else in this repo is checked several ways over: the rules by
 * web/tests/ and `wii/make test`, the art by ios/tools/*.py --check, the bundle
 * by the ios-bundle job, the title card by a headless measurement, the Xcode
 * project by ios-build. `shim/` was the one directory nothing ran against, and
 * it is the directory least able to afford that, because every path in it
 * catches and swallows by design. The contract is "degrade to doing nothing
 * when the native side is missing", so a shim that has stopped working looks
 * exactly like a shim running in a browser. There is no error to notice.
 *
 * Two bugs were sitting in `gamekit.js` when this was written, both found first
 * in george-boole, whose shim is the same logic split across two files, and
 * both are in here as named tests: an achievement earned while signed out was
 * banked as reported and lost for good, and `authenticated` was latched from
 * one sign-in at page load and never revisited.
 *
 * ## The fake plugin rejects the way the real one does
 *
 * `makeGameCenter` is not a stub that always resolves. GameCenterPlugin.swift
 * guards submitScore, showLeaderboard and reportAchievement with
 * `guard GKLocalPlayer.local.isAuthenticated else { call.reject(...) }`, so the
 * fake rejects on the same condition, and on the same missing arguments. That
 * rejection is the whole subject of half the tests below, and a fake that
 * resolved unconditionally would pass them all while the app lost achievements
 * on a phone.
 *
 * ## The DOM is a real little tree, not a bag of truthy stubs
 *
 * An always-truthy element hides exactly the mistakes a shim makes: both
 * gamekit.js and bests.js reach into `#modal-scores`, and one of them relabels
 * a `th` by position. So the card is built once here with the ids and classes
 * web/index.html actually carries, and querySelector walks it, `:nth-child`
 * included. An element a shim asks for and the page does not have comes back
 * null, which is what a phone does.
 *
 * ## TRAY_CAP and localScores are declared the way the game declares them
 *
 * Both are `const`/`let` at the top level of js/config.js and js/main.js, so
 * they are global lexical bindings rather than properties of window -- which is
 * the whole reason the shims read them by bare name and read them late.
 * `env.gameGlobals()` runs a script in the same realm that declares them, so
 * the tests exercise that path rather than a window property the shims would
 * never have found. Leaving it out is the before-config.js case, and there is a
 * test for that too.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHIM_DIR = path.join(__dirname, '..', 'shim');

let passed = 0;
let failed = 0;

// Every rejection in the shims is meant to be caught, and one that is not is a
// bug even though nothing crashes: `show()` handed back a rejected promise
// nobody was holding until 2026-09-29, which on a phone is invisible. So the
// suite watches for them and counts each one as a failure at the end of the
// run, on top of whatever named test was standing next to it.
const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason && reason.message ? reason.message : String(reason));
});

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL: ' + message + ' -- got ' + a + ', expected ' + e);
  }
}

function section(name) {
  console.log('\n' + name + ':');
}

// Microtasks AND one turn of the event loop, repeatedly: the shims chain
// through Promise.resolve().then(), and the fake plugin's promises are created
// in the host realm, so a single await is not enough to settle a chain.
function settle(times) {
  let p = Promise.resolve();
  for (let i = 0; i < (times || 6); i++) {
    p = p.then(() => new Promise((r) => setImmediate(r)));
  }
  return p;
}

// -- a small DOM -------------------------------------------------------------

class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = '';
    this.textContent = '';
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this._classes = new Set();
    this._listeners = new Map();
    const self = this;
    this.classList = {
      add(c) { self._classes.add(c); },
      remove(c) { self._classes.delete(c); },
      contains(c) { return self._classes.has(c); },
    };
  }

  get className() {
    return Array.from(this._classes).join(' ');
  }

  set className(v) {
    this._classes = new Set(String(v).split(' ').filter(Boolean));
  }

  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const at = this.children.indexOf(ref);
    if (at === -1) this.children.push(child);
    else this.children.splice(at, 0, child);
    return child;
  }

  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at !== -1) this.children.splice(at, 1);
    child.parentNode = null;
    return child;
  }

  /**
   * One compound selector part. `:nth-child(n)` is supported because bests.js
   * relabels the WHO column by position -- `thead th:nth-child(2)` -- so a
   * parser without it would report the relabel working when it had matched
   * nothing at all.
   */
  matchesPart(part) {
    const at = part.indexOf(':');
    if (at !== -1) {
      if (!this.matchesPart(part.slice(0, at) || '*')) return false;
      const nth = /^nth-child\((\d+)\)$/.exec(part.slice(at + 1));
      if (!nth) return false;
      const siblings = this.parentNode ? this.parentNode.children : [];
      return siblings.indexOf(this) === Number(nth[1]) - 1;
    }
    if (part === '*') return true;
    if (part.charAt(0) === '#') return this.id === part.slice(1);
    if (part.charAt(0) === '.') return this._classes.has(part.slice(1));
    return this.tagName === part.toUpperCase();
  }

  querySelector(sel) {
    const found = queryAll(this, parseSelector(sel));
    return found.length ? found[0] : null;
  }

  querySelectorAll(sel) {
    return queryAll(this, parseSelector(sel));
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    const at = list.indexOf(fn);
    if (at !== -1) list.splice(at, 1);
  }

  dispatchEvent(evt) {
    const list = (this._listeners.get(evt.type) || []).slice();
    for (const fn of list) fn(evt);
    return true;
  }

  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] === undefined ? null : this[name]; }
  removeAttribute(name) { delete this[name]; }
}

function parseSelector(sel) {
  return String(sel).trim().split(' ').filter(Boolean);
}

function descendants(root, out) {
  const acc = out || [];
  for (const child of root.children) {
    acc.push(child);
    descendants(child, acc);
  }
  return acc;
}

function queryAll(root, parts) {
  const head = parts[0];
  const rest = parts.slice(1);
  const out = [];
  for (const node of descendants(root)) {
    if (!node.matchesPart(head)) continue;
    if (rest.length === 0) out.push(node);
    else out.push.apply(out, queryAll(node, rest));
  }
  return out;
}

function el(tag, id, cls) {
  const e = new Element(tag);
  if (id) e.id = id;
  if (cls) e.className = cls;
  return e;
}

function th(text) {
  const e = el('th');
  e.textContent = text;
  return e;
}

/**
 * The BEST SHIFTS card as web/index.html builds it, and nothing else. Kept
 * deliberately thin: anything a shim looks up that is not here comes back null,
 * which is the case both shims' guards exist for.
 */
function buildPage(opts) {
  const body = el('body');

  if (!opts || opts.scores !== false) {
    const overlay = el('div', 'modal-scores', 'modal-overlay hidden');
    const modal = el('div', null, 'modal');
    modal.appendChild(el('h2'));

    const sub = el('div', null, 'modal-sub');
    sub.textContent = 'magmacrunch arcade';
    modal.appendChild(sub);

    const scroll = el('div', null, 'scores-scroll');
    const table = el('table', null, 'scores-table');
    const head = el('thead');
    const row = el('tr');
    for (const label of ['#', 'WHO', 'SCORE', 'SHIPPED']) row.appendChild(th(label));
    head.appendChild(row);
    table.appendChild(head);
    table.appendChild(el('tbody', 'scores-tbody'));
    scroll.appendChild(table);
    modal.appendChild(scroll);

    // The row gamekit.js injects GAME CENTER into, ahead of CLOSE.
    if (!opts || opts.controls !== false) {
      const controls = el('div', null, 'controls');
      const close = el('button', 'btn-close-scores', 'btn mint');
      close.textContent = 'CLOSE';
      controls.appendChild(close);
      modal.appendChild(controls);
    }

    overlay.appendChild(modal);
    body.appendChild(overlay);
  }

  return body;
}

function makeDocument(body) {
  const listeners = new Map();
  return {
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    documentElement: el('html'),
    getElementById(id) {
      for (const node of descendants(body)) if (node.id === id) return node;
      return null;
    },
    querySelector(sel) {
      const found = queryAll(body, parseSelector(sel));
      return found.length ? found[0] : null;
    },
    querySelectorAll(sel) {
      return queryAll(body, parseSelector(sel));
    },
    createElement(tag) { return new Element(tag); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const at = list.indexOf(fn);
      if (at !== -1) list.splice(at, 1);
    },
    dispatchEvent(evt) {
      const list = (listeners.get(evt.type) || []).slice();
      for (const fn of list) fn(evt);
      return true;
    },
  };
}

// -- the fakes ---------------------------------------------------------------

function makeStorage(seed) {
  const map = seed || new Map();
  const store = {
    map,
    failWrites: false,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (store.failWrites) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
  };
  return store;
}

/**
 * Mirrors GameCenterPlugin.swift, including the part that matters: every method
 * but signIn rejects when the local player is not authenticated, and each
 * rejects on the arguments it requires.
 */
function makeGameCenter(opts) {
  const calls = { signIn: 0, submitScore: [], showLeaderboard: [], reportAchievement: [] };
  const gc = {
    calls,
    authenticated: !!(opts && opts.authenticated),
    failSignIn: false,
    // A proxy that throws instead of returning a rejected promise. Capacitor's
    // does not, today; every call in gamekit.js is written as though it might do
    // either, and these switches are what make that a tested property rather
    // than a comment. george-boole had the fault these found.
    throwOnSignIn: false,
    throwOnShow: false,
    throwOnReport: false,
    signIn() {
      calls.signIn++;
      if (gc.throwOnSignIn) throw new Error('the bridge threw');
      if (gc.failSignIn) return Promise.reject(new Error('sign-in failed'));
      return Promise.resolve({ authenticated: gc.authenticated });
    },
    submitScore(o) {
      calls.submitScore.push(o);
      if (!o || typeof o.leaderboardId !== 'string') {
        return Promise.reject(new Error('leaderboardId is required'));
      }
      if (typeof o.score !== 'number') return Promise.reject(new Error('score is required'));
      if (!gc.authenticated) return Promise.reject(new Error('not signed in to Game Center'));
      return Promise.resolve();
    },
    showLeaderboard(o) {
      calls.showLeaderboard.push(o);
      if (gc.throwOnShow) throw new Error('the bridge threw');
      if (!gc.authenticated) return Promise.reject(new Error('not signed in to Game Center'));
      return Promise.resolve();
    },
    reportAchievement(o) {
      calls.reportAchievement.push(o);
      if (gc.throwOnReport) throw new Error('the bridge threw');
      if (!o || typeof o.achievementId !== 'string') {
        return Promise.reject(new Error('achievementId is required'));
      }
      if (!gc.authenticated) return Promise.reject(new Error('not signed in to Game Center'));
      return Promise.resolve();
    },
  };
  return gc;
}

/**
 * The Taptic Engine, which is the one plugin here whose refusal is ordinary
 * rather than exceptional: a device without one rejects. `throwOnCall` is that
 * refusal arriving as a synchronous throw instead, which Capacitor's proxy does
 * not do today -- haptics.js guards both, and it is the only shim whose calls
 * are not already inside a promise chain, so these are what keep the try there.
 */
function makeHaptics() {
  const calls = { impact: [], notification: [] };
  const h = {
    calls,
    throwOnCall: false,
    failCall: false,
    impact(o) { calls.impact.push(o && o.style); return h.answer(); },
    notification(o) { calls.notification.push(o && o.type); return h.answer(); },
    answer() {
      if (h.throwOnCall) throw new Error('no Taptic Engine');
      if (h.failCall) return Promise.reject(new Error('no Taptic Engine'));
      return Promise.resolve();
    },
  };
  return h;
}

/**
 * A fresh realm per test. The shims are IIFEs that latch state at load, so
 * "what happens on the next launch" can only be asked by building a new one
 * over the same storage.
 */
function makeEnv(opts) {
  const o = opts || {};
  const body = buildPage(o.page);
  const doc = makeDocument(body);
  const storage = o.storage || makeStorage();
  const gc = o.plugin === false ? null : makeGameCenter(o);
  const haptics = o.plugin === false ? null : makeHaptics();
  const errors = [];
  const timers = [];

  const plugins = {};
  if (gc) plugins.GameCenter = gc;
  if (haptics) plugins.Haptics = haptics;

  const win = { Capacitor: o.plugin === false ? undefined : { Plugins: plugins } };

  const sandbox = {
    window: win,
    document: doc,
    localStorage: storage,
    performance: { now: () => 0 },
    console: {
      log() {},
      warn() {},
      error() { errors.push(Array.prototype.join.call(arguments, ' ')); },
    },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  const env = {
    ctx, doc, win, storage, gc, haptics, errors, timers, body,
    load(...names) {
      for (const name of names) {
        const src = fs.readFileSync(path.join(SHIM_DIR, name), 'utf8');
        vm.runInContext(src, ctx, { filename: name });
      }
      return env;
    },
    // config.js's TRAY_CAP and main.js's localScores, declared the way the game
    // declares them: global lexical bindings in this realm, not window
    // properties. See the header.
    gameGlobals(trayCap) {
      const cap = trayCap === undefined ? 4 : JSON.stringify(trayCap);
      vm.runInContext('const TRAY_CAP = ' + cap + '; let localScores = [];', ctx,
        { filename: 'game-globals' });
      return env;
    },
    localScores() {
      try {
        return vm.runInContext('localScores', ctx);
      } catch (e) {
        return 'unset';
      }
    },
    // main.js's emit(): every moment this game announces is prefixed.
    fire(name, detail) {
      doc.dispatchEvent({ type: 'cookies:' + name, detail: detail || {} });
      return env;
    },
    ready() {
      doc.dispatchEvent({ type: 'DOMContentLoaded' });
      return env;
    },
    // Leaving the app to sign in and coming back is a visibilitychange, and it
    // is the only signal a webview gets for it.
    resume() {
      doc.visibilityState = 'visible';
      doc.dispatchEvent({ type: 'visibilitychange' });
      return env;
    },
    cookies() { return win.GameCookies || {}; },
    button() { return doc.getElementById('btn-game-center'); },
    runTimers() {
      const due = timers.splice(0, timers.length);
      for (const t of due) t.fn();
      return env;
    },
    stored(key) {
      const raw = storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    },
  };
  return env;
}

const P = 'com.magmacrunch.makemecookies.';
const BOARD = P + 'shift';
const BESTS_KEY = 'adenosine_scores_makemecookies';

// -- gamekit.js: the leaderboard ---------------------------------------------

async function leaderboardTests() {
  section('gamekit: no native half');
  {
    const env = makeEnv({ plugin: false }).load('gamekit.js');
    env.fire('shift-end', { score: 1200, stars: 3, shipped: 22 });
    env.fire('box', { cookies: 4, rush: true });
    env.fire('fire-out', {});
    await settle();
    assert(env.cookies().gameCenter.authenticated === false, 'authenticated is false in a browser');
    assertEqual(env.stored('mmc_achievements'), null, 'and nothing is banked as reported');
    assert(env.button() === null, 'no button is injected for a board that does not exist');
    assert(env.errors.length === 0, 'and nothing is logged as an error');
  }

  section('gamekit: signed in');
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    assert(env.cookies().gameCenter.authenticated === true, 'the load-time sign-in is recorded');
    assertEqual(env.cookies().gameCenter.leaderboardId, BOARD, 'and there is one leaderboard');

    env.fire('shift-end', { score: 1200, stars: 0, shipped: 3 });
    await settle();
    assertEqual(env.gc.calls.submitScore, [{ leaderboardId: BOARD, score: 1200 }],
      'a finished shift is submitted');

    env.fire('shift-end', { score: 40, stars: 0, shipped: 1 });
    await settle();
    assertEqual(env.gc.calls.submitScore[1], { leaderboardId: BOARD, score: 40 },
      'and so is a worse one, since Game Center keeps the best itself');

    env.fire('shift-end', { stars: 0 });
    env.fire('shift-end', { score: 'lots', stars: 0 });
    await settle();
    assert(env.gc.calls.submitScore.length === 2,
      'a shift with no numeric score is not submitted at all');
  }

  section('gamekit: the way into the board');
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    const btn = env.button();
    assert(btn !== null, 'the GAME CENTER button is injected once signed in');
    assertEqual(btn.textContent, 'GAME CENTER', 'with the label the card uses');
    const controls = env.doc.querySelector('#modal-scores .controls');
    assertEqual(controls.children.map((c) => c.id), ['btn-game-center', 'btn-close-scores'],
      'ahead of CLOSE, and CLOSE survives it');

    btn.dispatchEvent({ type: 'click' });
    await settle();
    assertEqual(env.gc.calls.showLeaderboard, [{ leaderboardId: BOARD }],
      'and the button opens the board');
  }
  {
    const env = makeEnv({ authenticated: false }).load('gamekit.js');
    await settle();
    assert(env.button() === null,
      'a player who declined is not offered a button that opens nothing');
  }
  section('gamekit: opening the board');
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    const opened = await env.cookies().gameCenter.show();
    assert(opened === true, 'show() resolves true when the board opened');
    assertEqual(env.gc.calls.showLeaderboard, [{ leaderboardId: BOARD }],
      'and passes the one id this game has');
  }
  {
    // Signed out. GameCenterPlugin.swift refuses it, and a refusal nobody is
    // holding is an unhandled rejection in the webview.
    const env = makeEnv({ authenticated: false }).load('gamekit.js');
    await settle();
    const opened = await env.cookies().gameCenter.show();
    assert(opened === false, 'show() resolves false when Game Center refused it');
    assert(env.gc.calls.showLeaderboard.length === 1, 'having asked');
  }
  {
    const env = makeEnv({ plugin: false }).load('gamekit.js');
    await settle();
    const opened = await env.cookies().gameCenter.show();
    assert(opened === false, 'and false in a browser, rather than throwing');
  }
  {
    // The call as any caller would actually write it: return value dropped.
    // That is the shape that leaked, and the reason show() may not reject.
    const env = makeEnv({ authenticated: false }).load('gamekit.js');
    await settle();
    const before = unhandled.length;
    env.cookies().gameCenter.show();
    await settle();
    assertEqual(unhandled.length, before,
      'and a show() whose promise is dropped leaks no unhandled rejection');
  }

  {
    // The card is not in the page at all: a static server pointed at www/ with
    // the modal renamed, or the markup moving. It must not throw.
    const env = makeEnv({ authenticated: true, page: { scores: false } }).load('gamekit.js');
    await settle();
    assert(env.button() === null, 'no card, no button');
    assert(env.errors.length === 0, 'and no error either');
  }
}

// -- gamekit.js: signing in later --------------------------------------------

async function signInTests() {
  section('gamekit: signing in after the shift has started');
  {
    // The second of the two bugs. `authenticated` was latched from one
    // fire-and-forget signIn() at load and never revisited, so a player who
    // declined Apple's sheet, signed in through Settings and came back was
    // never offered the board for the rest of the session -- and the shim went
    // on reporting itself signed out to anything that asked.
    // GameCenterPlugin.swift was already built for the second call: its
    // `reported` flag exists so a later signIn() answers from the current state
    // instead of hanging behind a handler that has already fired.
    const env = makeEnv({ authenticated: false }).load('gamekit.js');
    await settle();
    assert(env.cookies().gameCenter.authenticated === false, 'not signed in at launch');
    assert(env.button() === null, 'and no button');
    assertEqual(env.gc.calls.signIn, 1, 'one sign-in so far');

    env.gc.authenticated = true;
    env.resume();
    await settle();
    assertEqual(env.gc.calls.signIn, 2, 'coming back to the app asks again');
    assert(env.cookies().gameCenter.authenticated === true, 'and sees the sign-in');
    assert(env.button() !== null, 'so the board is offered from then on');

    env.resume();
    await settle();
    const controls = env.doc.querySelector('#modal-scores .controls');
    assertEqual(controls.children.length, 2, 'and coming back twice injects one button');
  }

  section('gamekit: a native half that throws rather than rejecting');
  {
    // refresh() runs bare at load, above the cookies:* listeners and above
    // window.GameCookies.gameCenter, so a throw there would not be one lost
    // sign-in: it would be the whole file, silently, for the session. This file
    // wraps its own call and george-boole's did not, which is the fault these
    // tests were written for -- pinned here so the two do not drift back apart.
    const env = makeEnv({ authenticated: true });
    env.gc.throwOnSignIn = true;
    env.load('gamekit.js');
    await settle();
    assert(env.cookies().gameCenter !== undefined,
      'a throwing signIn does not take the rest of the file down with it');
    assert(env.cookies().gameCenter.authenticated === false, 'and reads as signed out');
    assert(env.button() === null, 'offering no button');

    env.gc.throwOnSignIn = false;
    env.resume();
    await settle();
    assert(env.cookies().gameCenter.authenticated === true,
      'the visibilitychange listener was registered, so it recovers');

    env.fire('shift-end', { score: 500, stars: 0 });
    await settle();
    assert(env.gc.calls.submitScore.length === 1,
      'and so were the cookies:* listeners, which is what a throw at load would cost');
    assert(env.errors.length === 0, 'with nothing logged either way');
  }
  {
    // A native half with no signIn at all: the same fault by a different road,
    // and what this plugin drifting from hypnopompia looks like from here.
    const env = makeEnv({ authenticated: true });
    delete env.gc.signIn;
    env.load('gamekit.js');
    await settle();
    assert(env.cookies().gameCenter !== undefined, 'a plugin missing signIn is survived');
    assert(env.cookies().gameCenter.authenticated === false, 'and reads as signed out');
  }
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    env.gc.throwOnShow = true;
    let threw = false;
    let result = null;
    try {
      result = await env.cookies().gameCenter.show();
    } catch (e) {
      threw = true;
    }
    assert(threw === false, 'a throwing showLeaderboard does not throw out of show()');
    assert(result === false, 'it resolves false like any other refusal');
  }
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    env.gc.throwOnReport = true;
    env.fire('fire-out', { count: 1 });
    await settle();
    assertEqual(env.stored('mmc_achievements'), null, 'a throwing report is not banked');
    assertEqual(env.cookies().gameCenter.pending, [P + 'fireout'], 'it stays owed');
    assert(env.errors.length === 0, 'and is not logged as an error');

    env.gc.throwOnReport = false;
    env.resume();
    await settle();
    assertEqual(env.stored('mmc_achievements'), [P + 'fireout'],
      'and lands on the next return to the app');
  }

  section('gamekit: signing out mid-session');
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    assert(env.button() !== null, 'the button is there while signed in');

    env.gc.authenticated = false;
    env.resume();
    await settle();
    assert(env.cookies().gameCenter.authenticated === false, 'a sign-out is noticed too');
    assert(env.button() === null,
      'and takes the button with it, rather than leaving one every tap is refused');
    const controls = env.doc.querySelector('#modal-scores .controls');
    assertEqual(controls.children.map((c) => c.id), ['btn-close-scores'],
      'and CLOSE survives the removal as well as the injection');

    env.gc.authenticated = true;
    env.resume();
    await settle();
    assert(env.button() !== null, 'signing back in brings it back');
    assertEqual(controls.children.length, 2, 'once');
  }

  section('gamekit: the plugin misbehaving');
  {
    const env = makeEnv({ authenticated: true });
    env.gc.failSignIn = true;
    env.load('gamekit.js');
    await settle();
    assert(env.cookies().gameCenter.authenticated === false, 'a rejected sign-in is not fatal');
    assert(env.button() === null, 'and offers no button');
    env.fire('shift-end', { score: 100, stars: 0 });
    await settle();
    assert(env.errors.length === 0, 'and a rejected submission is not either');

    env.gc.failSignIn = false;
    env.resume();
    await settle();
    assert(env.cookies().gameCenter.authenticated === true,
      'and the next return to the app recovers from it');
    assert(env.button() !== null, 'and offers the board at last');
  }
  {
    // Signed in, then a signIn() that rejects. The plugin cannot say, so the
    // shim reads it as signed out, and a button it would refuse must not stay.
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    assert(env.button() !== null, 'the button is there');
    env.gc.failSignIn = true;
    env.resume();
    await settle();
    assert(env.cookies().gameCenter.authenticated === false,
      'a rejected re-check reads as signed out');
    assert(env.button() === null, 'and the button does not outlive it');
  }
}

// -- gamekit.js: achievements ------------------------------------------------

async function achievementTests() {
  section('gamekit: the eight achievements');
  {
    const env = makeEnv({ authenticated: true }).gameGlobals(4).load('gamekit.js');
    await settle();
    assertEqual(env.cookies().gameCenter.ids.length, 8, 'eight ids, as the header table says');

    env.fire('box', { cookies: 1, rush: false });
    await settle();
    assertEqual(env.gc.calls.reportAchievement, [{ achievementId: P + 'shipped', percent: 100 }],
      'shipping a box reports shipped');
    assertEqual(env.stored('mmc_achievements'), [P + 'shipped'],
      'and it is banked once Game Center has accepted it');

    env.fire('box', { cookies: 1, rush: false });
    env.fire('box', { cookies: 1, rush: false });
    await settle();
    assert(env.gc.calls.reportAchievement.length === 1, 'and not reported twice');

    env.fire('box', { cookies: 2, rush: true });
    await settle();
    let ids = env.gc.calls.reportAchievement.map((c) => c.achievementId);
    assert(ids.indexOf(P + 'rushbox') !== -1, 'a box inside a RUSH window reports rushbox');
    assert(ids.indexOf(P + 'fullhouse') === -1, 'and two cookies is not a full house');

    env.fire('box', { cookies: 4, rush: false });
    await settle();
    ids = env.gc.calls.reportAchievement.map((c) => c.achievementId);
    assert(ids.indexOf(P + 'fullhouse') !== -1, 'a box of TRAY_CAP is');

    env.fire('fire-out', { count: 1 });
    await settle();
    ids = env.gc.calls.reportAchievement.map((c) => c.achievementId);
    assert(ids.indexOf(P + 'fireout') !== -1, 'putting the oven out reports fireout');

    env.fire('shift-end', { score: 900, stars: 2, shipped: 15, bonusLabel: null });
    await settle();
    ids = env.gc.calls.reportAchievement.map((c) => c.achievementId);
    assert(ids.indexOf(P + 'star1') !== -1 && ids.indexOf(P + 'star2') !== -1,
      'two stars reports both rungs up to it');
    assert(ids.indexOf(P + 'star3') === -1, 'and not the one above');
    assert(ids.indexOf(P + 'spotless') === -1, 'no bonus, no spotless');

    env.fire('shift-end', { score: 2000, stars: 3, shipped: 22, bonusLabel: 'SPOTLESS' });
    await settle();
    ids = env.gc.calls.reportAchievement.map((c) => c.achievementId);
    assert(ids.indexOf(P + 'star3') !== -1, 'three stars reports star3');
    assert(ids.indexOf(P + 'spotless') !== -1, 'and the SPOTLESS label reports spotless');

    env.fire('shift-end', { score: 2000, stars: 3, shipped: 22, bonusLabel: 'TIDY' });
    await settle();
    assert(env.gc.calls.reportAchievement.filter((c) => c.achievementId === P + 'spotless')
      .length === 1, 'but another bonus does not');

    assertEqual(env.cookies().gameCenter.reported.slice().sort(),
      [P + 'fireout', P + 'fullhouse', P + 'rushbox', P + 'shipped',
        P + 'star1', P + 'star2', P + 'star3', P + 'spotless'].sort(),
      'and all eight end up banked');
    assertEqual(env.cookies().gameCenter.pending, [], 'with nothing still owed');
  }

  section('gamekit: a box before config.js has run');
  {
    // TRAY_CAP is read at call time for exactly this reason. Without it the
    // shim must stop awarding rather than award wrongly, because an id cannot
    // be redone.
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    env.fire('box', { cookies: 99, rush: false });
    await settle();
    const ids = env.gc.calls.reportAchievement.map((c) => c.achievementId);
    assert(ids.indexOf(P + 'shipped') !== -1, 'the box still counts');
    assert(ids.indexOf(P + 'fullhouse') === -1,
      'but no full house is invented from a missing cap');
  }

  section('gamekit: earned while signed out');
  {
    // The first of the two bugs, and the reason this file exists. The plugin IS
    // there, so the no-native-half guard does not apply, and the report is
    // rejected by GameCenterPlugin.swift's isAuthenticated guard. An id banked
    // as reported at that point is gone for good: award() returns early on it
    // for ever after.
    const env = makeEnv({ authenticated: false }).load('gamekit.js');
    env.fire('fire-out', { count: 1 });
    await settle();
    assert(env.gc.calls.reportAchievement.length === 1, 'the report is attempted');
    assertEqual(env.stored('mmc_achievements'), null,
      'and a rejected report is NOT banked as reported');
    assertEqual(env.cookies().gameCenter.reported, [],
      'so the public list does not claim it either');
    assertEqual(env.cookies().gameCenter.pending, [P + 'fireout'], 'it is owed instead');
    assertEqual(env.stored('mmc_achievements_pending'), [P + 'fireout'],
      'and the debt outlives the launch');

    env.gc.authenticated = true;
    env.cookies().gameCenter.flush();
    await settle();
    assert(env.gc.calls.reportAchievement.length === 2, 'it is retried once signed in');
    assertEqual(env.stored('mmc_achievements'), [P + 'fireout'], 'and then banked');
    assertEqual(env.stored('mmc_achievements_pending'), [], 'and no longer owed');

    env.cookies().gameCenter.flush();
    await settle();
    assert(env.gc.calls.reportAchievement.length === 2, 'and flushing again sends nothing');
  }

  section('gamekit: what is owed is sent when the sign-in arrives');
  {
    const env = makeEnv({ authenticated: false }).gameGlobals(4).load('gamekit.js');
    await settle();
    env.fire('box', { cookies: 4, rush: true });
    await settle();
    assertEqual(env.stored('mmc_achievements'), null, 'earned, not banked');
    assertEqual(env.cookies().gameCenter.pending.slice().sort(),
      [P + 'fullhouse', P + 'rushbox', P + 'shipped'], 'three owed from one box');

    env.gc.authenticated = true;
    env.resume();
    await settle();
    assertEqual(env.stored('mmc_achievements').slice().sort(),
      [P + 'fullhouse', P + 'rushbox', P + 'shipped'],
      'coming back signed in reports all three, with no new box needed');
    assertEqual(env.cookies().gameCenter.pending, [], 'and nothing is left owed');
  }

  section('gamekit: earned while signed out, then relaunched');
  {
    const first = makeEnv({ authenticated: false }).load('gamekit.js');
    first.fire('fire-out', { count: 1 });
    first.fire('shift-end', { score: 500, stars: 1, shipped: 8 });
    await settle();
    assertEqual(first.stored('mmc_achievements'), null, 'nothing is banked while signed out');
    assertEqual(first.stored('mmc_achievements_pending').slice().sort(),
      [P + 'fireout', P + 'star1'], 'both are owed');

    // Same device, same storage, next launch, and this time signed in.
    const second = makeEnv({ authenticated: true, storage: first.storage }).load('gamekit.js');
    await settle();
    const ids = second.gc.calls.reportAchievement.map((c) => c.achievementId).sort();
    assertEqual(ids, [P + 'fireout', P + 'star1'],
      'what was earned offline survives the relaunch and is reported');
    assertEqual(second.stored('mmc_achievements').slice().sort(),
      [P + 'fireout', P + 'star1'], 'and banked');
  }

  section('gamekit: offline, with the player already signed in');
  {
    // Not the sign-in case: GameKit itself refusing. The retry path is the same
    // one, which is the point of keeping the debt rather than a coincidence.
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    env.gc.authenticated = false;
    env.fire('fire-out', { count: 1 });
    await settle();
    assertEqual(env.cookies().gameCenter.pending, [P + 'fireout'], 'a refused report is owed');

    env.gc.authenticated = true;
    env.resume();
    await settle();
    assertEqual(env.stored('mmc_achievements'), [P + 'fireout'],
      'and the next return to the app settles it');
  }

  section('gamekit: no native half, achievements');
  {
    const env = makeEnv({ plugin: false }).gameGlobals(4).load('gamekit.js');
    env.fire('box', { cookies: 4, rush: false });
    await settle();
    assertEqual(env.stored('mmc_achievements'), null,
      'an achievement earned before the plugin exists is not written off');
    assertEqual(env.stored('mmc_achievements_pending').slice().sort(),
      [P + 'fullhouse', P + 'shipped'], 'it is owed, for the day the plugin lands');
  }

  section('gamekit: storage refusing writes');
  {
    const env = makeEnv({ authenticated: true }).load('gamekit.js');
    await settle();
    env.storage.failWrites = true;
    env.fire('fire-out', { count: 1 });
    await settle();
    assert(env.gc.calls.reportAchievement.length === 1,
      'a full localStorage costs a duplicate banner at worst, not the achievement');
    assert(env.errors.length === 0, 'and is not logged as an error');
  }

  section('gamekit: reset');
  {
    const env = makeEnv({ authenticated: false }).load('gamekit.js');
    env.fire('fire-out', { count: 1 });
    await settle();
    env.cookies().gameCenter.reset();
    assertEqual(env.cookies().gameCenter.reported, [], 'reset clears what was banked');
    assertEqual(env.cookies().gameCenter.pending, [], 'and what was owed');
    assertEqual(env.stored('mmc_achievements_pending'), null, 'in storage as well');
  }
}

// -- bests.js ----------------------------------------------------------------

async function bestsTests() {
  section('bests: recording');
  {
    const env = makeEnv({ authenticated: true }).gameGlobals(4).load('bests.js');
    env.fire('shift-end', { score: 1200, shipped: 15 });
    const rows = env.stored(BESTS_KEY);
    assertEqual(rows.length, 1, 'a finished shift is filed');
    assertEqual(rows[0].score, 1200, 'with its score');
    assertEqual(rows[0].shipped, 15, 'and what it shipped');
    assert(/^[0-9]+ [A-Z][A-Z][A-Z]$/.test(rows[0].initials),
      'and a date in the WHO column rather than initials');
    assertEqual(env.localScores(), rows, 'and the table showing now is updated too');

    env.fire('shift-end', { score: 2000, shipped: 22 });
    env.fire('shift-end', { score: 40, shipped: 1 });
    assertEqual(env.stored(BESTS_KEY).map((r) => r.score), [2000, 1200, 40],
      'and the board is sorted best first');

    env.fire('shift-end', { shipped: 3 });
    env.fire('shift-end', { score: 'lots' });
    assertEqual(env.stored(BESTS_KEY).length, 3, 'a shift with no numeric score is not filed');

    for (let i = 0; i < 20; i++) env.fire('shift-end', { score: 100 + i, shipped: 2 });
    assertEqual(env.stored(BESTS_KEY).length, 10, 'and ten is the whole board');
    assertEqual(env.stored(BESTS_KEY)[0].score, 2000, 'with the best still on it');
  }

  section('bests: a row this file did not write');
  {
    // renderScores() calls toLocaleString() on score, so a junk row would take
    // the table down rather than just the row.
    const storage = makeStorage();
    storage.setItem(BESTS_KEY, JSON.stringify([
      { initials: 'ABC', score: 'not a number' },
      null,
      { initials: '1 SEP', score: 700 },
    ]));
    const env = makeEnv({ authenticated: true, storage }).load('bests.js');
    env.fire('shift-end', { score: 100, shipped: 1 });
    assertEqual(env.stored(BESTS_KEY).map((r) => r.score), [700, 100],
      'is dropped rather than carried forward');
  }
  {
    const storage = makeStorage();
    storage.setItem(BESTS_KEY, 'not json at all');
    const env = makeEnv({ authenticated: true, storage }).load('bests.js');
    env.fire('shift-end', { score: 100, shipped: 1 });
    assertEqual(env.stored(BESTS_KEY).map((r) => r.score), [100],
      'and so is a store that will not parse');
  }

  section('bests: the two labels the card gets wrong in a bundle');
  {
    const env = makeEnv({ authenticated: true }).load('bests.js');
    assertEqual(env.doc.querySelector('#modal-scores thead th:nth-child(2)').textContent, 'WHO',
      'WHO is what the site says');
    env.ready();
    assertEqual(env.doc.querySelector('#modal-scores thead th:nth-child(2)').textContent, 'WHEN',
      'and WHEN is what a board of dates says');
    assertEqual(env.doc.querySelector('#modal-scores .modal-sub').textContent, 'on this device',
      'and the arcade subtitle goes with it');
  }
  {
    const env = makeEnv({ authenticated: true, page: { scores: false } }).load('bests.js');
    env.ready();
    assert(env.errors.length === 0,
      'a card that is not there is left alone rather than thrown at');
    env.fire('shift-end', { score: 120, shipped: 4 });
    assertEqual(env.stored(BESTS_KEY).length, 1, 'and recording still works');
  }

  section('bests: storage refusing writes');
  {
    const env = makeEnv({ authenticated: true }).gameGlobals(4).load('bests.js');
    env.storage.failWrites = true;
    env.fire('shift-end', { score: 1200, shipped: 15 });
    assertEqual(env.localScores().length, 1,
      'a full localStorage costs the history, not the shift that just ended');
    assert(env.errors.length === 0, 'and is not logged as an error');
  }

  section('bests: before main.js has been parsed');
  {
    const env = makeEnv({ authenticated: true }).load('bests.js');
    env.fire('shift-end', { score: 1200, shipped: 15 });
    assertEqual(env.stored(BESTS_KEY).length, 1, 'the shift is still filed');
    assertEqual(env.localScores(), 'unset', 'with no binding to assign, and no throw');
    assert(env.errors.length === 0, 'and nothing logged');
  }

  section('bests: reset');
  {
    const env = makeEnv({ authenticated: true }).gameGlobals(4).load('bests.js');
    env.fire('shift-end', { score: 1200, shipped: 15 });
    assertEqual(env.cookies().bests.rows.length, 1, 'the rows read back');
    env.cookies().bests.reset();
    assertEqual(env.cookies().bests.rows, [], 'and reset empties both places');
    assertEqual(env.localScores(), [], 'the one showing included');
  }
}

// -- haptics.js --------------------------------------------------------------

async function hapticTests() {
  section('haptics: the mapping');
  {
    const env = makeEnv({ authenticated: true }).load('haptics.js');
    env.fire('perfect', { count: 1 });
    env.fire('box', { count: 1, rush: false });
    env.fire('burnt', { count: 1 });
    env.fire('spill', { count: 1 });
    env.fire('jam', { count: 1 });
    await settle();
    assertEqual(env.haptics.calls.impact, ['LIGHT', 'MEDIUM', 'HEAVY', 'HEAVY', 'MEDIUM'],
      'the impacts are the table in AGENTS.md');

    env.fire('box', { count: 1, rush: true });
    env.fire('fire', { count: 1 });
    env.fire('fire-out', { count: 1 });
    env.fire('inspection', { count: 1 });
    await settle();
    assertEqual(env.haptics.calls.notification, ['SUCCESS', 'WARNING', 'SUCCESS', 'ERROR'],
      'and a doubled box is a notification rather than an impact');
  }

  section('haptics: the shift ending');
  {
    const env = makeEnv({ authenticated: true }).load('haptics.js');
    env.fire('shift-end', { score: 1200, bonus: 500 });
    await settle();
    assertEqual(env.haptics.calls.notification, ['SUCCESS'], 'a clean-up bonus is felt as one');
    env.fire('shift-end', { score: 1200, bonus: 0 });
    await settle();
    assertEqual(env.haptics.calls.impact, ['HEAVY'], 'and a shift without one is not');
  }

  section('haptics: the RUSH fanfare');
  {
    const env = makeEnv({ authenticated: true }).load('haptics.js');
    env.fire('rush', { count: 1, index: 0 });
    assertEqual(env.haptics.calls.impact, ['MEDIUM'], 'the first tap is immediate');
    assertEqual(env.timers.map((t) => t.ms), [90, 180], 'and two more are queued 90ms apart');
    env.runTimers();
    await settle();
    assertEqual(env.haptics.calls.impact, ['MEDIUM', 'MEDIUM', 'MEDIUM'], 'three in all');
  }

  section('haptics: switched off');
  {
    const env = makeEnv({ authenticated: true }).load('haptics.js');
    assert(env.cookies().haptics.enabled === true, 'on by default');
    env.cookies().haptics.set(false);
    assertEqual(env.storage.getItem('mmc_haptics'), 'off', 'and the choice is remembered');
    env.fire('perfect', { count: 1 });
    env.fire('box', { count: 1, rush: true });
    env.fire('shift-end', { score: 10, bonus: 0 });
    env.runTimers();
    await settle();
    assertEqual(env.haptics.calls.impact, [], 'nothing is felt once it is switched off');
    assertEqual(env.haptics.calls.notification, [], 'of either kind');

    const next = makeEnv({ authenticated: true, storage: env.storage }).load('haptics.js');
    assert(next.cookies().haptics.enabled === false, 'and it is still off on the next launch');
  }

  section('haptics: a device that refuses');
  {
    // An iPad, or any device with no Taptic Engine.
    const env = makeEnv({ authenticated: true }).load('haptics.js');
    env.haptics.failCall = true;
    const before = unhandled.length;
    env.fire('perfect', { count: 1 });
    env.fire('box', { count: 1, rush: true });
    env.fire('rush', { count: 1 });
    env.runTimers();
    await settle();
    assert(env.errors.length === 0, 'every buzz being rejected is not an error');
    assertEqual(unhandled.length, before,
      'and the rejections are caught rather than left to escape');
  }
  {
    const env = makeEnv({ authenticated: true }).load('haptics.js');
    env.haptics.throwOnCall = true;
    env.fire('perfect', { count: 1 });
    env.fire('fire', { count: 1 });
    env.fire('shift-end', { score: 10, bonus: 0 });
    env.runTimers();
    await settle();
    assert(env.errors.length === 0, 'a throwing plugin is survived too');
    assert(env.cookies().haptics.enabled === true, 'and the shim is still live after it');
  }

  section('haptics: no native half');
  {
    const env = makeEnv({ plugin: false }).load('haptics.js');
    env.fire('perfect', { count: 1 });
    env.fire('rush', { count: 1 });
    env.runTimers();
    await settle();
    assert(env.cookies().haptics === undefined,
      'the shim returns before publishing an API it cannot honour');
    assert(env.errors.length === 0, 'and every event is a no-op');
  }
}

// -- the three together ------------------------------------------------------

async function togetherTests() {
  section('all three, one shift');
  {
    // The order package.mjs loads them in, over one realm, because that is the
    // only arrangement the app ever runs.
    const env = makeEnv({ authenticated: true })
      .gameGlobals(4)
      .load('gamekit.js', 'haptics.js', 'bests.js');
    await settle();
    env.ready();

    env.fire('box', { count: 1, rush: true, cookies: 4 });
    env.fire('shift-end',
      { score: 2400, shipped: 22, stars: 3, bonus: 500, bonusLabel: 'SPOTLESS' });
    await settle();

    assertEqual(env.gc.calls.submitScore, [{ leaderboardId: BOARD, score: 2400 }],
      'the score goes to Game Center');
    assertEqual(env.stored(BESTS_KEY).length, 1, 'the shift goes on the local board');
    assertEqual(env.cookies().gameCenter.reported.length, 7,
      'seven of the eight achievements are banked -- everything but fireout');
    assertEqual(env.cookies().gameCenter.pending, [], 'with nothing owed');
    assert(env.haptics.calls.notification.length >= 2, 'and the player felt both moments');
    assert(env.errors.length === 0, 'and nothing was logged as an error');
  }
}

// -- run ---------------------------------------------------------------------

(async function main() {
  console.log('=== makemecookies!x4 iOS shim tests ===');
  try {
    await leaderboardTests();
    await signInTests();
    await achievementTests();
    await bestsTests();
    await hapticTests();
    await togetherTests();
  } catch (e) {
    failed++;
    console.error('\n  FAIL: the suite threw -- ' + (e && e.stack ? e.stack : e));
  }
  // One more turn of the loop, so a rejection raised by the last test has
  // somewhere to land before the count is read.
  await settle();
  for (const reason of unhandled) {
    failed++;
    console.error('\n  FAIL: a promise rejection escaped a shim uncaught -- ' + reason);
  }
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
})();
