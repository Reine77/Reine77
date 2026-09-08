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
       final = base + levelGrowth + gearMods + runeMods
   recomputed from scratch, and CACHED.

   Why cached: computeStats loops over gear and every purchased
   rune. Doing that 60-144 times per second, forever, for values
   that only change on equip / rune purchase / level up, is pure
   waste. Instead we set a "dirty" flag when something changes,
   and only recompute on the next read. This is the standard
   dirty-flag pattern and you will see it everywhere in games.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;

  // The full list of stats we track. Having this as data (rather
  // than hand-written property names in five places) means adding
  // a new stat later is a one-line change.
  var STAT_KEYS = [
    'hp', 'damage', 'attackSpeed', 'critChance',
    'critMult', 'spellPower', 'spellCooldown'
  ];

  function makeHero() {
    return {
      // ---- immutable ----
      base: Object.assign({}, CONFIG.heroBase),

      // ---- progression ----
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(1),
      gold: 0,

      // ---- runtime combat state ----
      hp: CONFIG.heroBase.hp, // current HP; maxHp comes from stats.hp
      timers: { attack: 0, spell: 0 },

      // ---- power sources (filled in by later phases) ----
      equipped: { weapon: null, armor: null }, // Phase 2
      runes: [],                               // Phase 3 (array of rune ids)
      spellUnlocked: false,                    // flipped by the first arcane rune

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
    var slots = ['weapon', 'armor'];
    for (i = 0; i < slots.length; i++) {
      var item = hero.equipped[slots[i]];
      if (!item || !item.mods) continue;
      applyMods(out, item.mods);
    }

    // 4. Rune mods — Phase 3 fills hero.runes.
    if (Sylvaine.Runes && typeof Sylvaine.Runes.modsFor === 'function') {
      applyMods(out, Sylvaine.Runes.modsFor(hero.runes));
    }

    // 5. Clamp. Reductions must not produce a zero or negative
    //    interval — see the comment in config.js floors.
    out.attackSpeed   = Math.max(CONFIG.floors.attackSpeed,   out.attackSpeed);
    out.spellCooldown = Math.max(CONFIG.floors.spellCooldown, out.spellCooldown);
    out.critChance    = Math.min(1, Math.max(0, out.critChance));
    out.hp            = Math.max(1, out.hp);
    out.damage        = Math.max(0, out.damage);

    // 6. Derived, convenience values. Computed once here rather
    //    than divided out every tick in the combat code.
    out.maxHp         = out.hp;
    out.attackInterval = 1 / out.attackSpeed;

    hero._stats = out;
    hero._statsDirty = false;
    return out;
  }

  // Add a { statName: delta } object into an accumulator.
  // Unknown keys are ignored rather than silently creating a
  // stat that nothing reads — that turns a typo in an item
  // definition into a visible warning instead of a dead mod.
  function applyMods(acc, mods) {
    for (var key in mods) {
      if (!Object.prototype.hasOwnProperty.call(mods, key)) continue;
      if (STAT_KEYS.indexOf(key) === -1) {
        console.warn('stats.js: ignoring unknown stat "' + key + '"');
        continue;
      }
      acc[key] += mods[key];
    }
    return acc;
  }

  Sylvaine.Stats = {
    STAT_KEYS: STAT_KEYS,
    makeHero: makeHero,
    computeStats: computeStats,
    markDirty: markDirty,
    xpForLevel: xpForLevel,
    applyMods: applyMods
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
