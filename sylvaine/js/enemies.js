/* =============================================================
   enemies.js — the roster and the stage scaling curve.
   -------------------------------------------------------------
   WHY the data is shaped like this: you have ~10 sprites and an
   endless number of stages. So an enemy the game spawns is never
   "a sprite" — it is a VARIANT that points at a base type's
   sprite plus a colour treatment plus stat weights.

       baseTypes  -> the art (one PNG each, one static frame)
       variants   -> base + palette + weights + stage range
       bosses     -> their own art, because they are the
                     milestone moments

   Nothing in this file knows how to draw anything. It only
   says which sprite file and which hue-rotate a renderer should
   use. Phase 5 reads those fields; Phase 1 ignores them.
   ============================================================= */
(function (root) {
  'use strict';

  var Sylvaine = (root.Sylvaine = root.Sylvaine || {});
  var CONFIG = Sylvaine.CONFIG;

  /* ---- Base types: one sprite each ------------------------
     `scale` is the rendered size relative to a 1.0 baseline.
     An ogre must LOOK bigger than a goblin, so we deliberately
     do not normalise these to one size.

     20 types, in roughly the order they're meant to be FIRST
     encountered (see each variant's minStage below) — the early
     roster is small grunts, the tail is named unique threats.
     "Pack"/"Horde" types are still ONE sprite each (one picture
     depicting several of them together); nothing in the code
     treats them as multiple combatants, they're reskinned/
     rebalanced singles, same as everything else here.          */
  var baseTypes = {
    // ---- early: common grunts (stage ~1-30) ----
    goblin:      { name: 'Goblin',            sprite: 'goblin.png',        scale: 0.70, hpMult: 0.80, damageMult: 0.85, attackSpeedMult: 1.15 },
    warhound:    { name: 'War-Hound',         sprite: 'warhound.png',      scale: 0.80, hpMult: 0.75, damageMult: 0.95, attackSpeedMult: 1.40 },
    orc:         { name: 'Orc',               sprite: 'orc.png',          scale: 1.00, hpMult: 1.00, damageMult: 1.00, attackSpeedMult: 1.00 },

    // ---- mid-early: grunts start banding together (stage ~15-45) ----
    goblinPack:  { name: 'Goblin Horde',      sprite: 'goblin_horde.png',  scale: 0.85, hpMult: 1.10, damageMult: 1.00, attackSpeedMult: 1.30 },
    warhoundPack:{ name: 'War-Hound Pack',    sprite: 'warhound_pack.png', scale: 0.95, hpMult: 1.05, damageMult: 1.05, attackSpeedMult: 1.55 },
    shaman:      { name: 'Horde Shaman',      sprite: 'shaman.png',        scale: 0.95, hpMult: 0.85, damageMult: 1.30, attackSpeedMult: 0.80 },
    orcBrute:    { name: 'Orc Brute',         sprite: 'orc_brute.png',     scale: 1.15, hpMult: 1.25, damageMult: 1.20, attackSpeedMult: 0.90 },
    direWolf:    { name: 'Dire Wolf',         sprite: 'dire_wolf.png',     scale: 0.90, hpMult: 0.90, damageMult: 1.00, attackSpeedMult: 1.60 },

    // ---- mid: the heavy hitters proper (stage ~20-60) ----
    troll:       { name: 'Troll',             sprite: 'troll.png',         scale: 1.25, hpMult: 1.45, damageMult: 1.05, attackSpeedMult: 0.75 },
    ogre:        { name: 'Ogre',              sprite: 'ogre.png',          scale: 1.45, hpMult: 1.70, damageMult: 1.25, attackSpeedMult: 0.60 },
    harpy:       { name: 'Harpy',             sprite: 'harpy.png',         scale: 0.80, hpMult: 0.75, damageMult: 1.05, attackSpeedMult: 1.50 },

    // ---- mid-late: named leaders and casters (stage ~40-85) ----
    trollTotem:  { name: 'Troll Totem-Master',sprite: 'troll_totem.png',   scale: 1.20, hpMult: 1.10, damageMult: 1.40, attackSpeedMult: 0.65 },
    darkAcolyte: { name: 'Dark Acolyte',      sprite: 'dark_acolyte.png',  scale: 0.90, hpMult: 0.80, damageMult: 1.45, attackSpeedMult: 0.85 },
    ogreBand:    { name: 'Ogre Bandmaster',   sprite: 'ogre_bandmaster.png', scale: 1.50, hpMult: 1.55, damageMult: 1.35, attackSpeedMult: 0.65 },
    blackKnight: { name: 'Black Knight',      sprite: 'black_knight.png',  scale: 1.10, hpMult: 1.35, damageMult: 1.30, attackSpeedMult: 0.90 },

    // ---- late: rare, dangerous, endless-tail threats (stage ~65+) ----
    wraith:      { name: 'Wraith',            sprite: 'wraith.png',        scale: 0.85, hpMult: 0.70, damageMult: 1.20, attackSpeedMult: 1.30 },
    stoneGolem:  { name: 'Stone Golem',       sprite: 'stone_golem.png',   scale: 1.55, hpMult: 2.20, damageMult: 1.10, attackSpeedMult: 0.45 },
    ettin:       { name: 'Two-Headed Ettin',  sprite: 'ettin.png',         scale: 1.65, hpMult: 2.00, damageMult: 1.50, attackSpeedMult: 0.55 },
    cyclops:     { name: 'Cyclops',           sprite: 'cyclops.png',       scale: 1.70, hpMult: 1.90, damageMult: 1.75, attackSpeedMult: 0.50 },
    wyvern:      { name: 'Wyvern',            sprite: 'wyvern.png',        scale: 1.35, hpMult: 1.60, damageMult: 1.55, attackSpeedMult: 0.75 }
  };

  /* ---- Colour treatments ----------------------------------
     A treatment is pure presentation data. `filter` is a CSS
     filter string; Phase 5 will drop it straight onto the
     sprite element's style. Tier 0 is the untouched original. */
  var treatments = {
    plain:    { suffix: '',            filter: null,                                   tint: '#c9c9c9' },
    bloodfang:{ suffix: 'Bloodfang',   filter: 'hue-rotate(-35deg) saturate(1.5)',     tint: '#c05050' },
    frost:    { suffix: 'Frostbound',  filter: 'hue-rotate(160deg) saturate(1.2)',     tint: '#6aa8d8' },
    elite:    { suffix: 'Elite',       filter: 'hue-rotate(60deg) saturate(1.6) brightness(1.1)', tint: '#c8b45a' },
    voidtouch:{ suffix: 'Voidtouched', filter: 'hue-rotate(250deg) saturate(1.4) brightness(0.9)', tint: '#9a6ad8' }
  };

  /* ---- Variants -------------------------------------------
     minStage/maxStage define where a variant can appear, so the
     roster naturally rotates as the player climbs. `weight` is
     relative spawn likelihood inside that window.
     Adding a tier later = one line here, zero new art.

     Two kinds of variety are layered on top of each other here:
       - the ORIGINAL 6 grunt types still get palette-swap tiers
         (bloodfang/frost/elite/voidtouch), same as before — a
         recolour of a type you've already seen, signalling "this
         one's stronger" without new art.
       - the 14 NEW types (packs, named leaders, late-game
         uniques) are each a genuinely distinct sprite instead,
         so the roster doesn't just get shinier, it gets STRANGER
         the deeper you go. They stay 'plain' for now; nothing
         stops adding palette tiers to them too later — it's one
         line each, same as everything else in this file.       */
  var variants = [
    // ---- stage 1-30ish: the grunts you meet on stage 1 ----
    { base: 'goblin',       treatment: 'plain', minStage: 1,   maxStage: 25,   weight: 3 },
    { base: 'warhound',     treatment: 'plain', minStage: 1,   maxStage: 30,   weight: 2 },
    { base: 'orc',          treatment: 'plain', minStage: 3,   maxStage: 35,   weight: 3 },

    // ---- stage 15-50ish: grunts start banding together ----
    { base: 'goblinPack',   treatment: 'plain', minStage: 15,  maxStage: 45,   weight: 2 },
    { base: 'direWolf',     treatment: 'plain', minStage: 15,  maxStage: 48,   weight: 2 },
    { base: 'warhoundPack', treatment: 'plain', minStage: 18,  maxStage: 50,   weight: 2 },
    { base: 'shaman',       treatment: 'plain', minStage: 8,   maxStage: 40,   weight: 2 },
    { base: 'orcBrute',     treatment: 'plain', minStage: 20,  maxStage: 55,   weight: 2 },

    // ---- stage 12-60ish: the heavy hitters proper ----
    { base: 'troll',        treatment: 'plain', minStage: 12,  maxStage: 45,   weight: 2 },
    { base: 'ogre',         treatment: 'plain', minStage: 18,  maxStage: 55,   weight: 2 },
    { base: 'harpy',        treatment: 'plain', minStage: 22,  maxStage: 58,   weight: 2 },

    // ---- palette tiers on the original 6 (stage 20-150) ----
    { base: 'goblin',   treatment: 'bloodfang', minStage: 20,  maxStage: 60,   weight: 2 },
    { base: 'warhound', treatment: 'bloodfang', minStage: 25,  maxStage: 65,   weight: 2 },
    { base: 'orc',      treatment: 'bloodfang', minStage: 30,  maxStage: 70,   weight: 3 },
    { base: 'troll',    treatment: 'frost',     minStage: 38,  maxStage: 80,   weight: 2 },
    { base: 'shaman',   treatment: 'frost',     minStage: 40,  maxStage: 85,   weight: 2 },
    { base: 'ogre',     treatment: 'frost',     minStage: 45,  maxStage: 90,   weight: 2 },
    { base: 'goblin',   treatment: 'elite',     minStage: 55,  maxStage: 120,  weight: 2 },
    { base: 'orc',      treatment: 'elite',     minStage: 60,  maxStage: 130,  weight: 3 },
    { base: 'troll',    treatment: 'elite',     minStage: 70,  maxStage: 140,  weight: 2 },
    { base: 'ogre',     treatment: 'elite',     minStage: 80,  maxStage: 150,  weight: 2 },

    // ---- stage 40-110ish: named leaders and casters ----
    { base: 'trollTotem',   treatment: 'plain', minStage: 40,  maxStage: 90,   weight: 2 },
    { base: 'darkAcolyte',  treatment: 'plain', minStage: 45,  maxStage: 95,   weight: 2 },
    { base: 'ogreBand',     treatment: 'plain', minStage: 50,  maxStage: 100,  weight: 2 },
    { base: 'blackKnight',  treatment: 'plain', minStage: 55,  maxStage: 105,  weight: 2 },

    // ---- the endless tail: rarest, most dangerous, no maxStage ----
    { base: 'orc',         treatment: 'voidtouch', minStage: 110, maxStage: null, weight: 3 },
    { base: 'shaman',      treatment: 'voidtouch', minStage: 110, maxStage: null, weight: 2 },
    { base: 'troll',       treatment: 'voidtouch', minStage: 120, maxStage: null, weight: 2 },
    { base: 'ogre',        treatment: 'voidtouch', minStage: 130, maxStage: null, weight: 2 },
    { base: 'wraith',      treatment: 'plain',     minStage: 65,  maxStage: null, weight: 2 },
    { base: 'stoneGolem',  treatment: 'plain',     minStage: 75,  maxStage: null, weight: 1 },
    { base: 'ettin',       treatment: 'plain',     minStage: 90,  maxStage: null, weight: 1 },
    { base: 'cyclops',     treatment: 'plain',     minStage: 100, maxStage: null, weight: 1 },
    { base: 'wyvern',      treatment: 'plain',     minStage: 110, maxStage: null, weight: 1 }
  ];

  /* ---- Bosses ---------------------------------------------
     Cycled by boss index, so boss 5 reuses boss 1's art with a
     treatment. Four distinct sprites cover an endless game.   */
  var bosses = [
    { name: 'Gorruk the Gate-Breaker', sprite: 'boss_gorruk.png', scale: 1.6, hpMult: 1.00, damageMult: 1.00, attackSpeedMult: 0.65 },
    { name: 'Maw of the Eastern Pass', sprite: 'boss_maw.png',    scale: 1.7, hpMult: 1.15, damageMult: 0.90, attackSpeedMult: 0.80 },
    { name: 'The Unifier',             sprite: 'boss_unifier.png',scale: 1.5, hpMult: 0.90, damageMult: 1.30, attackSpeedMult: 0.70 },
    { name: 'Crownwearer',             sprite: 'boss_crown.png',  scale: 1.8, hpMult: 1.25, damageMult: 1.15, attackSpeedMult: 0.60 }
  ];

  var bossTreatmentCycle = ['plain', 'bloodfang', 'frost', 'elite', 'voidtouch'];

  function isBossStage(stage) {
    return stage % CONFIG.boss.everyNStages === 0;
  }

  // base * growth^(stage-1) — the one curve every enemy stat uses.
  function curve(spec, stage) {
    return spec.base * Math.pow(spec.growth, stage - 1);
  }

  function eligibleVariants(stage) {
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      if (stage < v.minStage) continue;
      if (v.maxStage !== null && v.maxStage !== undefined && stage > v.maxStage) continue;
      out.push(v);
    }
    // Very early stages could in principle match nothing if the
    // table is edited badly. Fall back rather than crash.
    if (out.length === 0) out.push(variants[0]);
    return out;
  }

  function pickWeighted(list, rng) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    var roll = rng.random() * total;
    for (i = 0; i < list.length; i++) {
      roll -= list[i].weight;
      if (roll <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /* ---- The factory ----------------------------------------
     Returns a fresh enemy object. Note it carries both the
     numbers (for combat.js) and the art fields (for Phase 5),
     and combat.js never looks at the art fields.             */
  function spawn(stage, rng) {
    var C = CONFIG;
    var boss = isBossStage(stage);
    var art, name, treatment, baseType;

    if (boss) {
      var bossIndex = Math.floor(stage / C.boss.everyNStages) - 1;
      art = bosses[bossIndex % bosses.length];
      var cycle = Math.floor(bossIndex / bosses.length);
      treatment = treatments[bossTreatmentCycle[cycle % bossTreatmentCycle.length]];
      name = art.name + (treatment.suffix ? ' (' + treatment.suffix + ')' : '');
      baseType = null; // bosses are counted separately (totals.bossKills)
    } else {
      var variant = pickWeighted(eligibleVariants(stage), rng);
      art = baseTypes[variant.base];
      treatment = treatments[variant.treatment];
      name = treatment.suffix ? treatment.suffix + ' ' + art.name : art.name;
      baseType = variant.base;
    }

    var hp     = curve(C.enemy.hp, stage)     * art.hpMult;
    var damage = curve(C.enemy.damage, stage) * art.damageMult;
    var xp     = curve(C.enemy.xp, stage);
    var gold   = curve(C.enemy.gold, stage);
    var aSpeed = C.enemy.attackSpeed * art.attackSpeedMult;

    if (boss) {
      hp     *= C.boss.hpMult;
      damage *= C.boss.damageMult;
      xp     *= C.boss.xpMult;
      gold   *= C.boss.goldMult;
    }

    return {
      name: name,
      stage: stage,
      isBoss: boss,

      // The baseTypes key this enemy came from ('direWolf', 'goblin',
      // ...), or null for a boss. Kill counts are tracked against
      // THIS rather than `name`, because `name` carries the palette
      // tier prefix — "Bloodfang Goblin" and "Elite Goblin" and
      // "Goblin" are all the same creature for the purposes of a
      // future "kill 100 of these" requirement, and would otherwise
      // land in three separate buckets.
      baseType: baseType,

      // combat numbers
      maxHp: Math.round(hp),
      hp: Math.round(hp),
      damage: Math.round(damage * 10) / 10,
      attackSpeed: aSpeed,
      attackInterval: 1 / aSpeed,
      xpReward: Math.round(xp),
      goldReward: Math.round(gold),
      timer: 1 / aSpeed, // full cooldown, so the hero always swings first

      // presentation only — read by Phase 5, ignored by combat
      art: {
        sprite: art.sprite,
        scale: art.scale,
        filter: treatment.filter,
        tint: treatment.tint
      }
    };
  }

  Sylvaine.Enemies = {
    baseTypes: baseTypes,
    treatments: treatments,
    variants: variants,
    bosses: bosses,
    isBossStage: isBossStage,
    spawn: spawn
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
