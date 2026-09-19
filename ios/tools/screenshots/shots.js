/* Staging for App Store screenshots. Injected into a built App.app's
   public/index.html on the Mac by capture.sh; never committed into the
   bundle, never in what ships.

   It only drives the real UI: it presses the real buttons, puts real values
   into the real shift object and calls the game's own render. What is
   captured is the app, arranged rather than faked.

   ## The shots, and why each one

   1  title    the card, the wordmark and CLOCK IN
   2  line     mid-shift with everything happening at once, inside a RUSH
   3  fire     the oven alight and the mess meter climbing
   4  stars    the end-of-shift card at three stars
   5  bests    the best-shifts table with a history behind it

   The second is the one that has to sell the game, so it is staged with the
   line genuinely full: dough on the belt, a tray going golden, three cookies
   in the box and the RUSH banner up.

   ## Two traps this file is shaped around

   `st` is a top-level `let` in a classic script, so it is a global LEXICAL
   binding and NOT a property of window. `window.st` is undefined; the bare
   name works. george-boole's equivalent lost five screenshots to exactly this
   with `window.currentGame`, and both files now say so.

   The frame is drawn by a loop. Staging values and waiting means the loop
   advances them before the shutter: dough moves, the tray burns, the RUSH
   window closes. So each shot stops the loop and calls `render()` once, which
   freezes the exact frame that was arranged. The loop is restarted only when
   a later shot needs the game running again.
*/
(function () {
  var W = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var $ = function (id) { return document.getElementById(id); };

  /* A history for the best-shifts table. The app's ScoreClient is never
     connected, so it falls back to localStorage under this key; `localScores`
     is read from there at load, and is assigned here as well so the table is
     right whether or not this runs before that load finishes. */
  function seedBests() {
    var rows = [
      { initials: 'JAM', score: 6120, shipped: 26 },
      { initials: 'MC1', score: 5240, shipped: 24 },
      { initials: 'JIM', score: 4880, shipped: 21 },
      { initials: 'BOO', score: 3960, shipped: 18 },
      { initials: 'AAA', score: 2510, shipped: 12 }
    ];
    try {
      localStorage.setItem('adenosine_scores_makemecookies', JSON.stringify(rows));
    } catch (e) {}
    try { localScores = rows; } catch (e) {}
  }

  /* One arranged frame: put the values in, stop the loop, draw once. */
  function freeze(fn) {
    if (typeof st === 'undefined') return;
    fn(st);
    updateHUD();
    gameLoop.stop();
    render();
  }

  async function run() {
    seedBests();

    /* 1 - the title card, as it lands. */
    await W(9000);

    /* 2 - the line, mid-shift and inside a RUSH window.
       Every station is doing something and none of it is trouble yet: this is
       the frame that has to say what the game is. */
    $('btn-start-title').click();
    await W(1500);
    freeze(function (s) {
      s.elapsed = 0.38 * s.shiftMs;
      s.rush = 1;
      s.score = 2640;
      s.shipped = 14;
      s.mess = 18;
      s.hopper.units = 4;
      s.mixer.phase = 'mixing';
      s.mixer.t = 700;
      s.belt.items = [
        { quality: 'good', x: BELT_X1 - 30, sticky: false },
        { quality: 'good', x: BELT_X1 - 150, sticky: false },
        { quality: 'good', x: BELT_X1 - 270, sticky: false }
      ];
      s.oven.phase = 'golden';
      s.oven.t = 150;
      s.oven.quality = 'good';
      s.pack.tray = ['perfect', 'perfect', 'seconds'];
    });
    await W(9000);

    /* 3 - the oven alight. The one moment in the game that demands both
       hands, and the only screenshot with anything at stake in it. */
    freeze(function (s) {
      s.elapsed = 0.61 * s.shiftMs;
      s.rush = -1;
      s.score = 3980;
      s.shipped = 19;
      s.mess = 74;
      s.oven.phase = 'fire';
      s.oven.t = 400;
      s.mixer.phase = 'ready';
      s.mixer.t = 200;
      s.belt.items = [{ quality: 'good', x: BELT_X1 - 90, sticky: true }];
      s.pack.tray = ['perfect'];
      s.fx.spills = [{ x: BAYS[S.HOPPER].x + 60, y: FLOOR_Y, t: 200 }];
      s.fx.toast = { text: 'FIRE!', color: C.danger, t: 0 };
    });
    await W(9000);

    /* 4 - the end of the shift, at three stars. endShift() is the real one,
       so the card is filled in by the game rather than by this file. */
    freeze(function (s) {
      s.score = 5240;
      s.shipped = 24;
      s.mess = 6;
      s.oven.phase = 'empty';
      s.pack.tray = [];
      s.tally.perfect = 21;
      s.tally.seconds = 3;
      s.tally.boxes = 7;
      s.elapsed = s.shiftMs;
    });
    endShift();
    await W(9000);

    /* 5 - the board, with a history behind it. */
    hideModal('modal-gameover');
    renderScores();
    showModal('modal-scores');
    await W(9000);
  }

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
