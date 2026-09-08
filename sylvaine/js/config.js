/* =============================================================
   config.js — every tuning number in the game lives here.
   -------------------------------------------------------------
   WHY a separate file: balance changes are the thing you will do
   most often. If the numbers are scattered through the combat
   code you have to re-read logic to re-tune. Here you can retune
   without touching a single line of logic.

   This file defines no behaviour. It only holds data.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  Sylvaine.CONFIG = {

    /* ---- Hero starting point -------------------------------
       These are BASE stats. Nothing in the game ever writes to
       them at runtime. Levels, gear and runes are all layered
       on top as separate modifiers (see stats.js).            */
    heroBase: {
      hp:            100,
      damage:        10,
      attackSpeed:   1.2,   // attacks per second
      critChance:    0.05,  // 0..1
      critMult:      1.75,  // damage multiplier on a crit
      spellPower:    0,     // 0 until the arcane tree unlocks it (Phase 3)
      spellCooldown: 6.0    // seconds between casts
    },

    /* ---- Per-level growth ----------------------------------
       Applied as (level - 1) * value. This is the "walked away
       for an hour" power channel: slow, steady, no input.      */
    perLevel: {
      hp:          12,
      damage:      2,
      attackSpeed: 0.02,
      critChance:  0.002,
      spellPower:  1
    },

    /* ---- Hard floors ---------------------------------------
       Rune reductions must never be able to reach zero or go
       negative — a 0s interval would fire infinitely in one
       tick and hang the browser.                              */
    floors: {
      attackSpeed:   0.1,
      spellCooldown: 0.5
    },

    /* ---- XP curve ------------------------------------------
       xpToNext = base * growth^(level-1). Exponential, so the
       hero's level growth slows down as enemies speed up.     */
    xp: {
      base:   50,
      growth: 1.20
    },

    /* ---- Enemy scaling per stage ---------------------------
       Everything is base * growth^(stage-1). Exponential HP is
       what makes the game an idle game: linear hero growth vs
       exponential enemy HP produces walls, and walls are what
       make spending gold on runes feel necessary.             */
    enemy: {
      hp:          { base: 40, growth: 1.13 },
      damage:      { base: 4,  growth: 1.11 },
      attackSpeed: 0.7,
      xp:          { base: 12, growth: 1.12 },
      gold:        { base: 8,  growth: 1.12 }
    },

    /* ---- Boss stages --------------------------------------- */
    boss: {
      everyNStages: 10,
      hpMult:       4.0,
      damageMult:   1.35,
      xpMult:       5.0,
      goldMult:     5.0
    },

    /* ---- Combat pacing ------------------------------------- */
    combat: {
      // Fraction of max HP the hero recovers after each kill.
      // Below 1.0 this creates attrition: she can win one fight
      // and still lose the war. That attrition is the real
      // difficulty, not any single enemy's numbers.
      healOnKill: 0.20,

      // Delay between one enemy dying and the next spawning.
      spawnDelay: 0.4,

      // Safety net. If a fight somehow runs this long, treat it
      // as unwinnable rather than looping forever.
      stallTimeout: 60,

      // Boss winnability margin. She needs to kill the boss in
      // at most this fraction of the time it takes the boss to
      // kill her. 0.9 => a 10% safety buffer.
      bossMargin: 0.9,

      // Seconds spent "retreating" before fighting resumes.
      retreatPause: 1.5,

      // Spell damage = spellPower * this. Kept here so the spell
      // can be rebalanced without touching combat code.
      spellDamageMult: 3.0
    },

    /* ---- Debug -------------------------------------------- */
    debug: {
      // Phase 1 is console-only, so log every swing. Turn this
      // off once there is a real UI or the console will drown.
      logEverySwing: false
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
