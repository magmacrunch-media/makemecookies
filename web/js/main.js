// =====================================================================
// main.js — makemecookies!x4
// The AdRPG shell: loop, input, the song, the modals, the scoreboard.
//
// adenosine is used here as a loop + input + state harness only, the way
// arcade/tetris does it. Nothing in adenosine knows what a cookie is.
// =====================================================================

const canvas = document.getElementById('line');
const ctx = canvas.getContext('2d');
AdRPG.initCanvas(canvas);

// ?debug turns the end-of-shift card into a readout. It exists because the
// tuning was fitted by simulating shifts, and a simulated player is a perfect
// prioritiser who never burns anything — so the numbers that matter most
// (overmixed batches for readyMs, burnt trays for goldenMs) are exactly the
// ones a bot cannot produce. This is how a real shift answers back.
const DEBUG = new URLSearchParams(location.search).has('debug');

let st = createShift();
let running = false;
let paused = false;
let finished = false;

// ── The song ─────────────────────────────────────────────────────────
// AdAudio cannot own this: it hardcodes musicSource.loop = true and
// exposes no `ended` event and no playback position. A round that *is*
// one play of a track needs all three, so the track is a plain <audio>
// element and AdAudio is left for SFX.
// iOS has no Ogg Vorbis decoder - and every browser on iOS is WebKit, so
// Chrome and Firefox there fail identically. The .ogg that plays everywhere
// else is simply silent on an iPhone. Offer the formats in preference order
// and let the browser choose one it can actually decode. Ogg goes first not
// because it is smaller - at V0 the mp3 is within 6KB of it - but because it
// is the original encode; the mp3 is a second-generation transcode of it, so
// anything that can decode Vorbis should get the better copy.
const MUSIC_SOURCES = [
  { url: 'audio/makemecookies-x4.ogg', type: 'audio/ogg; codecs="vorbis"' },
  { url: 'audio/makemecookies-x4.mp3', type: 'audio/mpeg' },
];

function pickMusicSource() {
  const probe = document.createElement('audio');
  // canPlayType answers '', 'maybe' or 'probably'. Empty is a definite no;
  // anything else is worth attempting.
  return MUSIC_SOURCES.find((s) => probe.canPlayType(s.type) !== '') || null;
}

// Audio failing should never be silent in both senses. The shift clock falls
// back to the wall clock and the game plays on, but the player is told why
// there is no music instead of being left to wonder - which is exactly how
// this went unnoticed on iOS until someone reported it.
let audioProblem = null;
function noteAudioProblem(why) {
  if (audioProblem) return;          // first cause is the useful one
  audioProblem = why;
  console.warn('makemecookies audio:', why);
  const el = document.getElementById('audio-warning');
  if (el) { el.textContent = why; el.hidden = false; }
}

const chosenSource = pickMusicSource();
// Deliberately not new Audio(''): an empty src resolves against the document
// URL, so the browser would fetch this page and try to decode the HTML.
const music = new Audio();
if (chosenSource) music.src = chosenSource.url;
music.loop = false;
music.preload = 'auto';
music.volume = 0.55;               // ignored on iOS, where volume is hardware

if (!chosenSource) {
  noteAudioProblem('This browser cannot play the music format. The shift still runs.');
}

music.addEventListener('error', () => {
  const c = music.error && music.error.code;
  noteAudioProblem('Music could not load' + (c ? ' (media error ' + c + ')' : '')
    + '. The shift still runs.');
});

// Ogg carries no duration header, so the browser estimates one from bitrate
// while the file is still streaming and corrects it once enough is buffered.
// This track first reports 41.7s and settles at 51.2s. Reading it only at
// loadedmetadata ends the shift nine seconds early and puts all four rush
// windows in the wrong place, so listen for the correction as well.
function syncDuration() {
  if (Number.isFinite(music.duration) && music.duration > 1) {
    st.shiftMs = music.duration * 1000;
  }
}
music.addEventListener('loadedmetadata', syncDuration);
music.addEventListener('durationchange', syncDuration);
music.addEventListener('ended', () => endShift());

// ── Input ────────────────────────────────────────────────────────────
// initInput records keysPressed for *every* key, so 1-5 need no binding.
// But it only clears keysPressed on keyup, and consuming it by hand (as
// tetris does for space) lets OS key-repeat re-fire the station. Edge
// detection against our own snapshot of AdRPG.keys gives exactly one
// action per physical press.
const COOKIE_BINDINGS = {
  moveUp: [], moveDown: [], moveLeft: [], moveRight: [],
  pause: ['escape', 'p'],
  interact: [],
};

const BAY_KEYS = ['1', '2', '3', '4', '5'];
const prevDown = {};

const FRAME_MS = 1000 / 30;

// ── HUD ──────────────────────────────────────────────────────────────
const elScore = document.getElementById('hud-score');
const elShipped = document.getElementById('hud-shipped');
const elTime = document.getElementById('hud-time');
const elRush = document.getElementById('hud-rush');

function updateHUD() {
  elScore.textContent = st.score.toLocaleString();
  elShipped.textContent = st.shipped;
  const left = Math.max(0, Math.ceil((st.shiftMs - st.elapsed) / 1000));
  elTime.textContent = '0:' + String(left).padStart(2, '0');
  elTime.classList.toggle('urgent', left <= 10);
  elRush.textContent = st.rush >= 0 ? 'RUSH x' + (st.rush + 1) : '';
}

// ── Loop ─────────────────────────────────────────────────────────────

function update(dtFactor) {
  const now = performance.now();
  const dtMs = dtFactor * FRAME_MS;

  // The shift clock is the song, not the frame counter — so the ramp and
  // the four rush windows land on the music even when the tab drops
  // frames. The accumulator is the fallback for a rejected play().
  if (!music.paused && music.currentTime > 0) st.elapsed = music.currentTime * 1000;
  else st.elapsed += dtMs;

  st.rush = RUSH_AT.findIndex((f) => {
    const t0 = f * st.shiftMs;
    return st.elapsed >= t0 && st.elapsed < t0 + RUSH_MS;
  });

  const inspecting = now < st.inspectUntil;
  for (const k of BAY_KEYS) {
    const down = !!AdRPG.keys[k];
    if (down && !prevDown[k] && !inspecting) {
      PRESS[BAY_KEYS.indexOf(k)](st, tune(st), now);
    }
    prevDown[k] = down;
  }

  st.__T = updateShift(st, dtMs, now);

  // The inspector ducks the music rather than stopping it. Idempotent, so
  // there is no transition to detect.
  music.volume = inspecting ? 0.25 : 0.55;

  updateHUD();
  if (st.elapsed >= st.shiftMs - 20) endShift();
}

const gameLoop = AdRPG.createGameLoop({ update, render, fps: 30 });

// ── Clicks ───────────────────────────────────────────────────────────
// The canvas is CSS-scaled, so pointer coordinates have to come back
// through getBoundingClientRect before they mean anything to BAYS.
canvas.addEventListener('pointerdown', (e) => {
  if (!running || paused || finished) return;
  const now = performance.now();
  if (now < st.inspectUntil) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * canvas.width / r.width;
  const bay = BAYS.findIndex((b) => x >= b.x && x < b.x + b.w);
  if (bay >= 0) PRESS[bay](st, tune(st), now);
});

// ── Shift lifecycle ──────────────────────────────────────────────────

function startShift() {
  // play() must be reached synchronously from the click, before any await,
  // or the autoplay policy refuses it.
  // Setting currentTime before any data has loaded throws on some browsers,
  // and it would throw here before play() is ever reached.
  try { music.currentTime = 0; } catch (e) { /* play() starts at 0 regardless */ }
  music.volume = 0.55;
  const p = music.play();
  if (p && p.catch) {
    p.catch((err) => noteAudioProblem('Music was blocked (' + err.name
      + '). The shift still runs on its own clock.'));
  }

  const keep = st.shiftMs;
  st = createShift();
  st.shiftMs = keep;

  const now = performance.now();
  armShift(st, tune(st), now);

  running = true; paused = false; finished = false;
  AdRPG.setGameStarted(true);
  AdRPG.setGamePaused(false);
  AdRPG.setGameOver(false);

  document.body.classList.add('game-active');
  document.getElementById('btn-pause').style.display = '';
  updateHUD();

  gameLoop.stop();
  gameLoop.start();
}

function endShift() {
  if (!running || finished) return;   // ended can fire more than once
  finished = true;
  running = false;

  music.pause();
  const bonus = settleShift(st);

  AdRPG.setGameOver(true);
  AdRPG.setGameStarted(false);
  gameLoop.stop();

  document.body.classList.remove('game-active');
  document.getElementById('btn-pause').style.display = 'none';
  document.getElementById('final-score').textContent = st.score.toLocaleString();
  document.getElementById('final-shipped').textContent = st.shipped;
  document.getElementById('final-bonus').textContent =
    bonus ? bonus.label + '  +' + bonus.points : 'NO CLEAN-UP BONUS';
  document.getElementById('initials-input').value = '';
  reportShift(bonus);
  showModal('modal-gameover');
}

/**
 * The shift, in numbers. Printed to the console always — it costs nothing and
 * is there when something looks wrong — and shown on the card under ?debug,
 * because a phone has no console and the phone is where this gets played.
 */
function reportShift(bonus) {
  const t = st.tally;
  const secs = (st.elapsed / 1000).toFixed(1);
  const lines = [
    `shipped ${st.shipped}   score ${st.score}   ${bonus ? bonus.label : 'no bonus'}   ${secs}s`,
    `oven    perfect ${t.perfect}  seconds ${t.seconds}  raw ${t.raw}  burnt ${t.burnt}`,
    `mixer   overmixed ${t.overmixed}   packing  boxes ${t.boxes}`,
    `belt    jams ${t.jams}   spills ${t.spills}`,
    `mess    peak ${Math.round(t.peakMess)}  final ${Math.round(st.mess)}  ` +
      `fires ${t.fires} (${(t.fireMs / 1000).toFixed(1)}s)  inspections ${st.inspections}`,
  ];
  console.log('%c makemecookies shift ', 'background:#FF2E9C;color:#180C18', '\n' + lines.join('\n'));

  const el = document.getElementById('debug-readout');
  if (el) {
    el.textContent = lines.join('\n');
    el.hidden = !DEBUG;
  }
}

function togglePause() {
  if (!running || finished) return;
  paused = !paused;
  AdRPG.setGamePaused(paused);
  document.getElementById('btn-pause').textContent = paused ? 'RESUME' : 'PAUSE';
  if (paused) { music.pause(); showModal('modal-pause'); }
  else { music.play().catch(() => {}); hideModal('modal-pause'); }
}

/**
 * Back to the title card. The same operation whether you clocked out
 * mid-shift or just finished one, which is the point: every exit now lands
 * somewhere you can start again from. Closing the scoreboard after a shift
 * used to leave the page on an idle factory with no CLOCK IN on it.
 */
function toTitle() {
  gameLoop.stop();
  music.pause();
  running = false; paused = false; finished = false;
  AdRPG.setGameStarted(false);
  AdRPG.setGamePaused(false);
  AdRPG.setGameOver(false);
  document.body.classList.remove('game-active');
  document.getElementById('btn-pause').style.display = 'none';
  document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
  // Carry the measured song length across the reset. createShift() falls back
  // to the 51000 constant, and loadedmetadata/durationchange have long since
  // fired, so without this a second shift silently runs on the fallback.
  const keep = st.shiftMs;
  st = createShift();
  st.shiftMs = keep;
  render();
  showTitleScreen();
}

// A fixed-length race must not run in a hidden tab. AdAudio.handleVisibility
// is no help here — it would restart its own music on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !paused && !finished) togglePause();
});

// ── Scores ───────────────────────────────────────────────────────────
let localScores = [];

async function loadScores() {
  try {
    localScores = await scoreClient.load('makemecookies');
  } catch (e) { console.error('Score load failed', e); }
}

// On-screen table only. scoreClient.save() owns persistence — writing the
// storage key here too would truncate the engine's list to these ten.
function addScoreToTable(initials, sc, shipped) {
  localScores.push({ initials: initials.toUpperCase().slice(0, 3), score: sc, shipped });
  localScores.sort((a, b) => b.score - a.score);
  localScores = localScores.slice(0, 10);
}

function renderScores() {
  const tbody = document.getElementById('scores-tbody');
  tbody.innerHTML = '';
  if (!localScores.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#6a5a70;font-size:8px;">NO SHIFTS LOGGED</td></tr>';
    return;
  }
  localScores.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + s.initials + '</td><td>'
      + s.score.toLocaleString() + '</td><td>' + (s.shipped != null ? s.shipped : '—') + '</td>';
    tbody.appendChild(tr);
  });
}

// ── Modals ───────────────────────────────────────────────────────────

function showModal(id) {
  document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}
function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function pauseForModal() {
  if (running && !paused && !finished) {
    paused = true;
    AdRPG.setGamePaused(true);
    music.pause();
    document.getElementById('btn-pause').textContent = 'RESUME';
  }
}
function resumeFromModal() {
  if (running && paused && !finished) {
    paused = false;
    AdRPG.setGamePaused(false);
    music.play().catch(() => {});
    document.getElementById('btn-pause').textContent = 'PAUSE';
    gameLoop.start();
  }
}

function wire(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  const clone = el.cloneNode(true);
  el.parentNode.replaceChild(clone, el);
  document.getElementById(id).addEventListener('click', fn);
}

function setupListeners() {
  wire('btn-start-title', () => dismissTitle());
  wire('btn-pause', () => togglePause());
  wire('btn-resume', () => togglePause());
  wire('btn-quit', () => toTitle());
  wire('btn-play-again', () => { hideModal('modal-gameover'); startShift(); });
  wire('btn-menu', () => toTitle());
  wire('btn-submit', async () => {
    const initials = document.getElementById('initials-input').value.trim() || 'AAA';
    addScoreToTable(initials, st.score, st.shipped);
    try {
      await scoreClient.save('makemecookies', initials, st.score,
                             { shipped: st.shipped, mess: Math.round(st.mess) });
    } catch (e) { console.error('Score save failed', e); }
    hideModal('modal-gameover');
    renderScores();
    showModal('modal-scores');
  });
  wire('btn-scores', () => { renderScores(); showModal('modal-scores'); pauseForModal(); });
  // After a shift there is nothing to resume, so closing a modal has to go
  // somewhere rather than nowhere.
  wire('btn-close-scores', () => {
    hideModal('modal-scores');
    if (finished) toTitle(); else resumeFromModal();
  });
  wire('btn-credits', () => { showModal('modal-credits'); pauseForModal(); });
  wire('btn-close-credits', () => {
    hideModal('modal-credits');
    if (finished) toTitle(); else resumeFromModal();
  });
}

// ── Title screen ─────────────────────────────────────────────────────

function showTitleScreen() {
  const to = document.getElementById('title-overlay');
  to.classList.remove('dismissing');
  to.style.display = '';
}

function dismissTitle() {
  const to = document.getElementById('title-overlay');
  if (!to || to.style.display === 'none') return;
  to.classList.add('dismissing');
  setTimeout(() => { to.style.display = 'none'; }, 500);
  startShift();
}

// ── Init ─────────────────────────────────────────────────────────────

(async () => {
  setupListeners();

  AdRPG.initInput({
    onPause: () => { if (running && !finished) togglePause(); },
    bindings: COOKIE_BINDINGS,
  });

  // Touch controls. pointerdown rather than click so the station fires on
  // the press instead of the release — at this tempo that gap is felt — and
  // preventDefault stops the browser synthesising a second click after it.
  for (const btn of document.querySelectorAll('.tp')) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!running || paused || finished) return;
      const now = performance.now();
      if (now < st.inspectUntil) return;
      PRESS[+btn.dataset.bay](st, tune(st), now);
    });
  }

  // The loop only renders once gameStarted, so the attract frame behind
  // the title card has to be painted by hand.
  render();
  updateHUD();

  document.addEventListener('keydown', (e) => {
    const to = document.getElementById('title-overlay');
    if (!to || to.style.display === 'none') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      dismissTitle();
    }
  });

  await loadScores();
})();
