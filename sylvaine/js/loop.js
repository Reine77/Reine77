/* =============================================================
   loop.js — the only place that knows about real time.
   -------------------------------------------------------------
   requestAnimationFrame hands us a TIMESTAMP, not a duration.
   So the loop's whole job is: subtract the previous timestamp,
   convert milliseconds to seconds, clamp it, hand it to
   Game.step.

   WHY dt in seconds: every number in config.js is "per second"
   (attacks per second, seconds of cooldown). Mixing units is
   how you end up with a hero who attacks 1000x too fast.

   WHY CLAMP dt: if the player switches tabs, the browser stops
   calling requestAnimationFrame. Come back 10 minutes later and
   the next dt is ~600 seconds. Unclamped, step() would resolve
   ten minutes of combat inside one frame — blowing through
   dozens of stages, skipping the boss checks that should have
   stopped her, and running `while` loops hundreds of thousands
   of times. Clamping to 0.25s makes a backgrounded tab simply
   pause instead. Real offline progress is Phase 8's job, and it
   gets done deliberately from a saved timestamp rather than by
   letting the live loop swallow a giant dt.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  var MAX_DT = 0.25; // seconds

  function makeLoop(state, onFrame) {
    var lastTime = null;
    var rafId = null;
    var running = false;

    function frame(now) {
      if (!running) return;

      if (lastTime === null) lastTime = now;
      var dt = (now - lastTime) / 1000; // ms -> seconds
      lastTime = now;

      dt = Math.min(dt, MAX_DT);
      if (dt < 0) dt = 0; // paranoia: clocks can misbehave

      Sylvaine.Game.step(state, dt);
      if (onFrame) onFrame(state, dt);

      rafId = root.requestAnimationFrame(frame);
    }

    return {
      start: function () {
        if (running) return;
        running = true;
        lastTime = null; // forces dt = 0 on the resume frame
        rafId = root.requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        if (rafId !== null) root.cancelAnimationFrame(rafId);
        rafId = null;
      },
      isRunning: function () { return running; },
      MAX_DT: MAX_DT
    };
  }

  Sylvaine.makeLoop = makeLoop;
})(typeof globalThis !== 'undefined' ? globalThis : this);
