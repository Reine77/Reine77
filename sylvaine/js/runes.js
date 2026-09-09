/* =============================================================
   runes.js — the rune tree: data, purchase rules, spell gate.
   -------------------------------------------------------------
   This is the ONLY real decision the player makes. Levels are
   automatic (XP), gear is automatic (drops). Runes are gold she
   chooses to spend, on a tree she chooses to shape.

   THE TREE IS A FLAT ARRAY, NOT A NESTED STRUCTURE
     NODES is one flat list. Each node names its own prerequisites
     by id in `requires: [...]`. The tree SHAPE — what unlocks
     what — emerges entirely from those references; nothing here
     is a nested { children: [...] } object.

     Why that matters: a hybrid node needs to require nodes from
     TWO different branches at once (blade_2 AND arcane_2). A
     nested tree can't express "my parent is two different
     nodes in two different branches" without contorting itself
     into a graph anyway — so we just start as a graph. A flat
     array with a `requires` list is a graph, in the simplest
     form JavaScript has: it's also trivial to save (Phase 8 —
     it's just an array of owned ids) and trivial to render as a
     tree later (Phase 6 walks `requires` to draw the lines).

   THE SPELL GATE
     Before any magic rune, hero.spellUnlocked is false and
     game.js's tickHero never even looks at the spell timer —
     she doesn't almost-have a spell, she has no spell. The
     first magic node purchased (magic_1, flagged
     `unlocksSpell: true` below) flips that flag permanently.
     Every later magic/hybrid node just adds spellPower or
     shaves spellCooldown on top of an ability that already
     exists. The same pattern gates the heal (`unlocksHeal`,
     see magic_3) — no half-existing ability, a flag flip and
     then a real one.

   TWO TREES, RE-THEMED AROUND PHYSICAL vs MAGIC + ELEMENT
     `physical` is mostly attackSpeed/critChance/critMult plus the
     two defensive stats (evadeChance, damageReduction) — a build
     that leans into surviving and hitting fast/hard with her
     sword. `magic` is spellPower/spellCooldown plus the heal —
     a build that leans into the spell and staying alive through
     healing rather than not-getting-hit. Both trees also carry
     exactly ONE "elemental" node: a capstone that PERMANENTLY
     converts her attack (physical tree) or spell (magic tree) to
     a new element and grants that element's own damage% bonus in
     the same node.

     Why a CONVERSION rather than just sprinkling in a stray
     `+X% fire damage` node: her attack starts physical and her
     spell starts wind. A flat "+15% fire damage" node would be
     completely inert until something else made her deal fire
     damage — a dead pick with no story. Converting the damage
     source's element AND granting that element's bucket bonus in
     the same purchase means the node is never inert: buying it is
     the moment it starts mattering, not a bet on some other node.
     It's also why there's only ONE such node per tree — with a
     single conversion target there's no "which of several
     elemental picks do I take", so no mutually-exclusive-node
     machinery is needed here at all.

     physical tree converts her attack to EARTH (capstone:
     Avalanche Strike) — the tree is themed physical+earth per
     design, and earth is the one element sprinkled in.
     magic tree converts her spell to FIRE (capstone: Wyrmfire
     Communion) — magic gets "the rest" of the elements (fire,
     dark, holy are all viable reskins; fire was picked as the
     flavour). magic also sprinkles a LITTLE physical/earth back
     the other way (magic_5, Battle Focus) — but that one does NOT
     need a conversion, because her attack is physical BY DEFAULT,
     so a `physicalDamagePercent` node is a live bonus to her
     basic attack from turn one, useful even to a caster who never
     converts anything.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;

  /* ---- The tree ---------------------------------------------
     Costs are hand-authored, not curve-generated like enemies/
     items — this is a small, fixed, designed tree, not an
     endless procedural system. Retune costs/mods here directly. */
  var NODES = [
    // ---- physical branch: attackSpeed/critChance/critMult, plus
    // the two defensive stats (evade, damage reduction), plus one
    // elemental capstone (converts her attack to earth). Base
    // costs sum to 2600, same total the old 4-node blade branch
    // used — the level-100 "afford one branch" calibration in
    // README doesn't have to move just because there are now 6
    // nodes splitting that budget instead of 4.
    {
      id: 'phys_1', branch: 'physical', name: 'Quick Step',
      cost: 150, requires: [],
      mods: { attackSpeed: 0.08 }
    },
    {
      id: 'phys_2', branch: 'physical', name: "Fencer's Eye",
      cost: 300, requires: ['phys_1'],
      mods: { critChance: 0.03 }
    },
    {
      id: 'phys_3', branch: 'physical', name: 'Sidestep',
      cost: 300, requires: ['phys_1'],
      // Defensive line the old tree didn't have at all — see the
      // "more defense related skill in physical" request. evade is
      // a flat chance, same convention as critChance: a stated
      // percentage reads as additive, not multiplicative-of-itself.
      mods: { evadeChance: 0.03 }
    },
    {
      id: 'phys_4', branch: 'physical', name: 'Killing Stroke',
      cost: 550, requires: ['phys_2'],
      mods: { critMult: 0.15 }
    },
    {
      id: 'phys_5', branch: 'physical', name: 'Stone Skin',
      cost: 550, requires: ['phys_3'],
      mods: { damageReduction: 0.05 }
    },
    {
      id: 'phys_6', branch: 'physical', name: 'Avalanche Strike',
      cost: 750, requires: ['phys_4', 'phys_5'],
      // The physical tree's one elemental pick. Permanently
      // converts her BASIC ATTACK to earth and grants earth's own
      // damage% bucket in the same node, so it's never a dead pick
      // — see the file header on why conversion+bucket are bundled.
      mods: { earthDamagePercent: 0.15 },
      convertsAttackTo: 'earth'
    },

    // ---- magic branch: spellPower/spellCooldown, plus the heal
    // (the "survival skill", placed EARLY per the design request),
    // plus one elemental capstone (converts her spell to fire) and
    // one physical/earth sprinkle-back node. Base costs also sum
    // to 2600.
    {
      id: 'magic_1', branch: 'magic', name: "Aldreth's First Lesson",
      cost: 175, requires: [],
      mods: { spellPower: 6 },
      // This is the ONE line that turns the spell on. See the
      // file header — before this is owned, she has no spell,
      // full stop, not a weak one.
      unlocksSpell: true
    },
    {
      id: 'magic_2', branch: 'magic', name: 'Steady Hand',
      cost: 300, requires: ['magic_1'],
      // Stored as a NEGATIVE mod on spellCooldown — the affix
      // fluff is "0.6s off your cooldown", the mod is -0.6.
      // Same convention items.js uses for the same stat.
      mods: { spellCooldown: -0.6 }
    },
    {
      id: 'magic_3', branch: 'magic', name: 'Mending Light',
      cost: 300, requires: ['magic_1'],
      // The survival skill — sits right next to the spell-unlock
      // node (one purchase deep), not buried at the end of the
      // tree, per the "heal early in magic tree" request.
      mods: { healPower: 8 },
      unlocksHeal: true
    },
    {
      id: 'magic_4', branch: 'magic', name: 'Deep Well',
      cost: 550, requires: ['magic_2'],
      mods: { spellPower: 10 }
    },
    {
      id: 'magic_5', branch: 'magic', name: 'Battle Focus',
      cost: 550, requires: ['magic_3'],
      // The magic tree's physical/earth sprinkle-back. No
      // conversion needed here — her basic attack is physical BY
      // DEFAULT, so this is a live bonus from the moment it's
      // bought, useful even to a caster who never touches phys_6.
      mods: { physicalDamagePercent: 0.10 }
    },
    {
      id: 'magic_6', branch: 'magic', name: 'Wyrmfire Communion',
      cost: 725, requires: ['magic_4', 'magic_5'],
      // The magic tree's one elemental pick. Permanently converts
      // her SPELL to fire and grants fire's own damage% bucket in
      // the same node — same conversion+bucket bundling as phys_6.
      mods: { fireDamagePercent: 0.15 },
      convertsSpellTo: 'fire'
    },

    // ---- hybrid: needs nodes from BOTH branches. Deliberately
    // requires the mid-tree stat nodes (not the elemental
    // capstones), so taking hybrid never forces an elemental
    // conversion — it stays orthogonal to that choice.
    {
      id: 'hybrid_1', branch: 'hybrid', name: 'Spellblade Stance',
      cost: 1200, requires: ['phys_2', 'magic_2'],
      mods: { attackSpeed: 0.05, spellPower: 5 }
    },
    {
      id: 'hybrid_2', branch: 'hybrid', name: "Bastard's Reckoning",
      cost: 3000, requires: ['phys_4', 'magic_4', 'hybrid_1'],
      mods: { critMult: 0.2, spellPower: 15, attackSpeed: 0.1, spellCooldown: -0.5 }
    }
  ];

  var byId = {};
  NODES.forEach(function (n) { byId[n.id] = n; });

  function getNode(id) { return byId[id]; }

  var MAX_RANK = CONFIG.runes.maxRank;

  /* ---- Ranks -------------------------------------------------
     hero.runes is a map of id -> rank owned (1..maxRank). A node
     the hero has never bought is simply absent, so `rankOf` is the
     single place that turns "absent" into 0 and everything else
     can treat rank as a plain number.

     It is a MAP rather than the array of ids it used to be
     because rank is now a per-node quantity, and an array of ids
     can only express "owned / not owned". Phase 8's save format
     gets the same upgrade for free — it's still one plain JSON
     object.                                                     */
  function rankOf(hero, id) {
    return hero.runes[id] || 0;
  }

  function isOwned(hero, id) { return rankOf(hero, id) > 0; }

  function isMaxed(hero, id) { return rankOf(hero, id) >= MAX_RANK; }

  // Price of the NEXT rank of a node: rank 1 costs the node's base
  // `cost`, and every rank after multiplies by rankCostMult. Power
  // per rank stays flat (see modsFor) while price compounds, which
  // is what makes the fifth rank a real decision instead of an
  // automatic one.
  function nextRankCost(hero, id) {
    var node = byId[id];
    if (!node) return Infinity;
    var rank = rankOf(hero, id);
    if (rank >= MAX_RANK) return Infinity;
    return Math.round(node.cost * Math.pow(CONFIG.runes.rankCostMult, rank));
  }

  // Total cost of taking one node from nothing to max rank.
  function fullCostOf(id) {
    var node = byId[id];
    if (!node) return 0;
    var total = 0;
    for (var r = 0; r < MAX_RANK; r++) {
      total += Math.round(node.cost * Math.pow(CONFIG.runes.rankCostMult, r));
    }
    return total;
  }

  // Total cost of maxing every node in one branch — the number the
  // economy is calibrated against (see README).
  function branchCost(branch) {
    return NODES.reduce(function (sum, n) {
      return n.branch === branch ? sum + fullCostOf(n.id) : sum;
    }, 0);
  }

  // Prerequisites only need to be UNLOCKED (rank >= 1), not maxed.
  // Requiring maxed prereqs would force a single rigid buy order
  // and remove the choice this tree exists to offer.
  function prereqsMet(hero, node) {
    return node.requires.every(function (reqId) { return isOwned(hero, reqId); });
  }

  /* ---- The purchase rules, checked in an order that gives the
     most useful failure message first ------------------------- */
  function canPurchase(hero, id) {
    var node = byId[id];
    if (!node) return { ok: false, reason: 'no such rune: "' + id + '"' };
    if (isMaxed(hero, id)) {
      return { ok: false, reason: 'already at max rank (' + MAX_RANK + ')' };
    }
    if (!prereqsMet(hero, node)) {
      var missing = node.requires.filter(function (r) { return !isOwned(hero, r); });
      return { ok: false, reason: 'missing prerequisite(s): ' + missing.join(', ') };
    }
    var cost = nextRankCost(hero, id);
    if (hero.gold < cost) {
      return { ok: false, reason: 'not enough gold (need ' + cost + ', have ' + Math.floor(hero.gold) + ')' };
    }
    return { ok: true, reason: null };
  }

  function purchase(state, id) {
    var hero = state.hero;
    var check = canPurchase(hero, id);
    if (!check.ok) {
      state.log.push('rune-fail', 'Cannot buy "' + id + '": ' + check.reason, state.time);
      return false;
    }

    var node = byId[id];
    var cost = nextRankCost(hero, id);
    hero.gold -= cost;
    hero.runes[id] = rankOf(hero, id) + 1;

    // Runes changed a stat input — throw the cache away. This is
    // the exact same line items.js's onKill needs after equipping,
    // and the exact same bug (forgetting it) that stats.js warns
    // about for level-ups: the purchase would "succeed" but she
    // wouldn't actually get stronger until something else happened
    // to trigger a recompute.
    Sylvaine.Stats.markDirty(hero);

    var justUnlockedSpell = false;
    if (node.unlocksSpell && !hero.spellUnlocked) {
      hero.spellUnlocked = true;
      // Same reasoning as game.js's beginFight resetting the attack
      // timer: give her a full cooldown, not an instant free cast.
      hero.timers.spell = Sylvaine.Stats.computeStats(hero).spellCooldown;
      justUnlockedSpell = true;
    }

    var justUnlockedHeal = false;
    if (node.unlocksHeal && !hero.healUnlocked) {
      hero.healUnlocked = true;
      hero.timers.heal = Sylvaine.Stats.computeStats(hero).healCooldown;
      justUnlockedHeal = true;
    }

    // Attribute conversion: permanently overwrites the hero's own
    // field. No refund, no going back — see the file header on why
    // this is bundled with a damage% bucket in the same node rather
    // than being its own separate pick.
    var convertedNote = '';
    if (node.convertsAttackTo && hero.attackAttribute !== node.convertsAttackTo) {
      hero.attackAttribute = node.convertsAttackTo;
      convertedNote = ' Her attack is now ' + node.convertsAttackTo + '.';
    }
    if (node.convertsSpellTo && hero.spellAttribute !== node.convertsSpellTo) {
      hero.spellAttribute = node.convertsSpellTo;
      convertedNote = ' Her spell is now ' + node.convertsSpellTo + '.';
    }

    state.log.push('rune', 'Purchased "' + node.name + '" rank ' + hero.runes[id] +
      '/' + MAX_RANK + ' [' + node.branch + '] for ' + cost + ' gold.' +
      (justUnlockedSpell ? ' The spell is unlocked.' : '') +
      (justUnlockedHeal ? ' The heal is unlocked.' : '') +
      convertedNote, state.time);
    return true;
  }

  // Nodes she could rank up right now if she had the gold — prereqs
  // met, not yet maxed. Doesn't check cost, so a UI can show
  // "locked" vs "visible but can't afford yet" separately.
  function availableNodes(hero) {
    return NODES.filter(function (n) { return !isMaxed(hero, n.id) && prereqsMet(hero, n); });
  }

  // Called by stats.js's computeStats — see the comment there.
  // A node at rank R contributes its mods R times: power is LINEAR
  // in rank while cost is exponential, so each rank is worth the
  // same amount of stat for progressively more gold.
  function modsFor(owned) {
    var total = {};
    for (var id in owned) {
      if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;
      var node = byId[id];
      if (!node) continue;
      var rank = owned[id];
      for (var stat in node.mods) {
        if (!Object.prototype.hasOwnProperty.call(node.mods, stat)) continue;
        total[stat] = (total[stat] || 0) + node.mods[stat] * rank;
      }
    }
    return total;
  }

  // Total ranks bought across the whole tree, for progress display.
  function totalRanks(hero) {
    var n = 0;
    for (var id in hero.runes) {
      if (Object.prototype.hasOwnProperty.call(hero.runes, id)) n += hero.runes[id];
    }
    return n;
  }

  Sylvaine.Runes = {
    NODES: NODES,
    MAX_RANK: MAX_RANK,
    getNode: getNode,
    rankOf: rankOf,
    isOwned: isOwned,
    isMaxed: isMaxed,
    nextRankCost: nextRankCost,
    fullCostOf: fullCostOf,
    branchCost: branchCost,
    totalRanks: totalRanks,
    prereqsMet: prereqsMet,
    canPurchase: canPurchase,
    purchase: purchase,
    availableNodes: availableNodes,
    modsFor: modsFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
