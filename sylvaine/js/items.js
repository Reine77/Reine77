/* =============================================================
   items.js — item generation, the drop roll, and a real inventory.
   -------------------------------------------------------------
   Gear rework (step 4 of the build-strategy work). The earlier
   design auto-resolved every drop instantly (beats what's
   equipped -> auto-equip, otherwise auto-sell) — no inventory
   screen, nothing to look at. That made gear pure noise: whatever
   the game decided was "better" is what she wore, no choice in
   it. This step is what actually gives gear a decision to make,
   per the spec's explicit ask: a real inventory, manual equip,
   and a per-rarity auto-sell setting the player controls.

   THE DIABLO-STYLE RARITY SHAPE
     Every item, any rarity, carries the SAME one implicit base
     line — damage for a weapon, hp for armor ("just atk/def").
     Rarity adds PERCENT-modifier lines on top of that base, drawn
     from the physical/magic/neutral-damage system step 2 built:
     common = 0 extra lines, rare = 1, epic = 2. So a rare isn't
     "common plus a random stat" — it's "the same base stat, plus
     one build-defining percent line"; an epic gets two. This is
     also the first thing in the game that actually POPULATES the
     percent-mod keys step 2 left inert, and — since step 3 made
     attack/spell attributes mutable — the first thing that makes
     a specific-element affix (fireDamagePercent, say) a real,
     sometimes-relevant roll rather than dead weight.

   WHAT'S STILL AUTOMATIC
     The DROP roll (does a kill drop anything, what rarity) is
     unchanged — that's still pure RNG, same as before. What
     changed is what happens AFTER a drop: a rarity flagged
     auto-sell (common, by default) resolves itself immediately,
     same as the old behaviour always did. Everything else lands
     in hero.inventory and waits for a manual equipItem/sellItem
     call — see the bottom of this file.

   WHY "power" INSTEAD OF A LITERAL STAT SUM
     +0.1 attackSpeed and +5 damage are both small numbers, but
     attackSpeed multiplies into DPS while damage adds to it —
     they are not worth the same amount. Comparing the raw
     numbers would make sorting/comparison irrationally chase
     damage stats and ignore attackSpeed items. Instead, every
     stat has a WEIGHT (config.js -> items.powerWeights) that
     converts "1 unit of this stat" into an equivalent number of
     power points, and "power" is that weighted sum. It's the
     same weight table used to build the item in the first place,
     so generation and comparison agree with each other. Power no
     longer drives an automatic equip decision, but it still
     drives sell value and inventory-cap eviction (see
     enforceInventoryCap) and is a useful sort key for a UI.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;

  // The one implicit line every item of every rarity has.
  var BASE_STAT = { weapon: 'damage', armor: 'hp' };

  // The percent lines rare/epic can roll on top of the base line —
  // the config-listed "neutral"/physical/magic options, plus every
  // SPECIFIC element from CONFIG.attributes.all (built here, not
  // hand-typed in config.js, so a new attribute added there is
  // automatically eligible with no second edit needed).
  var PERCENT_POOL = CONFIG.items.percentAffixPool.concat(
    CONFIG.attributes.all
      .filter(function (a) { return a !== 'physical'; })
      .map(function (a) { return a + 'DamagePercent'; })
  );

  /* ---- Flavor only — no art yet, so a name is all she gets -- */
  var WEAPON_NAMES = ['Rapier', 'Sabre', 'Foil', 'Longsword', 'Estoc'];
  var ARMOR_NAMES  = ['Jerkin', 'Cloak', 'Vest', 'Mail Shirt', 'Guard'];
  var RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic' };

  var nextId = 1;

  // Every damage-percent key shares one weight/cap (see config.js's
  // comment on percentDamageWeight) — this is the one place that
  // fans the shared numbers out to whichever specific key is asked
  // for, so the rest of this file can just do a plain lookup.
  function weightFor(stat) {
    return PERCENT_POOL.indexOf(stat) !== -1
      ? CONFIG.items.powerWeights.percentDamageWeight
      : CONFIG.items.powerWeights[stat];
  }
  function capFor(stat) {
    return PERCENT_POOL.indexOf(stat) !== -1
      ? CONFIG.items.statCaps.percentDamageCap
      : CONFIG.items.statCaps[stat];
  }

  // Pick `count` DISTINCT percent affixes, using the state's
  // seeded rng so item rolls stay reproducible like everything else.
  function pickPercentAffixes(count, rng) {
    var choices = PERCENT_POOL.slice();
    var picked = [];
    count = Math.min(count, choices.length);
    for (var i = 0; i < count; i++) {
      var idx = rng.int(0, choices.length - 1);
      picked.push(choices[idx]);
      choices.splice(idx, 1);
    }
    return picked;
  }

  // Round each stat to a sensible precision for its scale.
  function roundStat(stat, value) {
    if (PERCENT_POOL.indexOf(stat) !== -1) return Math.round(value * 1000) / 1000;
    if (stat === 'hp') return Math.round(value);
    return Math.round(value * 10) / 10; // damage, the only remaining base stat
  }

  /* ---- Build one item --------------------------------------
     Pure function of (stage, slot, rarity, rng) — same inputs,
     same item, which is what keeps a seeded run reproducible. */
  function rollItem(stage, slot, rarity, rng) {
    var C = CONFIG.items;
    var affixes = [BASE_STAT[slot]].concat(
      pickPercentAffixes(C.percentAffixCount[rarity], rng));

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
      var value = points / weightFor(stat);

      // See config.js's comment on statCaps: percentage stats have
      // a natural ceiling that damage/hp don't, so they need one
      // enforced here rather than growing forever with the curve.
      var cap = capFor(stat);
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
    var total = 0;
    for (var stat in item.mods) {
      if (!Object.prototype.hasOwnProperty.call(item.mods, stat)) continue;
      total += Math.abs(item.mods[stat]) * (weightFor(stat) || 0);
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

  // Sell whatever item currently has the LOWEST power in the
  // inventory, to make room under CONFIG.items.inventoryCap. Not
  // necessarily the item that just triggered the check — an old,
  // weak common that's been sitting there loses to a brand new
  // rare every time, which is exactly "make room for the worse
  // stuff to go first" and never accidentally sells the good find.
  function enforceInventoryCap(state) {
    var hero = state.hero;
    var cap = CONFIG.items.inventoryCap;
    while (hero.inventory.length > cap) {
      var weakestIdx = 0;
      var weakestPower = computePower(hero.inventory[0]);
      for (var i = 1; i < hero.inventory.length; i++) {
        var p = computePower(hero.inventory[i]);
        if (p < weakestPower) { weakestPower = p; weakestIdx = i; }
      }
      var evicted = hero.inventory.splice(weakestIdx, 1)[0];
      var gold = sellValueOf(evicted);
      hero.gold += gold;
      state.totals.goldEarned += gold;
      state.totals.itemsSold++;
      state.log.push('item', 'Inventory full — auto-sold ' + evicted.name +
        ' [' + evicted.rarity + '] for ' + gold + ' gold.', state.time);
    }
  }

  /* ---- The hook game.js calls on every kill --------------------
     game.js checks `if (Sylvaine.Items && ...)` before calling
     this, so Phase 1's file never had to change to "know about"
     items — this file just has to exist and load before the
     first kill happens.

     What it does NOT do anymore: decide whether the item is an
     upgrade. That decision moved to the player (equipItem/sellItem,
     below) — this function's only job is "does the rarity resolve
     itself, or does it wait in the inventory."                    */
  function onKill(state, enemy) {
    var item = rollDrop(state, enemy);
    if (!item) return;

    state.totals.itemDrops++;
    // Counted on the DROP, not on the equip — an epic that later
    // gets auto-sold via inventoryCap eviction, or one the player
    // never gets around to equipping, still happened.
    if (item.rarity === 'epic') state.totals.epicsFound++;

    var hero = state.hero;
    if (hero.autoSellRarities[item.rarity]) {
      var gold = sellValueOf(item);
      hero.gold += gold;
      state.totals.goldEarned += gold;
      state.totals.itemsSold++;
      state.log.push('item', 'Found ' + item.name + ' [' + item.rarity +
        '] -> auto-sold for ' + gold + ' gold.', state.time);
      return;
    }

    hero.inventory.push(item);
    state.totals.itemsStashed++;
    state.log.push('item', 'Found ' + item.name + ' [' + item.rarity + '] (' +
      describeMods(item.mods) + ') -> added to inventory.', state.time);
    emit(state, 'itemStashed', item);
    enforceInventoryCap(state);
  }

  // Tiny local wrapper so this file doesn't need to import Game just
  // for its emit() — mirrors the no-op-if-nothing-listening contract
  // game.js's own emit already has.
  function emit(state, eventName, payload) {
    var list = state.hooks && state.hooks[eventName];
    if (!list) return;
    for (var i = 0; i < list.length; i++) list[i](payload, state);
  }

  /* ---- Manual actions (the whole point of a real inventory) --- */

  // Equip an inventory item by id. Whatever was previously in that
  // slot goes BACK into the inventory (a swap, not a sale) — the
  // player might want to switch back, and "equipping always costs
  // you the old piece" would make experimenting expensive for no
  // reason. Selling the old piece is still one click away
  // (sellItem), it's just not forced.
  function equipItem(state, itemId) {
    var hero = state.hero;
    var idx = hero.inventory.findIndex(function (it) { return it.id === itemId; });
    if (idx === -1) {
      state.log.push('warn', 'Cannot equip: no such item in inventory.', state.time);
      return false;
    }
    var item = hero.inventory[idx];
    hero.inventory.splice(idx, 1);

    var previous = hero.equipped[item.slot];
    hero.equipped[item.slot] = item;
    if (previous) hero.inventory.push(previous);

    Sylvaine.Stats.markDirty(hero); // the classic cache bug — see stats.js
    state.totals.itemsEquipped++;
    if (item.rarity === 'epic') state.totals.epicsEquipped++;

    state.log.push('item', 'Equipped ' + item.name + ' [' + item.rarity + ']' +
      (previous ? ' (' + previous.name + ' returned to inventory).' : '.'), state.time);
    return true;
  }

  // Sell an inventory item by id (does NOT touch equipped gear —
  // unequip by equipping something else, same as any ARPG).
  function sellItem(state, itemId) {
    var hero = state.hero;
    var idx = hero.inventory.findIndex(function (it) { return it.id === itemId; });
    if (idx === -1) {
      state.log.push('warn', 'Cannot sell: no such item in inventory.', state.time);
      return false;
    }
    var item = hero.inventory.splice(idx, 1)[0];
    var gold = sellValueOf(item);
    hero.gold += gold;
    state.totals.goldEarned += gold;
    state.totals.itemsSold++;
    state.log.push('item', 'Sold ' + item.name + ' [' + item.rarity + '] for ' + gold + ' gold.', state.time);
    return gold;
  }

  // Bulk-sell every inventory item of one rarity — the "I just
  // turned auto-sell off for common a while back and now there's a
  // pile of them sitting here" button.
  function sellAllOfRarity(state, rarity) {
    var hero = state.hero;
    var matches = hero.inventory.filter(function (it) { return it.rarity === rarity; });
    var total = 0;
    matches.forEach(function (it) { total += sellItem(state, it.id); });
    return total;
  }

  // Flip the auto-sell policy for one rarity going forward. Does
  // NOT retroactively sell what's already in the inventory — an
  // explicit setting change shouldn't have a surprise side effect;
  // sellAllOfRarity is the deliberate way to do that separately.
  function setAutoSell(state, rarity, enabled) {
    state.hero.autoSellRarities[rarity] = !!enabled;
    state.log.push('item', 'Auto-sell ' + rarity + ' set to ' + (!!enabled) + '.', state.time);
  }

  Sylvaine.Items = {
    rollItem: rollItem,
    rollDrop: rollDrop,
    computePower: computePower,
    sellValueOf: sellValueOf,
    describeMods: describeMods,
    onKill: onKill,
    equipItem: equipItem,
    sellItem: sellItem,
    sellAllOfRarity: sellAllOfRarity,
    setAutoSell: setAutoSell,
    enforceInventoryCap: enforceInventoryCap
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
