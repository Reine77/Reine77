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
     Before any arcane rune, hero.spellUnlocked is false and
     game.js's tickHero never even looks at the spell timer —
     she doesn't almost-have a spell, she has no spell. The
     first arcane node purchased (arcane_1, flagged
     `unlocksSpell: true` below) flips that flag permanently.
     Every later arcane/hybrid node just adds spellPower or
     shaves spellCooldown on top of an ability that already
     exists.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});

  /* ---- The tree ---------------------------------------------
     Costs are hand-authored, not curve-generated like enemies/
     items — this is a small, fixed, designed tree, not an
     endless procedural system. Retune costs/mods here directly. */
  var NODES = [
    // ---- blade branch: attackSpeed, critChance, critMult ----
    {
      id: 'blade_1', branch: 'blade', name: 'Quick Step',
      cost: 150, requires: [],
      mods: { attackSpeed: 0.08 }
    },
    {
      id: 'blade_2', branch: 'blade', name: "Fencer's Eye",
      cost: 350, requires: ['blade_1'],
      mods: { critChance: 0.03 }
    },
    {
      id: 'blade_3', branch: 'blade', name: 'Killing Stroke',
      cost: 700, requires: ['blade_2'],
      mods: { critMult: 0.15 }
    },
    {
      id: 'blade_4', branch: 'blade', name: 'Whirlwind Guard',
      cost: 1400, requires: ['blade_3'],
      mods: { attackSpeed: 0.12, critChance: 0.02 }
    },

    // ---- arcane branch: spellPower, spellCooldown reduction -
    {
      id: 'arcane_1', branch: 'arcane', name: "Aldreth's First Lesson",
      cost: 200, requires: [],
      mods: { spellPower: 6 },
      // This is the ONE line that turns the spell on. See the
      // file header — before this is owned, she has no spell,
      // full stop, not a weak one.
      unlocksSpell: true
    },
    {
      id: 'arcane_2', branch: 'arcane', name: 'Steady Hand',
      cost: 450, requires: ['arcane_1'],
      // Stored as a NEGATIVE mod on spellCooldown — the affix
      // fluff is "0.6s off your cooldown", the mod is -0.6.
      // Same convention items.js uses for the same stat.
      mods: { spellCooldown: -0.6 }
    },
    {
      id: 'arcane_3', branch: 'arcane', name: 'Deep Well',
      cost: 850, requires: ['arcane_2'],
      mods: { spellPower: 10 }
    },
    {
      id: 'arcane_4', branch: 'arcane', name: 'Rune-Scarred',
      cost: 1600, requires: ['arcane_3'],
      mods: { spellCooldown: -0.8, spellPower: 6 }
    },

    // ---- hybrid: needs nodes from BOTH branches --------------
    {
      id: 'hybrid_1', branch: 'hybrid', name: 'Spellblade Stance',
      cost: 1200, requires: ['blade_2', 'arcane_2'],
      mods: { attackSpeed: 0.05, spellPower: 5 }
    },
    {
      id: 'hybrid_2', branch: 'hybrid', name: "Bastard's Reckoning",
      cost: 3000, requires: ['blade_4', 'arcane_4', 'hybrid_1'],
      mods: { critMult: 0.2, spellPower: 15, attackSpeed: 0.1, spellCooldown: -0.5 }
    }
  ];

  var byId = {};
  NODES.forEach(function (n) { byId[n.id] = n; });

  function getNode(id) { return byId[id]; }

  function isOwned(hero, id) { return hero.runes.indexOf(id) !== -1; }

  function prereqsMet(hero, node) {
    return node.requires.every(function (reqId) { return isOwned(hero, reqId); });
  }

  /* ---- The three purchase rules from the spec, checked in an
     order that gives the most useful failure message first ---- */
  function canPurchase(hero, id) {
    var node = byId[id];
    if (!node) return { ok: false, reason: 'no such rune: "' + id + '"' };
    if (isOwned(hero, id)) return { ok: false, reason: 'already owned' };
    if (!prereqsMet(hero, node)) {
      var missing = node.requires.filter(function (r) { return !isOwned(hero, r); });
      return { ok: false, reason: 'missing prerequisite(s): ' + missing.join(', ') };
    }
    if (hero.gold < node.cost) {
      return { ok: false, reason: 'not enough gold (need ' + node.cost + ', have ' + Math.floor(hero.gold) + ')' };
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
    hero.gold -= node.cost;
    hero.runes.push(id);

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

    state.log.push('rune', 'Purchased "' + node.name + '" [' + node.branch + '] for ' +
      node.cost + ' gold.' + (justUnlockedSpell ? ' The spell is unlocked.' : ''), state.time);
    return true;
  }

  // Nodes she could buy right now if she had the gold — prereqs
  // met, not already owned. Doesn't check cost, so a UI (Phase 6)
  // can show "locked" vs "visible but can't afford yet" separately.
  function availableNodes(hero) {
    return NODES.filter(function (n) { return !isOwned(hero, n.id) && prereqsMet(hero, n); });
  }

  // Called by stats.js's computeStats — see the comment there.
  // Sums every owned node's mods into one accumulator, the same
  // shape stats.js already knows how to merge (applyMods).
  function modsFor(ownedIds) {
    var total = {};
    for (var i = 0; i < ownedIds.length; i++) {
      var node = byId[ownedIds[i]];
      if (!node) continue;
      for (var stat in node.mods) {
        if (!Object.prototype.hasOwnProperty.call(node.mods, stat)) continue;
        total[stat] = (total[stat] || 0) + node.mods[stat];
      }
    }
    return total;
  }

  Sylvaine.Runes = {
    NODES: NODES,
    getNode: getNode,
    isOwned: isOwned,
    prereqsMet: prereqsMet,
    canPurchase: canPurchase,
    purchase: purchase,
    availableNodes: availableNodes,
    modsFor: modsFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
