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

     -- Phase 2: items --
     S.inventory()            what's equipped right now
     S.giveItem('weapon','epic')   force-roll and equip a test item
     S.rollLoot(200)          simulate 200 kills' worth of drop rolls,
                              report rarity/slot counts (no other
                              game state changes — pure drop-table check)

     -- Phase 3: runes --
     S.runes()                the whole tree: owned / affordable /
                              locked-and-why, one row per node
     S.buyRune('arcane_1')    attempt a real purchase (spends gold)
     S.giveGold(5000)         debug: hand her gold, for testing runes
                              without waiting on a real economy
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = root.Sylvaine;
  var Game = Sylvaine.Game;
  var Stats = Sylvaine.Stats;
  var Items = Sylvaine.Items;
  var Runes = Sylvaine.Runes;

  var state = Game.createState({ seed: 12345, echo: true });
  var renderer = Sylvaine.makeRenderer(state);

  // The loop's onFrame callback is this small wrapper, not
  // `renderer.update` directly, so that S.reset() (which
  // reassigns the outer `renderer` variable to a fresh instance)
  // is picked up immediately — the wrapper reads the CURRENT
  // value of `renderer` every time it's called, a direct
  // reference would have kept calling the old, now-stale one.
  var loop = Sylvaine.makeLoop(state, function () { renderer.update(); });

  console.log('%cSYLVAINE — Phase 4 (DOM UI)', 'font-weight:bold');
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
        'S.reset(seed)    -> start over with a seed',
        '',
        '-- Phase 2: items --',
        "S.inventory()             -> what's equipped now",
        "S.giveItem('weapon'|'armor', 'common'|'rare'|'epic')",
        '                          -> force-roll + equip a test item',
        'S.rollLoot(n)             -> simulate n drop rolls at the current',
        '                             stage, report rarity/slot counts',
        '',
        '-- Phase 3: runes --',
        'S.runes()                 -> the whole tree: status + why-not',
        "S.buyRune('arcane_1')     -> attempt a real purchase",
        'S.giveGold(n)             -> debug: hand her gold'
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
      var eq = state.hero.equipped;
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
        weapon:   eq.weapon ? eq.weapon.name : '(none)',
        armor:    eq.armor ? eq.armor.name : '(none)',
        kills:    state.totals.kills,
        bosses:   state.totals.bossKills,
        items:    state.totals.itemDrops + ' found / ' + state.totals.itemsEquipped +
                  ' equipped / ' + state.totals.epicsFound + ' epic',
        retreats: state.totals.retreats,
        runes:    state.hero.runes.length + '/' + Runes.NODES.length +
                  (state.hero.spellUnlocked ? ' (spell unlocked)' : ' (no spell yet)')
      });
      return state.totals;
    },

    inventory: function () {
      var eq = state.hero.equipped;
      ['weapon', 'armor'].forEach(function (slot) {
        var item = eq[slot];
        if (!item) {
          console.log(slot + ': (empty)');
        } else {
          console.log(slot + ': ' + item.name + ' [' + item.rarity + ']  ' +
            Items.describeMods(item.mods) +
            '  (power ' + Items.computePower(item).toFixed(1) + ')');
        }
      });
    },

    // Force-generates and equips a test item, bypassing the drop
    // roll entirely — for checking how an item LOOKS and feels
    // without waiting on the RNG to hand you one. Runs through the
    // exact same equip/sell path a real drop would (so it also
    // sells whatever it replaces), just skipping rollDrop's chance
    // and rarity rolls.
    giveItem: function (slot, rarity) {
      slot = slot === 'armor' ? 'armor' : 'weapon';
      rarity = ['common', 'rare', 'epic'].indexOf(rarity) === -1 ? 'common' : rarity;

      var item = Items.rollItem(state.stage, slot, rarity, state.rng);
      var hero = state.hero;
      var equipped = hero.equipped[slot];

      if (equipped) {
        var refund = Items.sellValueOf(equipped);
        hero.gold += refund;
        console.log('sold previous ' + slot + ' (' + equipped.name + ') for ' + refund + ' gold');
      }
      hero.equipped[slot] = item;
      Stats.markDirty(hero);

      console.log('equipped: ' + item.name + ' [' + item.rarity + ']  ' + Items.describeMods(item.mods));
      return item;
    },

    // Runs the drop table n times at the CURRENT stage without
    // touching hero/gold/equipment — pure statistics, so you can
    // sanity-check the drop chances match the spec (85/15 common/
    // rare on normal stages, 40/50/10 on boss stages, epic only
    // ever from a boss) by eye instead of trusting the code.
    rollLoot: function (n) {
      n = n || 200;
      var enemy = Sylvaine.Enemies.spawn(state.stage, state.rng);
      var counts = { none: 0, common: 0, rare: 0, epic: 0 };
      var slots = { weapon: 0, armor: 0 };
      for (var i = 0; i < n; i++) {
        var item = Items.rollDrop(state, enemy);
        if (!item) { counts.none++; continue; }
        counts[item.rarity]++;
        slots[item.slot]++;
      }
      console.log('rolled ' + n + ' drops at stage ' + state.stage +
        (enemy.isBoss ? ' (BOSS)' : ' (normal)') + ':');
      console.table(counts);
      console.table(slots);
      return counts;
    },

    // One row per node, with a plain-English reason it's locked
    // when it is — the same message canPurchase would give you,
    // so this is the "why can't I buy this" answer, not just a
    // yes/no.
    runes: function () {
      var hero = state.hero;
      var rows = {};
      Runes.NODES.forEach(function (node) {
        var status;
        if (Runes.isOwned(hero, node.id)) {
          status = 'OWNED';
        } else {
          var check = Runes.canPurchase(hero, node.id);
          status = check.ok ? 'affordable now' : 'locked: ' + check.reason;
        }
        rows[node.id] = {
          branch: node.branch,
          name: node.name,
          cost: node.cost,
          requires: node.requires.join(', ') || '(none)',
          status: status
        };
      });
      console.table(rows);
    },

    buyRune: function (id) {
      var result = Runes.purchase(state, id);
      console.log(result ? 'bought "' + id + '"' : 'purchase failed — see the log line above for why');
      return result;
    },

    giveGold: function (amount) {
      amount = amount || 1000;
      state.hero.gold += amount;
      console.log('gold: ' + Math.round(state.hero.gold));
    },

    reset: function (seed) {
      loop.stop();
      state = Game.createState({ seed: seed === undefined ? 12345 : seed, echo: true });
      renderer = Sylvaine.makeRenderer(state); // rebuilds the rune list against the new state
      loop = Sylvaine.makeLoop(state, function () { renderer.update(); });
      root.S.state = state;
      root.S.loop = loop;
      loop.start();
      console.log('reset with seed ' + seed);
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
