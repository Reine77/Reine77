/* =============================================================
   stats.js — turning base stats into final stats.
   -------------------------------------------------------------
   THE ONE RULE OF THIS FILE: hero.base is read-only. Forever.

   Why that rule matters so much: gear can be swapped and runes
   could (in principle) be refunded. If equipping a sword did
   `hero.base.damage += 5`, then unequipping it has to subtract
   exactly 5 — and the moment any rounding, any stacking order,
   or any double-apply bug creeps in, the base stats drift and
   there is no way to recover the true value. Keeping base
   immutable and recomputing the total from scratch means a bug
   can never accumulate: worst case one frame is wrong, then the
   next recompute fixes it.

   So the model is:
       final = (base + levelGrowth + gearFlat + runeFlat) * (1 + percent)
   recomputed from scratch, and CACHED.

   Why cached: computeStats loops over gear and every purchased
   rune. Doing that 60-144 times per second, forever, for values
   that only change on equip / rune purchase / level up, is pure
   waste. Instead we set a "dirty" flag when something changes,
   and only recompute on the next read. This is the standard
   dirty-flag pattern and you will see it everywhere in games.

   PERCENT MODIFIERS (added alongside flat ones)
     Gear and runes can now also carry "+X% damage" style mods —
     needed for the Diablo-style gear rework and the elemental
     rune tree. The one rule that matters here: percentages from
     DIFFERENT SOURCES SUM before being applied once, they never
     multiply each other.

         damage = flatDamage * (1 + item1% + item2% + rune%)   <- this
         damage = flatDamage * (1+item1%) * (1+item2%) * ...   <- NOT this

     The wrong version compounds: five +20% sources give 2.49x
     (1.2^5), not 2.0x, and the more you stack the faster each
     ADDITIONAL one accelerates you — an unbounded runaway against
     an enemy curve that grows at a fixed 13%/stage. The right
     version is linear in how much you stack, which is what keeps
     the economy calibration (README's "one branch maxed" target)
     meaningful after gear enters the picture instead of obsolete
     the moment someone stacks three damage affixes.

     Damage percent is further split into buckets that SUM with
     each other (not multiply) before applying: a hit always gets
     `all`, plus either `physical` (if that's its attribute) or
     `magic` + its own specific element (if not). See
     damagePercentFor() below — this is the one place that logic
     lives, so the rune/gear rework only has to produce mod keys,
     never re-derive the bucket rules.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;

  // The full list of FLAT stats we track. Having this as data
  // (rather than hand-written property names in five places) means
  // adding a new stat later is a one-line change.
  var STAT_KEYS = [
    'hp', 'damage', 'attackSpeed', 'critChance',
    'critMult', 'spellPower', 'spellCooldown',
    'evadeChance', 'damageReduction', 'healPower', 'healCooldown'
  ];

  // Percent-modifier keys. Deliberately a SEPARATE namespace from
  // STAT_KEYS rather than nested objects inside mods — item/rune
  // mods stay one flat { key: number } map either way, so nothing
  // about how items.js or runes.js BUILD a mods object has to
  // change; they just get more possible key names to roll from.
  //
  // Not every flat stat gets a percent counterpart. critChance and
  // critMult stay flat-only on purpose — "+5% crit chance" reads,
  // in every ARPG that has the phrase, as +0.05 additive to an
  // already-0-to-1 value, not as "5% of your current crit chance"
  // — so giving them a *Percent key would be a trap, not a feature.
  // spellCooldown is a reduction already handled in seconds; a
  // percent version can be added later without disturbing this one.
  var ELEMENTAL_PERCENT_KEYS = CONFIG.attributes.all
    .filter(function (a) { return a !== 'physical'; })
    .map(function (a) { return a + 'DamagePercent'; });

  var PERCENT_KEYS = ['damagePercent', 'physicalDamagePercent', 'magicDamagePercent',
    'hpPercent', 'attackSpeedPercent', 'healPercent'].concat(ELEMENTAL_PERCENT_KEYS);

  function makeHero() {
    return {
      // ---- immutable ----
      base: Object.assign({}, CONFIG.heroBase),

      // ---- progression ----
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(1),
      gold: 0,
      bossTokens: 0,   // spent to re-fight an already-beaten boss

      // ---- runtime combat state ----
      hp: CONFIG.heroBase.hp, // current HP; maxHp comes from stats.hp
      timers: { attack: 0, spell: 0, heal: 0 },

      // ---- power sources (filled in by later phases) ----
      equipped: { weapon: null, armor: null }, // Phase 2
      // Real gear inventory (step 4) — items that don't auto-sell on
      // drop wait here for a manual equipItem/sellItem call. Starts
      // from CONFIG's default policy, then lives on the hero from
      // here on so items.js's setAutoSell can flip it at runtime,
      // same split as attackAttribute/spellAttribute above.
      inventory: [],
      autoSellRarities: Object.assign({}, CONFIG.items.autoSellDefault),
      runes: {},                               // rune id -> rank owned (1..maxRank)
      spellUnlocked: false,                    // flipped by the first magic rune
      healUnlocked: false,                     // flipped by the first heal rune

      // Which element her basic attack / spell currently deal. Start
      // from CONFIG's defaults, then live entirely on the hero from
      // here on — a rune "conversion" node permanently overwrites
      // one of these (see runes.js's convertsAttackTo/convertsSpellTo).
      attackAttribute: CONFIG.attributes.defaultAttackAttribute,
      spellAttribute: CONFIG.attributes.defaultSpellAttribute,

      // ---- stat cache ----
      _stats: null,
      _statsDirty: true
    };
  }

  // XP required to go from `level` to `level + 1`.
  function xpForLevel(level) {
    return Math.floor(CONFIG.xp.base * Math.pow(CONFIG.xp.growth, level - 1));
  }

  // Call this whenever anything that feeds computeStats changes.
  function markDirty(hero) {
    hero._statsDirty = true;
  }

  function computeStats(hero) {
    // The cache check. Everything below only runs when dirty.
    if (!hero._statsDirty && hero._stats) return hero._stats;

    var out = {};
    var i, key;

    // 1. Start from base. Note we COPY — we never touch hero.base.
    for (i = 0; i < STAT_KEYS.length; i++) {
      key = STAT_KEYS[i];
      out[key] = hero.base[key];
    }

    // 2. Level growth.
    var levels = hero.level - 1;
    var per = CONFIG.perLevel;
    for (key in per) {
      if (Object.prototype.hasOwnProperty.call(per, key)) {
        out[key] += per[key] * levels;
      }
    }

    // 3. Gear mods — Phase 2 fills hero.equipped. The loop is
    //    already here so Phase 2 needs no change to this file.
    //    Percent mods are gathered into a SEPARATE accumulator
    //    (`pct`) rather than folded straight into `out`, because
    //    they all have to be SUMMED across every source before
    //    being applied — applying each one as it's found would
    //    compound them instead (see this file's header).
    var pct = {};
    var slots = ['weapon', 'armor'];
    for (i = 0; i < slots.length; i++) {
      var item = hero.equipped[slots[i]];
      if (!item || !item.mods) continue;
      applyMods(out, item.mods);
      applyPercentMods(pct, item.mods);
    }

    // 4. Rune mods — Phase 3 fills hero.runes.
    if (Sylvaine.Runes && typeof Sylvaine.Runes.modsFor === 'function') {
      var runeMods = Sylvaine.Runes.modsFor(hero.runes);
      applyMods(out, runeMods);
      applyPercentMods(pct, runeMods);
    }

    // 5. Apply the summed percentages, ONCE, to the flat totals
    //    from steps 1-4. This has to happen before the floor/clamp
    //    step below (a percentage could in principle push a value
    //    past a floor) and needs to know WHICH attribute each of
    //    damage/spellPower carries, since damage% bonuses are
    //    bucketed by attribute — see damagePercentFor().
    //
    //    Reads hero.attackAttribute/spellAttribute — these live on
    //    the hero (not CONFIG) precisely so a rune conversion node
    //    can change them permanently and have it reflected here.
    out.hp         *= (1 + (pct.hpPercent || 0));
    out.attackSpeed *= (1 + (pct.attackSpeedPercent || 0));
    out.damage      *= (1 + damagePercentFor(pct, hero.attackAttribute));
    out.spellPower   *= (1 + damagePercentFor(pct, hero.spellAttribute));
    out.healPower    *= (1 + (pct.healPercent || 0));

    // 6. Clamp. Reductions must not produce a zero or negative
    //    interval — see the comment in config.js floors.
    out.attackSpeed   = Math.max(CONFIG.floors.attackSpeed,   out.attackSpeed);
    out.spellCooldown = Math.max(CONFIG.floors.spellCooldown, out.spellCooldown);
    out.healCooldown  = Math.max(CONFIG.floors.healCooldown,  out.healCooldown);
    out.critChance    = Math.min(1, Math.max(0, out.critChance));
    out.evadeChance     = Math.min(CONFIG.caps.evadeChance,     Math.max(0, out.evadeChance));
    out.damageReduction = Math.min(CONFIG.caps.damageReduction, Math.max(0, out.damageReduction));
    out.hp            = Math.max(1, out.hp);
    out.damage        = Math.max(0, out.damage);
    out.healPower      = Math.max(0, out.healPower);

    // 7. Derived, convenience values. Computed once here rather
    //    than divided out every tick in the combat code.
    out.maxHp         = out.hp;
    out.attackInterval = 1 / out.attackSpeed;

    hero._stats = out;
    hero._statsDirty = false;
    return out;
  }

  // The one place the "which percent buckets apply to this hit"
  // rule lives. `attribute` is whichever element the damage SOURCE
  // (basic attack or spell) currently carries.
  //
  //   physical hit -> `all` + `physical`
  //   any other element -> `all` + `magic` (the broad category)
  //                         + that element's own specific bucket
  //
  // These three (or two, for physical) all SUM before the single
  // `(1 + ...)` multiply in computeStats — that's what keeps this
  // linear rather than compounding, same as every other percent
  // source in this file.
  function damagePercentFor(pct, attribute) {
    var bonus = pct.damagePercent || 0;
    if (attribute === 'physical') {
      bonus += pct.physicalDamagePercent || 0;
    } else {
      bonus += pct.magicDamagePercent || 0;
      bonus += pct[attribute + 'DamagePercent'] || 0;
    }
    return bonus;
  }

  // Add a { statName: delta } object into a FLAT accumulator.
  // Percent keys are recognised and silently skipped here (they're
  // not an error, they just belong to applyPercentMods instead) —
  // only a key in neither list triggers the warning, which turns a
  // typo in an item/rune definition into something visible instead
  // of a silently dead mod.
  function applyMods(acc, mods) {
    for (var key in mods) {
      if (!Object.prototype.hasOwnProperty.call(mods, key)) continue;
      if (PERCENT_KEYS.indexOf(key) !== -1) continue;
      if (STAT_KEYS.indexOf(key) === -1) {
        console.warn('stats.js: ignoring unknown stat "' + key + '"');
        continue;
      }
      acc[key] += mods[key];
    }
    return acc;
  }

  // The percent-side counterpart to applyMods — sums every
  // recognised *Percent key across however many mods objects it's
  // called with (once per equipped item, once for the combined
  // rune total). Flat keys are silently skipped; applyMods already
  // owns warning about anything neither function recognises.
  function applyPercentMods(acc, mods) {
    for (var key in mods) {
      if (!Object.prototype.hasOwnProperty.call(mods, key)) continue;
      if (PERCENT_KEYS.indexOf(key) === -1) continue;
      acc[key] = (acc[key] || 0) + mods[key];
    }
    return acc;
  }

  Sylvaine.Stats = {
    STAT_KEYS: STAT_KEYS,
    PERCENT_KEYS: PERCENT_KEYS,
    makeHero: makeHero,
    computeStats: computeStats,
    markDirty: markDirty,
    xpForLevel: xpForLevel,
    applyMods: applyMods,
    applyPercentMods: applyPercentMods,
    damagePercentFor: damagePercentFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
