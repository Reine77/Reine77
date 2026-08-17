// All tunable numbers for the POC live here so balancing doesn't require
// touching gameplay code.
const BALANCE = {
  world: { width: 3000, height: 3000, tileSize: 128 },

  player: {
    startHp: 100,
    speed: 220,
    baseDamage: 14,
    baseFireRateMs: 500,
    baseRangePx: 340,
    projectileSpeed: 520,
    pickupRadius: 70,
    invulnMs: 500,
    xpToLevel: (level) => Math.floor(18 * Math.pow(level, 1.45)) + 12,
  },

  enemyDefs: {
    mutant_crawler: {
      label: 'Mutant Crawler',
      texture: 'enemy_mutant_crawler',
      width: 40, height: 40,
      hp: 14, speed: 105, contactDamage: 8, contactCooldownMs: 700,
      xp: 3, tint: null,
    },
    scavenger: {
      label: 'Scavenger',
      texture: 'enemy_scavenger',
      width: 52, height: 52,
      hp: 42, speed: 78, contactDamage: 10, contactCooldownMs: 900,
      xp: 9, tint: null,
      ranged: true, preferredRange: 230, fireRateMs: 1700,
      projectileSpeed: 260, projectileDamage: 9,
    },
    rogue_robot_boss: {
      label: 'Rogue Robot',
      texture: 'boss_rogue_robot',
      width: 148, height: 148,
      hp: 620, speed: 52, contactDamage: 18, contactCooldownMs: 600,
      xp: 150, tint: null, isBoss: true,
      ranged: true, preferredRange: 300, fireRateMs: 1300,
      projectileSpeed: 240, projectileDamage: 12,
      slamDamage: 26, slamRadiusPx: 130, slamCooldownMs: 3200, slamTelegraphMs: 550,
    },
  },

  // Wave-based spawn schedule. Each non-boss wave lasts `durationMs` and
  // spawns from its `spawns` list on independent timers. The final entry
  // is the boss wave (ends the level on boss death).
  waves: [
    { durationMs: 22000, spawns: [{ type: 'mutant_crawler', everyMs: 900 }] },
    { durationMs: 26000, spawns: [{ type: 'mutant_crawler', everyMs: 700 }, { type: 'scavenger', everyMs: 4200 }] },
    { durationMs: 28000, spawns: [{ type: 'mutant_crawler', everyMs: 550 }, { type: 'scavenger', everyMs: 3200 }] },
    { durationMs: 30000, spawns: [{ type: 'mutant_crawler', everyMs: 420 }, { type: 'scavenger', everyMs: 2400 }] },
    { durationMs: 32000, spawns: [{ type: 'mutant_crawler', everyMs: 340 }, { type: 'scavenger', everyMs: 1900 }] },
    { boss: 'rogue_robot_boss' },
  ],

  chests: {
    spawnEveryMs: 14000,
    maxAlive: 2,
    firstDelayMs: 8000,
  },

  upgrades: [
    { key: 'damage_up', label: 'Overcharged Cannon', desc: '+25% weapon damage', apply: (p) => { p.stats.damageMult *= 1.25; } },
    { key: 'firerate_up', label: 'Rapid Cycler', desc: '+18% fire rate', apply: (p) => { p.stats.fireRateMult *= 0.82; } },
    { key: 'maxhp_up', label: 'Reinforced Frame', desc: '+20 max HP, heals 20', apply: (p) => { p.stats.maxHp += 20; p.hp = Math.min(p.stats.maxHp, p.hp + 20); } },
    { key: 'speed_up', label: 'Servo Boost', desc: '+12% move speed', apply: (p) => { p.stats.speedMult *= 1.12; } },
    { key: 'multishot', label: 'Twin Linked Barrels', desc: '+1 projectile per shot', apply: (p) => { p.stats.projectileCount += 1; } },
    { key: 'pickup_up', label: 'Salvage Magnet', desc: '+40% pickup radius', apply: (p) => { p.stats.pickupRadiusMult *= 1.4; } },
    { key: 'regen', label: 'Nano Repair Kit', desc: '+0.6 HP/sec regen', apply: (p) => { p.stats.regen += 0.6; } },
    { key: 'range_up', label: 'Targeting Array', desc: '+20% weapon range', apply: (p) => { p.stats.rangeMult *= 1.2; } },
  ],

  chestPickups: [
    { key: 'heal', label: 'Repair Cache', apply: (p) => { p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * 0.5); } },
    { key: 'overcharge', label: 'Overcharge', apply: (p) => { p.addTimedBuff('damageMult', 2.0, 10000); } },
    { key: 'adrenaline', label: 'Adrenaline Shot', apply: (p) => { p.addTimedBuff('speedMult', 1.5, 8000); p.addTimedBuff('fireRateMult', 0.6, 8000); } },
    { key: 'shield', label: 'Emergency Shield', apply: (p) => { p.setInvulnFor(3000); } },
    { key: 'nuke', label: 'EMP Burst', apply: (p, scene) => { scene.damageAllVisibleEnemies(60); } },
  ],
};
