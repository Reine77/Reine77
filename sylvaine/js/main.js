/* =============================================================
   main.js — Phase 1 entry point. Console only, no UI.
   -------------------------------------------------------------
   This wires the pieces together and exposes a small debug API
   on `window.S` so you can poke at the running game from
   devtools. Later phases add rendering here; the rules never
   move into this file.

   Try in the console:
     S.state                 the whole game object
     S.stats()               her current final stats
     S.dps()                 expected damage per second
     S.pause() / S.resume()
     S.fast(60)              simulate 60 seconds instantly
     S.unlockSpell()         Phase 3 does this properly; this is
                             just so you can watch the second
                             timer work in Phase 1
     S.verbose(true)         log every single swing
     S.report()              summary table of totals
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = root.Sylvaine;
  var Game = Sylvaine.Game;
  var Stats = Sylvaine.Stats;

  var state = Game.createState({ seed: 12345, echo: true });
  var loop = Sylvaine.makeLoop(state);

  console.log('%cSYLVAINE — Phase 1 (logic only, no UI)', 'font-weight:bold');
  console.log('Type S.help() for the debug commands.');
  state.log.push('story', 'The climb starts here.', 0);

  loop.start();

  root.S = {
    state: state,
    loop: loop,

    help: function () {
      console.log([
        'S.state          -> the entire game state object',
        'S.stats()        -> computed final stats',
        'S.dps()          -> expected DPS (crits averaged in)',
        'S.pause()        -> stop the loop',
        'S.resume()       -> restart the loop',
        'S.fast(seconds)  -> simulate instantly (default 60)',
        'S.unlockSpell()  -> debug: turn the spell on',
        'S.verbose(bool)  -> log every swing',
        'S.report()       -> totals summary',
        'S.reset(seed)    -> start over with a seed'
      ].join('\n'));
    },

    stats: function () { return Stats.computeStats(state.hero); },
    dps: function () { return Math.round(Game.heroDps(state) * 10) / 10; },

    pause: function () { loop.stop(); console.log('paused'); },
    resume: function () { loop.start(); console.log('running'); },

    // Fixed-step fast-forward. Uses the same 1/60 slice the
    // browser would, so results match a real playthrough.
    fast: function (seconds) {
      seconds = seconds || 60;
      var slice = 1 / 60;
      var steps = Math.floor(seconds / slice);
      for (var i = 0; i < steps; i++) Game.step(state, slice);
      console.log('simulated ' + seconds + 's -> stage ' + state.stage +
        ', level ' + state.hero.level + ', gold ' + Math.round(state.hero.gold));
    },

    unlockSpell: function () {
      state.hero.spellUnlocked = true;
      state.hero.timers.spell = Stats.computeStats(state.hero).spellCooldown;
      console.log('spell unlocked (debug) — spellPower is ' +
        Stats.computeStats(state.hero).spellPower);
    },

    verbose: function (v) {
      Sylvaine.CONFIG.debug.logEverySwing = v !== false;
      console.log('logEverySwing = ' + Sylvaine.CONFIG.debug.logEverySwing);
    },

    report: function () {
      var s = Stats.computeStats(state.hero);
      console.table({
        time:     Math.round(state.time) + 's',
        stage:    state.stage + (state.farming ? ' (farming, blocked at ' + state.blockedStage + ')' : ''),
        level:    state.hero.level,
        gold:     Math.round(state.hero.gold),
        hp:       Math.round(state.hero.hp) + '/' + Math.round(s.maxHp),
        damage:   s.damage.toFixed(1),
        atkSpeed: s.attackSpeed.toFixed(2),
        crit:     (s.critChance * 100).toFixed(1) + '%',
        dps:      Math.round(Game.heroDps(state)),
        kills:    state.totals.kills,
        bosses:   state.totals.bossKills,
        retreats: state.totals.retreats
      });
      return state.totals;
    },

    reset: function (seed) {
      loop.stop();
      state = Game.createState({ seed: seed === undefined ? 12345 : seed, echo: true });
      loop = Sylvaine.makeLoop(state);
      root.S.state = state;
      root.S.loop = loop;
      loop.start();
      console.log('reset with seed ' + seed);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
