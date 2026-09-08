/* =============================================================
   game.js — all the rules, none of the rendering.
   -------------------------------------------------------------
   This file owns the entire simulation. It has exactly one
   entry point that moves time forward:

       Sylvaine.Game.step(state, dt)   // dt in SECONDS

   It never touches the DOM, never reads the clock, and never
   calls requestAnimationFrame. That separation is the whole
   reason Phase 1 is testable: the node simulator in
   tools/simulate.mjs feeds it a fixed dt and can play 10 hours
   of game in a second, and the browser feeds it real frame
   times. Same code, both times.

   THE STATE MACHINE
     spawning   -> short pause, then a new enemy appears
     fighting   -> timers tick, damage happens
     retreating -> she failed, brief pause, then falls back to
                   farming the last cleared normal stage

   TIMERS
     Two independent countdowns, ticked separately: the basic
     attack (interval = 1 / attackSpeed) and the spell (interval
     = spellCooldown). They are independent on purpose — the
     spell is not "every Nth swing", it is its own clock, which
     is what makes attackSpeed and spellCooldown feel like two
     different upgrade paths.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;
  var Stats  = Sylvaine.Stats;
  var Enemies = Sylvaine.Enemies;

  /* -----------------------------------------------------------
     createState — one object holding the whole game.
     Keeping everything in one plain object (no globals, no
     module-level mutable variables) is what will make Phase 8
     save/load almost trivial: saving is "write this object out".
     ----------------------------------------------------------- */
  function createState(options) {
    options = options || {};
    var seed = options.seed === undefined ? 12345 : options.seed;

    var state = {
      time: 0,              // seconds of simulated game time
      stage: 1,             // the stage she is currently fighting
      phase: 'spawning',
      phaseTimer: 0,
      fightTime: 0,

      // Progression bookkeeping for the retreat rule.
      highestNormalCleared: 0, // last NORMAL stage she beat
      blockedStage: null,      // boss stage she could not beat
      farming: false,          // true = looping a cleared stage

      hero: Stats.makeHero(),
      enemy: null,

      rng: Sylvaine.makeRng(seed),
      log: Sylvaine.makeLog({ echo: options.echo !== false }),

      // Pure statistics. Never read by game rules — only shown
      // to the player and useful when checking balance.
      totals: {
        kills: 0,
        bossKills: 0,
        retreats: 0,
        damageDealt: 0,
        damageTaken: 0,
        crits: 0,
        spellCasts: 0,
        goldEarned: 0,
        fightsFought: 0,

        // Filled in by items.js's onKill hook (Phase 2). Declared
        // here rather than lazily inside items.js so this object
        // has one single shape from the moment the game starts —
        // see stats.js's comment on why hero.base works the same way.
        itemDrops: 0,
        itemsEquipped: 0,
        itemsSold: 0,
        epicsFound: 0
      },

      // Event hooks. Later phases subscribe to these to draw
      // things (a hit flash, a floating damage number) without
      // this file ever knowing a screen exists.
      hooks: {}
    };

    // Fill in current HP from computed stats (level 1 = base).
    state.hero.hp = Stats.computeStats(state.hero).maxHp;
    return state;
  }

  /* ---- Tiny event system ---------------------------------- */
  function on(state, eventName, fn) {
    if (!state.hooks[eventName]) state.hooks[eventName] = [];
    state.hooks[eventName].push(fn);
  }

  function emit(state, eventName, payload) {
    var list = state.hooks[eventName];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](payload, state);
  }

  /* ===========================================================
     THE STEP FUNCTION
     =========================================================== */
  function step(state, dt) {
    state.time += dt;

    if (state.phase === 'spawning') {
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) beginFight(state);
      return;
    }

    if (state.phase === 'retreating') {
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        state.phase = 'spawning';
        state.phaseTimer = CONFIG.combat.spawnDelay;
      }
      return;
    }

    // ---- phase === 'fighting' ----
    tickHero(state, dt);
    if (state.phase !== 'fighting') return; // the enemy died mid-tick
    tickEnemy(state, dt);
    if (state.phase !== 'fighting') return; // the hero was forced to retreat

    // Stall safety net.
    state.fightTime += dt;
    if (state.fightTime > CONFIG.combat.stallTimeout) {
      state.log.push('warn', 'This fight is going nowhere. Falling back.', state.time);
      retreat(state, 'stalled');
    }
  }

  /* ---- Starting a fight ----------------------------------- */
  function beginFight(state) {
    var enemy = Enemies.spawn(state.stage, state.rng);
    state.enemy = enemy;
    state.phase = 'fighting';
    state.fightTime = 0;
    state.totals.fightsFought++;

    // Reset the hero's swing timers so a fight always opens with
    // a swing. Without this she can spawn an enemy with 0.9s left
    // on her attack timer, which reads as a bug to the player.
    state.hero.timers.attack = 0;
    // The spell keeps its cooldown across fights on purpose —
    // otherwise a free nuke every spawn would trivialise it.

    var label = enemy.isBoss ? 'BOSS' : 'Stage ' + state.stage;
    state.log.push(enemy.isBoss ? 'boss' : 'spawn',
      label + ': ' + enemy.name + ' (' + enemy.maxHp + ' HP, ' +
      enemy.damage + ' dmg @ ' + enemy.attackSpeed.toFixed(2) + '/s)', state.time);
    emit(state, 'spawn', enemy);

    // Bosses get a winnability check BEFORE the fight. Why not
    // just let her fight and die? Because an unwinnable boss
    // wastes 30 real seconds every attempt, and the retreat is a
    // designed difficulty gate, not a punishment. Normal stages
    // are cheap enough that we let them resolve for real.
    if (enemy.isBoss && !canWin(state, enemy)) {
      state.log.push('warn', 'She sizes up ' + enemy.name +
        ' and knows the maths. Not yet.', state.time);
      retreat(state, 'outmatched');
    }
  }

  /* ---- The winnability check ------------------------------
     Compare two times:
       ttk = time to kill  = enemy HP / her expected DPS
       ttd = time to die   = her HP  / enemy DPS
     If ttk is not comfortably below ttd, she cannot win.
     "Expected" DPS averages crits in rather than gambling on
     them, which is the honest way to predict a long fight.   */
  function heroDps(state) {
    var s = Stats.computeStats(state.hero);
    var avgHit = s.damage * (1 + s.critChance * (s.critMult - 1));
    var dps = avgHit * s.attackSpeed;
    if (state.hero.spellUnlocked) {
      dps += (s.spellPower * CONFIG.combat.spellDamageMult) / s.spellCooldown;
    }
    return dps;
  }

  function canWin(state, enemy) {
    var dps = heroDps(state);
    if (dps <= 0) return false;

    var ttk = enemy.hp / dps;
    var enemyDps = enemy.damage * enemy.attackSpeed;
    var ttd = enemyDps > 0 ? state.hero.hp / enemyDps : Infinity;

    return ttk <= ttd * CONFIG.combat.bossMargin;
  }

  /* ---- Hero's turn ---------------------------------------- */
  function tickHero(state, dt) {
    var hero = state.hero;
    var s = Stats.computeStats(hero);

    // Basic attack. `while` rather than `if` so that a very high
    // attackSpeed (or an unusually long dt) still resolves every
    // swing that should have happened, instead of silently
    // dropping the extras. That is what makes the game play the
    // same at 60Hz and 144Hz.
    hero.timers.attack -= dt;
    while (hero.timers.attack <= 0) {
      hero.timers.attack += s.attackInterval;
      basicAttack(state);
      if (state.phase !== 'fighting') return;
    }

    // Spell — a completely separate clock.
    if (hero.spellUnlocked) {
      hero.timers.spell -= dt;
      while (hero.timers.spell <= 0) {
        hero.timers.spell += s.spellCooldown;
        castSpell(state);
        if (state.phase !== 'fighting') return;
      }
    }
  }

  function basicAttack(state) {
    var s = Stats.computeStats(state.hero);
    var crit = state.rng.chance(s.critChance);
    var damage = s.damage * (crit ? s.critMult : 1);
    if (crit) state.totals.crits++;

    emit(state, 'heroAttack', { crit: crit, damage: damage });
    damageEnemy(state, damage, crit ? 'crit' : 'hit');
  }

  function castSpell(state) {
    var s = Stats.computeStats(state.hero);
    var damage = s.spellPower * CONFIG.combat.spellDamageMult;
    state.totals.spellCasts++;

    emit(state, 'heroSpell', { damage: damage });
    damageEnemy(state, damage, 'spell');
  }

  function damageEnemy(state, damage, kind) {
    var enemy = state.enemy;
    damage = Math.round(damage * 10) / 10;
    enemy.hp -= damage;
    state.totals.damageDealt += damage;

    if (CONFIG.debug.logEverySwing) {
      state.log.push(kind, (kind === 'crit' ? 'CRIT! ' : kind === 'spell' ? 'Spell ' : '') +
        damage + ' -> ' + enemy.name + ' (' + Math.max(0, Math.round(enemy.hp)) +
        '/' + enemy.maxHp + ')', state.time);
    }
    emit(state, 'enemyDamaged', { damage: damage, kind: kind, enemy: enemy });

    if (enemy.hp <= 0) killEnemy(state);
  }

  /* ---- Enemy's turn --------------------------------------- */
  function tickEnemy(state, dt) {
    var enemy = state.enemy;
    enemy.timer -= dt;
    while (enemy.timer <= 0) {
      enemy.timer += enemy.attackInterval;
      enemyAttack(state);
      if (state.phase !== 'fighting') return;
    }
  }

  function enemyAttack(state) {
    var hero = state.hero;
    var damage = state.enemy.damage;
    hero.hp -= damage;
    state.totals.damageTaken += damage;

    emit(state, 'heroDamaged', { damage: damage, enemy: state.enemy });
    if (CONFIG.debug.logEverySwing) {
      state.log.push('taken', state.enemy.name + ' hits for ' + damage +
        ' (Sylvaine ' + Math.max(0, Math.round(hero.hp)) + ' HP)', state.time);
    }

    if (hero.hp <= 0) {
      hero.hp = 0;
      state.log.push('down', 'Sylvaine is overwhelmed by ' + state.enemy.name + '.', state.time);
      retreat(state, 'defeated');
    }
  }

  /* ---- Winning -------------------------------------------- */
  function killEnemy(state) {
    var enemy = state.enemy;
    var hero = state.hero;
    var s = Stats.computeStats(hero);

    state.totals.kills++;
    if (enemy.isBoss) state.totals.bossKills++;

    hero.gold += enemy.goldReward;
    state.totals.goldEarned += enemy.goldReward;
    gainXp(state, enemy.xpReward);

    // Partial heal. Below 100% this is the attrition that makes
    // long stage runs risky rather than free.
    var heal = s.maxHp * CONFIG.combat.healOnKill;
    hero.hp = Math.min(s.maxHp, hero.hp + heal);

    state.log.push(enemy.isBoss ? 'bosskill' : 'kill',
      (enemy.isBoss ? '*** ' : '') + enemy.name + ' falls. ' +
      '+' + enemy.xpReward + ' XP, +' + enemy.goldReward + ' gold. ' +
      '(HP ' + Math.round(hero.hp) + '/' + Math.round(s.maxHp) + ')', state.time);

    emit(state, 'enemyKilled', enemy);

    // Phase 2 will hang the drop roll off this same point.
    if (Sylvaine.Items && typeof Sylvaine.Items.onKill === 'function') {
      Sylvaine.Items.onKill(state, enemy);
    }

    advance(state, enemy);
    state.enemy = null;
    state.phase = 'spawning';
    state.phaseTimer = CONFIG.combat.spawnDelay;
  }

  function advance(state, enemy) {
    if (state.farming) {
      // She is farming a cleared stage. Killing it again does not
      // advance her — but it does earn XP and gold, which is the
      // point. Each kill, re-test the boss that stopped her.
      if (state.blockedStage !== null && bossNowWinnable(state)) {
        state.log.push('advance', 'Stronger now. Back to stage ' +
          state.blockedStage + '.', state.time);
        state.farming = false;
        state.stage = state.blockedStage;
        state.blockedStage = null;
      }
      return;
    }

    if (!enemy.isBoss) state.highestNormalCleared = state.stage;
    state.stage += 1;
  }

  // Simulate the blocked boss's numbers without spawning it, so
  // we can ask "could she win now?" while she farms.
  function bossNowWinnable(state) {
    var probe = Enemies.spawn(state.blockedStage, state.rng);
    return canWin(state, probe);
  }

  function gainXp(state, amount) {
    var hero = state.hero;
    hero.xp += amount;

    // `while`, not `if`: one big boss can grant several levels.
    while (hero.xp >= hero.xpToNext) {
      hero.xp -= hero.xpToNext;
      hero.level += 1;
      hero.xpToNext = Stats.xpForLevel(hero.level);

      // Level changed a stat input, so the cache must be thrown
      // away. Forgetting this line is THE classic dirty-flag bug:
      // the player levels up and nothing gets stronger.
      Stats.markDirty(hero);

      var s = Stats.computeStats(hero);
      // Growing maxHp should not leave her at the old HP value.
      hero.hp = Math.min(s.maxHp, hero.hp + CONFIG.perLevel.hp);

      state.log.push('level', 'LEVEL UP -> ' + hero.level +
        '  (dmg ' + s.damage.toFixed(1) + ', as ' + s.attackSpeed.toFixed(2) +
        ', hp ' + Math.round(s.maxHp) + ')', state.time);
      emit(state, 'levelUp', hero.level);
    }
  }

  /* ---- Losing (which is not dying) ------------------------
     There is no game over and no permadeath. Failure means she
     falls back to the last NORMAL stage she cleared and grinds
     it until she is strong enough. That is the difficulty gate:
     it converts "stuck" into "farm for a bit, then buy runes".  */
  function retreat(state, reason) {
    var hero = state.hero;
    var s = Stats.computeStats(hero);
    var wasBossStage = state.enemy && state.enemy.isBoss;

    state.totals.retreats++;

    // Remember what to come back for. If a normal stage beat her,
    // the thing to retry is that normal stage.
    state.blockedStage = state.stage;
    state.farming = true;

    var fallback = Math.max(1, state.highestNormalCleared);
    // Don't fall back onto the stage that just killed her.
    if (!wasBossStage && fallback >= state.stage) fallback = Math.max(1, state.stage - 1);

    state.stage = fallback;
    hero.hp = s.maxHp; // she licks her wounds; retreat is not a wipe
    state.enemy = null;
    state.phase = 'retreating';
    state.phaseTimer = CONFIG.combat.retreatPause;

    state.log.push('retreat', 'Retreat (' + reason + '). Farming stage ' +
      fallback + ' until stage ' + state.blockedStage + ' is possible.', state.time);
    emit(state, 'retreat', { reason: reason, fallback: fallback, blocked: state.blockedStage });
  }

  Sylvaine.Game = {
    createState: createState,
    step: step,
    on: on,
    emit: emit,
    // exported for inspection / later phases / tests
    heroDps: heroDps,
    canWin: canWin,
    gainXp: gainXp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
