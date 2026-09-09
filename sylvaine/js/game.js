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
      farming: false,          // true = looping a cleared stage AUTOMATICALLY
                               // (she was blocked), not by player choice

      // Player-chosen hunting ground. null = climb normally.
      // A number = stay on that stage forever, killing it over and
      // over, until the player releases it. This is deliberately a
      // SEPARATE field from `farming` above: one is the game
      // deciding she can't proceed, the other is the player
      // deciding they want something farmable that only appears in
      // a particular stage band. They behave differently (the
      // automatic one keeps re-testing the boss that blocked her;
      // the manual one never does) and can't be collapsed into one
      // flag without losing that distinction.
      farmTarget: null,

      // A ONE-OFF re-fight of an already-beaten boss, bought with a
      // token. Distinct from farmTarget: that one loops forever,
      // this one runs a single fight and then puts her back exactly
      // where she was (`returnStage`/`returnFarmTarget`).
      bossChallenge: null,

      // stage number -> true, for every boss stage she has beaten.
      // Tracked explicitly rather than derived from the frontier:
      // the derivation ("every multiple of 10 below your frontier")
      // happens to be true today but is a subtle invariant to rely
      // on, and this is what the challenge list reads.
      clearedBossStages: {},

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
        weakHits: 0,      // hits that landed on an elemental weakness
        resistedHits: 0,  // hits blunted by a resistance
        goldEarned: 0,
        fightsFought: 0,

        // Filled in by items.js's onKill hook (Phase 2). Declared
        // here rather than lazily inside items.js so this object
        // has one single shape from the moment the game starts —
        // see stats.js's comment on why hero.base works the same way.
        itemDrops: 0,
        itemsEquipped: 0,
        itemsSold: 0,
        epicsFound: 0,     // epics that DROPPED
        epicsEquipped: 0,  // of those, how many were actually an upgrade

        // baseTypes key -> how many of that creature she has killed,
        // ever, across the whole run. Grows keys as new creatures
        // are first met rather than being pre-filled, since the
        // roster is data and this file shouldn't have to know it.
        //
        // This is the hook the companion/pet phases read: "100 dire
        // wolves killed" is `killsByType.direWolf >= 100`. Tracking
        // it from now on means those phases don't start from zero
        // history on an existing save.
        killsByType: {},

        // Boss id -> times defeated ('maw': 3). Keyed on identity,
        // not stage, because Maw appears at 20/60/100/... and a
        // future "defeat Maw 10 times" unlock means the creature,
        // not one particular stage.
        bossKillsById: {},

        tokensFound: 0,
        tokensSpent: 0
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
  // `against` is optional. Passing an enemy folds the elemental
  // matchup in, which MATTERS for canWin: a boss that resists
  // physical takes 30% less from her sword, and a winnability check
  // that ignored that would march her into fights she cannot win
  // and quietly break the retreat gate. Note the multipliers are
  // applied PER SOURCE, not to the total — her sword and her spell
  // have different attributes and can be matched up differently
  // against the same enemy.
  function heroDps(state, against) {
    var s = Stats.computeStats(state.hero);
    var A = CONFIG.attributes;

    var avgHit = s.damage * (1 + s.critChance * (s.critMult - 1));
    var dps = avgHit * s.attackSpeed *
      (against ? attributeMultiplier(against, A.basicAttack) : 1);

    if (state.hero.spellUnlocked) {
      dps += ((s.spellPower * CONFIG.combat.spellDamageMult) / s.spellCooldown) *
        (against ? attributeMultiplier(against, A.spell) : 1);
    }
    return dps;
  }

  function canWin(state, enemy) {
    var dps = heroDps(state, enemy);
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
    damageEnemy(state, damage, crit ? 'crit' : 'hit', CONFIG.attributes.basicAttack);
  }

  function castSpell(state) {
    var s = Stats.computeStats(state.hero);
    var damage = s.spellPower * CONFIG.combat.spellDamageMult;
    state.totals.spellCasts++;

    emit(state, 'heroSpell', { damage: damage });
    damageEnemy(state, damage, 'spell', CONFIG.attributes.spell);
  }

  /* ---- Elemental matchup -------------------------------------
     Returns the multiplier a given attribute gets against a given
     enemy. Exactly one branch can apply — an attack has one
     attribute, so it is weak OR resisted OR neither, never a stack
     of several. That keeps the worst case bounded, which matters
     in a game where the player cannot swap loadouts mid-fight.

     `weakTo` wins ties, on the principle that a stated weakness is
     a more specific statement than a stated resistance (and a
     roster entry listing both for the same attribute is a data
     bug worth surfacing as generous rather than punishing).     */
  function attributeMultiplier(enemy, attribute) {
    var A = CONFIG.attributes;
    if (!attribute || !enemy) return A.neutralMult;
    if (enemy.weakTo && enemy.weakTo.indexOf(attribute) !== -1) return A.weakMult;
    if (enemy.resists && enemy.resists.indexOf(attribute) !== -1) return A.resistMult;
    return A.neutralMult;
  }

  function damageEnemy(state, damage, kind, attribute) {
    var enemy = state.enemy;
    attribute = attribute || CONFIG.attributes.basicAttack;

    var mult = attributeMultiplier(enemy, attribute);
    damage = Math.round(damage * mult * 10) / 10;

    enemy.hp -= damage;
    state.totals.damageDealt += damage;
    if (mult > 1) state.totals.weakHits++;
    else if (mult < 1) state.totals.resistedHits++;

    if (CONFIG.debug.logEverySwing) {
      var tag = mult > 1 ? ' WEAK!' : (mult < 1 ? ' (resisted)' : '');
      state.log.push(kind, (kind === 'crit' ? 'CRIT! ' : kind === 'spell' ? 'Spell ' : '') +
        damage + ' ' + attribute + tag + ' -> ' + enemy.name +
        ' (' + Math.max(0, Math.round(enemy.hp)) + '/' + enemy.maxHp + ')', state.time);
    }
    emit(state, 'enemyDamaged', {
      damage: damage, kind: kind, enemy: enemy, attribute: attribute, mult: mult
    });

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
    if (enemy.isBoss) {
      state.totals.bossKills++;
      state.clearedBossStages[enemy.stage] = true;
      if (enemy.bossId) {
        var byBoss = state.totals.bossKillsById;
        byBoss[enemy.bossId] = (byBoss[enemy.bossId] || 0) + 1;
      }
    }
    if (enemy.baseType) {
      var byType = state.totals.killsByType;
      byType[enemy.baseType] = (byType[enemy.baseType] || 0) + 1;
    }

    // BOTH progression currencies fall off on outleveled content.
    //
    // The first draft of this only braked XP, on the reasoning that
    // gold is self-limiting because per-kill gold follows the same
    // exponential stage curve. Measuring it proved that wrong: kill
    // RATE rises as content trivialises (capped only by spawnDelay,
    // ~30 kills/min), and that more than cancels the smaller reward.
    // 40 minutes parked on stage 5 out-earned 25 minutes of real
    // climbing by 4x — enough to buy the entire rune tree without
    // ever fighting anything dangerous.
    //
    // Item drops deliberately have NO such rule: item power is rolled
    // from the stage's own budget curve, so a stage-5 drop is junk to
    // a stage-50 hero on its own, with nothing to enforce. That's the
    // difference — drops self-limit, currencies don't.
    var relevance = xpRelevance(state, enemy.stage);

    var goldGain = Math.floor(enemy.goldReward * relevance);
    hero.gold += goldGain;
    state.totals.goldEarned += goldGain;

    var xpGain = Math.floor(enemy.xpReward * relevance);
    gainXp(state, xpGain);

    // Partial heal. Below 100% this is the attrition that makes
    // long stage runs risky rather than free.
    var heal = s.maxHp * CONFIG.combat.healOnKill;
    hero.hp = Math.min(s.maxHp, hero.hp + heal);

    var rewardNote = relevance >= 1
      ? '+' + xpGain + ' XP, +' + goldGain + ' gold'
      : '+' + xpGain + ' XP, +' + goldGain + ' gold (' +
        Math.round(relevance * 100) + '% — outleveled)';

    state.log.push(enemy.isBoss ? 'bosskill' : 'kill',
      (enemy.isBoss ? '*** ' : '') + enemy.name + ' falls. ' +
      rewardNote + '. ' +
      '(HP ' + Math.round(hero.hp) + '/' + Math.round(s.maxHp) + ')', state.time);

    emit(state, 'enemyKilled', enemy);

    // Boss token. Rolled on every kill; bosses are far more
    // generous, so the challenge loop partly refills itself.
    var tokenChance = enemy.isBoss
      ? CONFIG.bossTokens.dropChance.bossKill
      : CONFIG.bossTokens.dropChance.normalKill;
    if (state.rng.chance(tokenChance)) {
      hero.bossTokens++;
      state.totals.tokensFound++;
      state.log.push('token', 'A boss token drops. (' + hero.bossTokens + ' held)', state.time);
      emit(state, 'tokenFound', hero.bossTokens);
    }

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
    // A boss challenge outranks everything: it is a single fight,
    // so finishing it puts her back exactly where she was rather
    // than advancing her or leaving her parked on a boss stage.
    if (state.bossChallenge !== null) {
      endBossChallenge(state, 'cleared');
      return;
    }

    // A player-chosen hunting ground outranks everything else: she
    // stays on this stage, does not climb, and does NOT re-test a
    // boss that previously blocked her. Re-testing would yank her
    // out of the stage band the player deliberately parked her in,
    // which is the one thing this feature exists to prevent.
    if (state.farmTarget !== null) return;

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

  /* ---- How much XP is this kill actually worth? --------------
     1.0 at (or above) her frontier — the highest normal stage she
     has cleared — falling linearly to exactly 0 once the stage is
     `relevanceWindow` stages behind it.

     Note this keys off the STAGE, not off her level. Stage is the
     thing the player picks and the thing content is gated on, so
     "have I outgrown this content" is the honest question. Keying
     off level would drift out of sync the moment gear or runes let
     her punch above her level.

     The automatic retreat-farm loop is deliberately unaffected:
     when a boss blocks her at stage 20, her frontier is 19 and she
     farms 19 — same stage, so full XP, so she can still level her
     way through the wall. That loop breaking would break the whole
     difficulty gate.                                              */
  function xpRelevance(state, stage) {
    var window = CONFIG.xp.relevanceWindow;
    var frontier = Math.max(1, state.highestNormalCleared);
    if (stage >= frontier) return 1;
    var mult = (stage - (frontier - window)) / window;
    return Math.max(0, Math.min(1, mult));
  }

  /* ---- Choosing a hunting ground -----------------------------
     Validation lives here, next to the rules it protects, and
     returns a reason string rather than just false — the UI shows
     that reason directly, the same way runes.js's canPurchase
     explains itself instead of silently refusing.               */
  function canFarmStage(state, stage) {
    if (typeof stage !== 'number' || !isFinite(stage) || Math.floor(stage) !== stage) {
      return { ok: false, reason: 'pick a whole stage number' };
    }
    if (stage < 1) return { ok: false, reason: 'stages start at 1' };
    if (Enemies.isBossStage(stage)) {
      return { ok: false, reason: 'stage ' + stage + ' is a boss stage — bosses are ' +
        'one-off fights, not farmable' };
    }
    if (stage > state.highestNormalCleared) {
      return { ok: false, reason: 'you have only cleared up to stage ' +
        state.highestNormalCleared };
    }
    return { ok: true, reason: null };
  }

  function setFarmTarget(state, stage) {
    var check = canFarmStage(state, stage);
    if (!check.ok) {
      state.log.push('warn', 'Cannot farm stage ' + stage + ': ' + check.reason, state.time);
      return false;
    }

    state.farmTarget = stage;
    state.stage = stage;

    // Abandon whatever fight is in progress and re-spawn at the new
    // stage, so the change is visible immediately instead of only
    // taking effect after the current enemy happens to die.
    state.enemy = null;
    state.phase = 'spawning';
    state.phaseTimer = CONFIG.combat.spawnDelay;

    var relevance = xpRelevance(state, stage);
    state.log.push('farm', 'Hunting ground set: stage ' + stage + '. ' +
      (relevance > 0
        ? 'XP from here is worth ' + Math.round(relevance * 100) + '% of normal.'
        : 'This stage is too far behind you to give any XP — gold, drops and ' +
          'kill counts only.'), state.time);
    emit(state, 'farmTargetChanged', stage);
    return true;
  }

  function clearFarmTarget(state) {
    if (state.farmTarget === null) return false;
    state.farmTarget = null;

    // Where does she go now? Back to whatever she was doing before
    // the player parked her: still blocked -> resume the automatic
    // farm loop at her frontier; otherwise resume climbing from it.
    state.stage = (state.farming && state.blockedStage !== null)
      ? Math.max(1, state.highestNormalCleared)
      : state.highestNormalCleared + 1;

    state.enemy = null;
    state.phase = 'spawning';
    state.phaseTimer = CONFIG.combat.spawnDelay;

    state.log.push('farm', 'Hunting ground released. Climbing again from stage ' +
      state.stage + '.', state.time);
    emit(state, 'farmTargetChanged', null);
    return true;
  }

  /* ---- Boss challenges (spend a token, re-fight a boss) ------
     Validation returns a reason string, same contract as
     canFarmStage and runes' canPurchase, so the UI can explain
     itself instead of just refusing.

     Note what is NOT checked here: nothing stops her challenging a
     low boss for weak loot. It does not need blocking, because
     item power rolls from the stage it dropped at and the XP/gold
     relevance falloff already zeroes the currencies — a stage-10
     token fight is simply its own punishment. The only rule worth
     enforcing is that she can actually win, so a rare token is
     never burned on a fight the numbers say she loses.          */
  function canChallengeBoss(state, stage) {
    if (typeof stage !== 'number' || !isFinite(stage) || Math.floor(stage) !== stage) {
      return { ok: false, reason: 'pick a boss stage' };
    }
    if (!Enemies.isBossStage(stage)) {
      return { ok: false, reason: 'stage ' + stage + ' is not a boss stage' };
    }
    if (!state.clearedBossStages[stage]) {
      return { ok: false, reason: 'you have not beaten the stage ' + stage + ' boss yet' };
    }
    if (state.hero.bossTokens < 1) {
      return { ok: false, reason: 'no boss tokens' };
    }
    if (state.bossChallenge !== null) {
      return { ok: false, reason: 'already in a boss challenge' };
    }
    // Probe with a THROWAWAY rng, never state.rng. This function is
    // called from the render loop every frame to decide whether the
    // button is enabled; if it consumed the game's rng it would
    // advance the seeded stream 60 times a second and make every
    // run non-reproducible. Boss spawns happen not to draw from rng
    // today, but relying on that would be an invisible tripwire for
    // whoever edits enemies.js next.
    var probe = Enemies.spawn(stage, Sylvaine.makeRng(stage));
    if (!canWin(state, probe)) {
      return { ok: false, reason: 'too strong right now — the token would be wasted' };
    }
    return { ok: true, reason: null };
  }

  function startBossChallenge(state, stage) {
    var check = canChallengeBoss(state, stage);
    if (!check.ok) {
      state.log.push('warn', 'Cannot challenge stage ' + stage + ': ' + check.reason, state.time);
      return false;
    }

    state.hero.bossTokens--;
    state.totals.tokensSpent++;

    // Remember exactly what she was doing so the one-off fight
    // doesn't quietly cancel a hunting ground or lose her place.
    state.bossChallenge = {
      stage: stage,
      returnStage: state.stage,
      returnFarmTarget: state.farmTarget
    };
    state.farmTarget = null;   // suspended, restored on the way out
    state.stage = stage;
    state.enemy = null;
    state.phase = 'spawning';
    state.phaseTimer = CONFIG.combat.spawnDelay;

    var boss = Enemies.bossAtStage(stage);
    state.log.push('boss', 'Token spent — challenging ' + (boss ? boss.name : 'stage ' + stage) +
      '. (' + state.hero.bossTokens + ' tokens left)', state.time);
    emit(state, 'bossChallengeStarted', state.bossChallenge);
    return true;
  }

  // Called when the challenge boss dies, and also when she is forced
  // out of one. `outcome` is 'cleared' or 'failed'.
  function endBossChallenge(state, outcome) {
    var ch = state.bossChallenge;
    if (!ch) return;
    state.bossChallenge = null;
    state.farmTarget = ch.returnFarmTarget;
    state.stage = ch.returnStage;

    if (outcome === 'failed') {
      // She was driven off, so give the token back. Losing a rare
      // resource to a fight the winnability check said she'd win is
      // the game's mistake, not the player's.
      state.hero.bossTokens++;
      state.totals.tokensSpent--;
      state.log.push('warn', 'Driven off — the boss token is returned.', state.time);
    }
    emit(state, 'bossChallengeEnded', outcome);
  }

  function gainXp(state, amount) {
    var hero = state.hero;
    if (amount <= 0) return;                       // outleveled content grants nothing
    if (hero.level >= CONFIG.levelCap) return;     // arc complete; stages go on forever
    hero.xp += amount;

    // `while`, not `if`: one big boss can grant several levels.
    while (hero.xp >= hero.xpToNext && hero.level < CONFIG.levelCap) {
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

    // A failed boss challenge refunds its token and restores where
    // she was, before the normal retreat bookkeeping runs.
    if (state.bossChallenge !== null) {
      endBossChallenge(state, 'failed');
    }

    // If the player had parked her on a hunting ground and it turned
    // out to be lethal, release the lock. Keeping it would put her
    // straight back on the stage that just killed her, forever, with
    // no progress and no explanation — an invisible infinite loop is
    // far worse than overriding the player's choice and saying so.
    if (state.farmTarget !== null) {
      var lost = state.farmTarget;
      state.farmTarget = null;
      state.log.push('warn', 'Stage ' + lost + ' is too dangerous to farm right now — ' +
        'hunting ground released.', state.time);
      emit(state, 'farmTargetChanged', null);
    }

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
    gainXp: gainXp,
    attributeMultiplier: attributeMultiplier,

    // Hunting grounds (player-chosen farming)
    canFarmStage: canFarmStage,
    canChallengeBoss: canChallengeBoss,
    startBossChallenge: startBossChallenge,
    setFarmTarget: setFarmTarget,
    clearFarmTarget: clearFarmTarget,
    xpRelevance: xpRelevance
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
