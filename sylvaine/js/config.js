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
    /* Level 100 is the end of the intended arc — the point the
       economy is balanced around (reaching it should afford one
       maxed rune branch, not the whole tree). XP stops accruing
       here; stages continue forever, so the endless tail is still
       there for anyone who wants it. */
    levelCap: 100,

    heroBase: {
      hp:            100,
      damage:        10,
      attackSpeed:   1.2,   // attacks per second
      critChance:    0.05,  // 0..1
      critMult:      1.75,  // damage multiplier on a crit
      spellPower:    0,     // 0 until the magic tree unlocks it
      spellCooldown: 6.0,   // seconds between casts
      evadeChance:     0,   // 0..1, chance to take zero damage from a hit
      damageReduction: 0,   // 0..1, fraction shaved off hits that land
      healPower:       0,   // 0 until the magic tree unlocks it
      healCooldown:   10.0  // seconds between heals
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
      spellCooldown: 0.5,
      healCooldown:  1.0
    },

    /* ---- Hard caps ------------------------------------------
       Unlike the floors above (which stop a stat reaching an
       unusable extreme), these stop a stat reaching a BROKEN one.
       evadeChance/damageReduction are both "fraction of hits that
       do nothing" in different ways — uncapped, either one alone
       could reach 100% and make her unkillable, which would turn
       the whole retreat/attrition system (the actual difficulty
       of this game) off. Capping well under 1.0 keeps stacking
       both still short of true invulnerability.               */
    caps: {
      evadeChance:     0.5,
      damageReduction: 0.5
    },

    /* ---- XP curve ------------------------------------------
       xpToNext = base * growth^(level-1). Exponential, so the
       hero's level growth slows down as enemies speed up.     */
    xp: {
      base:   50,
      growth: 1.07,

      // How far BELOW your frontier (highest normal stage cleared)
      // an enemy still gives XP worth having. At the frontier it's
      // full XP; `relevanceWindow` stages below it, XP hits exactly
      // zero; in between it scales linearly.
      //
      // WHY this exists: the player can now lock onto a specific
      // stage and farm it forever (see game.js's farmTarget) —
      // needed so future systems can say "wolf pups only drop from
      // dire wolves, which only spawn in stages 30-50". Without a
      // falloff, parking on a cleared stage would ALSO be a free
      // levelling treadmill, and the optimal play would be to grind
      // trivial enemies you can one-shot instead of climbing.
      //
      // With it, farming costs you progression: you keep the gold,
      // the drops and the kill counts, but your level stops moving.
      // That's the trade the choice is supposed to be about.
      relevanceWindow: 10
    },

    /* ---- Enemy scaling per stage ---------------------------
       Everything is base * growth^(stage-1). Exponential HP is
       what makes the game an idle game: linear hero growth vs
       exponential enemy HP produces walls, and walls are what
       make spending gold on runes feel necessary.             */
    enemy: {
      // hp.base was 40 — a normal fight ended in 2-4s and the
      // first boss arrived 34 SECONDS into the game. Too fast for
      // an idle game; the first boss should be minutes away.
      //
      // IMPORTANT: hp.base alone controls PACING (how long a fight
      // takes in real seconds). damage.base controls DIFFICULTY
      // (how much of her HP a fight costs). They have to move
      // together: stretching a fight from 3s to 12s without
      // touching damage means she eats ~4x as many hits per kill
      // for the same 20% heal-on-kill, which isn't "slower" —
      // it's "harder", and that's not what we're changing here.
      //
      // So hp.base is up ~3.75x (stretches fight length) and
      // damage.base is down by the same ~3.75x (keeps damage taken
      // per kill, and therefore the attrition curve, unchanged).
      // Net effect: fights take longer, difficulty is unchanged.
      hp:          { base: 150,  growth: 1.13 },
      damage:      { base: 1.1,  growth: 1.11 },
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

    /* ---- Elemental attributes -------------------------------
       Every source of damage carries exactly ONE attribute, and
       every enemy may be weak to or resistant against some of
       them. Because an attack has one attribute, at most one
       multiplier can ever apply — resistances never stack, so the
       worst case is bounded and predictable. That is deliberate:
       an auto-battler can't swap loadouts mid-fight, so an
       unbounded resistance stack would just be an invisible wall.

       LENIENCY EARLY is handled in enemies.js as DATA, not as a
       special case here: the early grunts (goblin, war-hound, orc)
       simply have no tags at all, so nothing an early player does
       can be punished by a system they haven't learned yet. Tags
       start appearing on mid-tier enemies and get dense on bosses.  */
    attributes: {
      // The full set. Adding one here is enough for enemies.js and
      // (later) gear affixes to reference it.
      all: ['physical', 'fire', 'wind', 'earth', 'dark', 'holy'],

      weakMult:   1.5,  // enemy is weak to this attribute -> more damage
      resistMult: 0.7,  // enemy resists it -> less damage
      neutralMult: 1.0,

      // STARTING attributes for a fresh hero — copied onto
      // hero.attackAttribute/spellAttribute in makeHero(), then
      // owned by the hero from that point on, not read from here
      // again. This used to BE the live value (a global constant
      // no rune could touch); the rune tree rework is what turns
      // it into a real per-hero choice — buying a conversion node
      // (see runes.js's `convertsAttackTo`/`convertsSpellTo`)
      // overwrites the hero's own field, permanently, no refund.
      defaultAttackAttribute: 'physical',
      defaultSpellAttribute:  'wind'
    },

    /* ---- Runes ----------------------------------------------
       Every node can be bought `maxRank` times. Each rank adds the
       node's mods again (linear power) while costing rankCostMult
       times the last one (exponential price) — the classic
       diminishing-returns shape, and the thing that turns gold
       from a finite shopping list into a sink that never runs dry.

       A node's `cost` in runes.js is its RANK 1 price; rank R
       costs cost * rankCostMult^(R-1). So one node fully maxed
       costs cost * (rankCostMult^maxRank - 1) / (rankCostMult - 1).

       rankCostMult is the single lever that decides how much of
       the tree a full playthrough can afford — see the calibration
       note in README (the economy is tuned so reaching the level
       cap buys ONE branch maxed, with a little left over, not the
       whole tree). Change it and the whole economy moves.        */
    runes: {
      maxRank:      5,
      rankCostMult: 3.1
    },

    /* ---- Boss tokens ----------------------------------------
       A token buys one re-fight of a boss you have already beaten.
       It is a plain counter on the hero, NOT an inventory item —
       nothing about it needs the gear inventory to exist.

       WHY this is safe to allow at all: two rules already in the
       codebase make farming an old boss self-limiting. Item power
       rolls from the stage the item dropped at, so a stage-10 epic
       is junk to a stage-50 hero; and the XP/gold relevance
       falloff means an outleveled boss pays almost nothing. So the
       only reason to spend a token is on the HIGHEST boss you can
       actually beat, which is exactly the intended behaviour.

       bossKill is generous on purpose: a boss usually hands one
       back, so the loop partly sustains itself (1/(1-0.25) = 1.33x
       as many fights as tokens found) without ever being infinite. */
    bossTokens: {
      dropChance: { normalKill: 0.015, bossKill: 0.25 }
    },

    /* ---- Items ----------------------------------------------
       See js/items.js for what generates from this data. Kept
       here (not in items.js) because these are the numbers
       you'll retune once real playtesting starts — item power
       relative to enemy HP, how often things drop, how gold
       flows from selling.                                      */
    items: {
      // Chance a KILL drops something, checked once per kill.
      dropChance: { normal: 0.15, boss: 1.0 },

      // Given a drop happens, which rarity. Rows must sum to 1.
      // Epic is 0 on normal stages ON PURPOSE — that's the rule
      // that makes boss stages matter, not just chunkier HP.
      // Rows must sum to 1. Epic used to be 0 on normal stages and
      // 10% on bosses — but a whole playthrough only contains ~5
      // boss encounters, so that produced 0-1 epics EVER and the
      // tier was effectively dead content. Now bosses are the
      // reliable source and trash is a lottery ticket, which is
      // what makes long idle sessions able to produce one.
      rarityWeights: {
        normal: { common: 0.83, rare: 0.15, epic: 0.02 },
        boss:   { common: 0.30, rare: 0.45, epic: 0.25 }
      },

      // Every item is built from a "power budget" of points that
      // get converted into stat values (see powerWeights below).
      // The budget grows per stage — same shape as the enemy HP
      // curve — so a stage-40 drop is a real upgrade over a
      // stage-1 drop, not the same roll with a different label.
      budget: { base: 6, growth: 1.12 },

      // Rarity multiplies the WHOLE budget (not just adds a fixed
      // amount), so a rare isn't just "common + a bit" — it's a
      // proportionally bigger jump. This is what "big non-linear
      // jumps" means for the equipment channel specifically.
      rarityBudgetMult: { common: 1.0, rare: 2.5, epic: 5.0 },

      // How many separate stat lines an item rolls. More lines on
      // a higher rarity spreads the (much bigger) budget across
      // more stats, so a rare/epic item is stronger AND more
      // rounded, not just one huge number in one stat.
      affixCount: { common: 1, rare: 2, epic: 3 },

      // Gold refunded for auto-selling an item (either a drop that
      // wasn't an upgrade, or gear being replaced by a better one).
      sellGoldPerPower: 0.6,

      // "Power" = points of budget per 1 unit of a stat. Used BOTH
      // to size an item's rolled stats AND to compare two items
      // for the auto-equip decision. This is what makes the
      // comparison meaningful: +0.1 attackSpeed and +5 damage are
      // both small numbers, but attackSpeed compounds multiplicatively
      // into DPS, so it needs a much bigger weight per unit or the
      // auto-equip logic would always prefer raw damage stats and
      // never pick an attackSpeed item. These weights are a rough,
      // eyeballed DPS/HP equivalence, not a precise formula — retune
      // them if auto-equip starts making choices that feel wrong.
      powerWeights: {
        damage:        1,
        attackSpeed:   50,
        critChance:    300,
        critMult:      80,
        spellPower:    1,
        spellCooldown: 40,   // per 1 second of REDUCTION
        hp:            0.3
      },

      // Per-AFFIX ceiling on a stat's rolled value, checked before
      // rounding. The item budget grows exponentially per stage —
      // same shape as enemy HP — which is exactly right for damage,
      // spellPower and hp: they have no natural ceiling, and are
      // meant to keep producing "big non-linear jumps" forever.
      // critChance and critMult DO have a natural ceiling (100%
      // crit chance is already the maximum possible value), so
      // without a cap a late-stage roll produces something like
      // "+250% crit chance" on one affix — computeStats clamps the
      // FINAL total so nothing breaks, but the item itself would be
      // nonsense. Stats with no entry here are uncapped on purpose.
      statCaps: {
        attackSpeed:   0.6,
        critChance:    0.20,
        critMult:      0.50,
        spellCooldown: 3.0   // seconds of reduction, from one affix
      }
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
      // Was 60s, sized for the old ~4x-faster pacing. A winnable
      // boss fight can now legitimately run 60-90s+, so this has
      // to be comfortably above real fight lengths or it fires on
      // fights she was actually going to win.
      stallTimeout: 240,

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
