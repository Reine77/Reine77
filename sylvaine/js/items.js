/* =============================================================
   items.js — item generation, drop rolls, auto-equip/auto-sell.
   -------------------------------------------------------------
   Nobody is at the keyboard to open an inventory screen, so
   there IS no inventory screen. Every dropped item resolves
   immediately, in one of two ways:

     - beats what's equipped in that slot -> equip it, and
       auto-sell whatever it replaced (nothing sits in a bag)
     - doesn't beat it -> auto-sell it on the spot

   That's the whole rule from the spec: "if a dropped item's
   total stat sum beats the currently equipped item, auto-equip.
   Otherwise auto-sell." This file is what decides "beats".

   HOW AN ITEM IS GENERATED
     Every item is built from a "power budget" — a number of
     points, sized by stage and rarity — that gets split across
     1-3 random stats and converted into stat values. Sizing
     items this way (budget -> stats) rather than hand-writing
     stat ranges per rarity means the whole loot table scales
     automatically as stages get harder, using the exact same
     "base * growth^(stage-1)" shape as enemies.js.

   WHY "power" INSTEAD OF A LITERAL STAT SUM
     +0.1 attackSpeed and +5 damage are both small numbers, but
     attackSpeed multiplies into DPS while damage adds to it —
     they are not worth the same amount. Comparing the raw
     numbers would make the auto-equip logic irrationally chase
     damage stats and ignore attackSpeed items. Instead, every
     stat has a WEIGHT (config.js -> items.powerWeights) that
     converts "1 unit of this stat" into an equivalent number of
     power points, and "power" is that weighted sum. It's the
     same weight table used to build the item in the first place,
     so generation and comparison agree with each other.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;

  /* ---- What stats can roll on which slot ------------------
     Weapon leans offense, armor leans survivability/utility.
     Both are still just "mods: { statName: delta }" underneath —
     stats.js does not know or care which slot an affix came from. */
  var WEAPON_STATS = ['damage', 'attackSpeed', 'critChance', 'critMult', 'spellPower'];
  var ARMOR_STATS  = ['hp', 'spellPower', 'spellCooldown', 'critChance'];

  /* ---- Flavor only — no art yet, so a name is all she gets -- */
  var WEAPON_NAMES = ['Rapier', 'Sabre', 'Foil', 'Longsword', 'Estoc'];
  var ARMOR_NAMES  = ['Jerkin', 'Cloak', 'Vest', 'Mail Shirt', 'Guard'];
  var RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic' };

  var nextId = 1;

  function statPool(slot) {
    return slot === 'weapon' ? WEAPON_STATS : ARMOR_STATS;
  }

  // Pick `count` DISTINCT stats from a pool, using the state's
  // seeded rng so item rolls stay reproducible like everything else.
  function pickAffixes(pool, count, rng) {
    var choices = pool.slice();
    var picked = [];
    count = Math.min(count, choices.length);
    for (var i = 0; i < count; i++) {
      var idx = rng.int(0, choices.length - 1);
      picked.push(choices[idx]);
      choices.splice(idx, 1);
    }
    return picked;
  }

  // Round each stat to a sensible precision for its scale, and
  // flip spellCooldown positive-in-the-fluff to negative-as-a-mod
  // (an affix is "1.2s off your cooldown"; stats.js needs -1.2).
  function roundStat(stat, value) {
    switch (stat) {
      case 'attackSpeed':
      case 'critChance':
        return Math.round(value * 1000) / 1000;
      case 'critMult':
        return Math.round(value * 100) / 100;
      case 'hp':
        return Math.round(value);
      case 'spellCooldown':
        return -Math.round(value * 100) / 100;
      default: // damage, spellPower
        return Math.round(value * 10) / 10;
    }
  }

  /* ---- Build one item --------------------------------------
     Pure function of (stage, slot, rarity, rng) — same inputs,
     same item, which is what keeps a seeded run reproducible. */
  function rollItem(stage, slot, rarity, rng) {
    var C = CONFIG.items;
    var pool = statPool(slot);
    var count = C.affixCount[rarity];
    var affixes = pickAffixes(pool, count, rng);

    var budget = C.budget.base * Math.pow(C.budget.growth, stage - 1) *
      C.rarityBudgetMult[rarity];

    // Split the budget unevenly across affixes (each gets a random
    // 70-130% share, normalised to sum back to the full budget) so
    // two items of the same rarity don't feel like carbon copies.
    var shares = affixes.map(function () { return 0.7 + rng.random() * 0.6; });
    var shareTotal = shares.reduce(function (a, b) { return a + b; }, 0);

    var mods = {};
    for (var i = 0; i < affixes.length; i++) {
      var stat = affixes[i];
      var points = budget * (shares[i] / shareTotal);
      var weight = C.powerWeights[stat];
      var value = points / weight;

      // See config.js's comment on statCaps: percentage stats have
      // a natural ceiling that damage/spellPower/hp don't, so they
      // need one enforced here rather than growing forever with
      // the stage curve.
      var cap = C.statCaps[stat];
      if (cap !== undefined && value > cap) value = cap;

      mods[stat] = roundStat(stat, value);
    }

    var names = slot === 'weapon' ? WEAPON_NAMES : ARMOR_NAMES;
    return {
      id: 'item_' + (nextId++),
      slot: slot,
      name: RARITY_LABEL[rarity] + ' ' + rng.pick(names),
      rarity: rarity,
      mods: mods
    };
  }

  // The weighted "how good is this item" number — see the file
  // header for why this isn't just Object.values(mods).sum().
  function computePower(item) {
    if (!item) return 0;
    var weights = CONFIG.items.powerWeights;
    var total = 0;
    for (var stat in item.mods) {
      if (!Object.prototype.hasOwnProperty.call(item.mods, stat)) continue;
      total += Math.abs(item.mods[stat]) * (weights[stat] || 0);
    }
    return total;
  }

  function sellValueOf(item) {
    return Math.max(1, Math.round(computePower(item) * CONFIG.items.sellGoldPerPower));
  }

  function describeMods(mods) {
    var parts = [];
    for (var stat in mods) {
      if (!Object.prototype.hasOwnProperty.call(mods, stat)) continue;
      var v = mods[stat];
      parts.push((v > 0 ? '+' : '') + v + ' ' + stat);
    }
    return parts.join(', ');
  }

  /* ---- The drop roll -----------------------------------------
     Two independent rolls, exactly matching the spec's table:
       1. did this kill drop anything at all
       2. given a drop, which rarity (epic weight is 0 on normal
          stages, so step 2 physically cannot produce one there)  */
  function rollDrop(state, enemy) {
    var C = CONFIG.items;
    var rng = state.rng;
    var context = enemy.isBoss ? 'boss' : 'normal';

    if (!rng.chance(C.dropChance[context])) return null;

    var rarity = pickWeighted(C.rarityWeights[context], rng);
    var slot = rng.chance(0.5) ? 'weapon' : 'armor';
    return rollItem(state.stage, slot, rarity, rng);
  }

  // Weighted pick over a { key: probability } object whose values
  // sum to 1 (or less, in which case the remainder is treated as
  // "nothing" — not used here, but keeps the function honest).
  function pickWeighted(weights, rng) {
    var roll = rng.random();
    var acc = 0;
    for (var key in weights) {
      if (!Object.prototype.hasOwnProperty.call(weights, key)) continue;
      acc += weights[key];
      if (roll < acc) return key;
    }
    return key; // float rounding safety net: last key seen
  }

  /* ---- The hook game.js calls on every kill --------------------
     game.js checks `if (Sylvaine.Items && ...)` before calling
     this, so Phase 1's file never had to change to "know about"
     items — this file just has to exist and load before the
     first kill happens.                                          */
  function onKill(state, enemy) {
    var item = rollDrop(state, enemy);
    if (!item) return;

    state.totals.itemDrops++;
    var hero = state.hero;
    var equipped = hero.equipped[item.slot];
    var newPower = computePower(item);
    var oldPower = equipped ? computePower(equipped) : -1; // empty slot always loses

    if (newPower > oldPower) {
      if (equipped) {
        var refund = sellValueOf(equipped);
        hero.gold += refund;
        state.totals.goldEarned += refund;
        state.totals.itemsSold++;
      }
      hero.equipped[item.slot] = item;
      Sylvaine.Stats.markDirty(hero); // the classic cache bug — see stats.js
      state.totals.itemsEquipped++;
      if (item.rarity === 'epic') state.totals.epicsFound++;

      state.log.push('item', 'Found ' + item.name + ' [' + item.rarity + '] (' +
        describeMods(item.mods) + ') -> equipped.', state.time);
    } else {
      var gold = sellValueOf(item);
      hero.gold += gold;
      state.totals.goldEarned += gold;
      state.totals.itemsSold++;

      state.log.push('item', 'Found ' + item.name + ' [' + item.rarity + '], not an upgrade -> sold for ' +
        gold + ' gold.', state.time);
    }
  }

  Sylvaine.Items = {
    WEAPON_STATS: WEAPON_STATS,
    ARMOR_STATS: ARMOR_STATS,
    rollItem: rollItem,
    rollDrop: rollDrop,
    computePower: computePower,
    sellValueOf: sellValueOf,
    describeMods: describeMods,
    onKill: onKill
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
