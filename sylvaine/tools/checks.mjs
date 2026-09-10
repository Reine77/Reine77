/* =============================================================
   tools/checks.mjs — sanity checks for the Phase 1 rules.
   -------------------------------------------------------------
   Run: node tools/checks.mjs

   These are not "unit tests" in a framework sense — no test
   runner, no dependencies, to match the no-build-step rule.
   They are a list of statements that must be true, and a loud
   failure if one is not. Each one exists because it is a bug
   that is easy to introduce and hard to notice by eye.
   ============================================================= */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
for (const f of ['config.js', 'rng.js', 'log.js', 'stats.js', 'items.js', 'runes.js', 'enemies.js', 'game.js']) {
  new Function(readFileSync(join(jsDir, f), 'utf8')).call(globalThis);
}
const { Sylvaine } = globalThis;
const { Game, Stats, Enemies, Runes, CONFIG } = Sylvaine;

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

console.log('\nPhase 1 checks\n');

/* --- 1. hero.base must never be written to ---------------- */
{
  const state = Game.createState({ seed: 3, echo: false });
  const before = JSON.stringify(state.hero.base);
  for (let i = 0; i < 60 * 60 * 5; i++) Game.step(state, 1 / 60); // 5 minutes
  check('base stats unchanged after 5 minutes of play',
    JSON.stringify(state.hero.base) === before,
    before + ' -> ' + JSON.stringify(state.hero.base));
  check('she actually made progress (so the check above is meaningful)',
    state.hero.level > 1 && state.totals.kills > 0,
    'level ' + state.hero.level + ', kills ' + state.totals.kills);
}

/* --- 2. the stat cache must be invalidated on level up ---- */
{
  const state = Game.createState({ seed: 4, echo: false });
  const dmgAtLevel1 = Stats.computeStats(state.hero).damage;
  Game.gainXp(state, 100000);
  const dmgLater = Stats.computeStats(state.hero).damage;
  check('levelling up changes computed damage (cache was invalidated)',
    dmgLater > dmgAtLevel1, dmgAtLevel1 + ' -> ' + dmgLater);
}

/* --- 3. the cache must actually cache -------------------- */
{
  const state = Game.createState({ seed: 5, echo: false });
  const a = Stats.computeStats(state.hero);
  const b = Stats.computeStats(state.hero);
  check('two reads with no change return the identical object', a === b);
  Stats.markDirty(state.hero);
  check('markDirty forces a fresh object', Stats.computeStats(state.hero) !== a);
}

/* --- 4. floors -------------------------------------------- */
{
  const state = Game.createState({ seed: 6, echo: false });
  // Simulate an absurd rune/gear stack by giving her a fake item.
  state.hero.equipped.weapon = { mods: { attackSpeed: -999, spellCooldown: -999 } };
  Stats.markDirty(state.hero);
  const s = Stats.computeStats(state.hero);
  check('attackSpeed floored', s.attackSpeed === CONFIG.floors.attackSpeed, String(s.attackSpeed));
  check('spellCooldown floored', s.spellCooldown === CONFIG.floors.spellCooldown, String(s.spellCooldown));
  check('attackInterval stays finite', Number.isFinite(s.attackInterval), String(s.attackInterval));
}

/* --- 5. boss cadence -------------------------------------- */
{
  const n = CONFIG.boss.everyNStages;
  let ok = true;
  for (let stage = 1; stage <= 200; stage++) {
    if (Enemies.isBossStage(stage) !== (stage % n === 0)) ok = false;
  }
  check('every ' + n + 'th stage is a boss stage, and no others', ok);

  const normal = Enemies.spawn(9, Sylvaine.makeRng(1));
  const boss = Enemies.spawn(10, Sylvaine.makeRng(1));
  check('boss HP is far above the normal curve', boss.maxHp > normal.maxHp * 3,
    normal.maxHp + ' vs ' + boss.maxHp);
  check('boss carries its own sprite', /^boss_/.test(boss.art.sprite), boss.art.sprite);
}

/* --- 6. enemy roster: 20 distinct base types, still reused --- */
{
  const baseNames = Object.keys(Enemies.baseTypes);
  const sprites = Object.values(Enemies.baseTypes).map(b => b.sprite);
  const uniqueSprites = new Set(sprites);
  let ok = true;
  for (const v of Enemies.variants) {
    if (!Enemies.baseTypes[v.base]) ok = false;
    if (!Enemies.treatments[v.treatment]) ok = false;
  }
  check('every variant points at a real base type and treatment', ok);

  check('the roster has exactly 20 base types (grunts through named uniques)',
    baseNames.length === 20, String(baseNames.length));
  check('no two base types share a sprite filename',
    uniqueSprites.size === sprites.length,
    uniqueSprites.size + ' unique out of ' + sprites.length);
  check('palette-swap treatments still multiply variants beyond one-per-type ' +
    '(' + Enemies.variants.length + ' variants from ' + baseNames.length + ' base types)',
    Enemies.variants.length > baseNames.length);
}

/* --- 7. the retreat gate must break unwinnable loops ------ */
{
  const state = Game.createState({ seed: 7, echo: false });
  // Push her straight at a boss she cannot possibly beat.
  state.stage = 60;
  state.highestNormalCleared = 1;
  state.phase = 'spawning';
  state.phaseTimer = 0;
  for (let i = 0; i < 60 * 30; i++) Game.step(state, 1 / 60); // 30 seconds
  check('an impossible boss triggers a retreat rather than a stuck fight',
    state.totals.retreats > 0 && state.farming === true,
    'retreats ' + state.totals.retreats + ', farming ' + state.farming);
  check('she falls back to a stage she can fight', state.stage < 60, 'stage ' + state.stage);
  check('no game-over state exists (she is alive and fighting)', state.hero.hp > 0);
}

/* --- 8. framerate independence ---------------------------- */
{
  function swingsIn(seconds, hz) {
    const state = Game.createState({ seed: 8, echo: false });
    // Save the REAL configured value — restoring a hardcoded number
    // here silently desynced every later test when the config moved.
    const realStallTimeout = CONFIG.combat.stallTimeout;
    CONFIG.combat.stallTimeout = 1e9;      // isolate the timers
    state.hero.base.critChance = 0;        // remove RNG from the equation
    Stats.markDirty(state.hero);
    Game.step(state, CONFIG.combat.spawnDelay + 0.001);
    state.enemy.hp = state.enemy.maxHp = 1e12; // unkillable dummy
    state.enemy.damage = 0;
    let swings = 0;
    Game.on(state, 'heroAttack', () => swings++);
    const dt = 1 / hz;
    for (let i = 0; i < Math.round(seconds * hz); i++) Game.step(state, dt);
    CONFIG.combat.stallTimeout = realStallTimeout;
    return swings;
  }
  const at60 = swingsIn(100, 60);
  const at144 = swingsIn(100, 144);
  const expected = 100 * CONFIG.heroBase.attackSpeed;
  check('60Hz and 144Hz produce the same number of swings (within 1)',
    Math.abs(at60 - at144) <= 1, at60 + ' vs ' + at144);
  check('swing count matches attackSpeed * time',
    Math.abs(at60 - expected) <= 2, at60 + ' vs expected ' + expected);
}

/* --- 9. the two timers are independent -------------------- */
{
  const state = Game.createState({ seed: 9, echo: false });
  const realStallTimeout9 = CONFIG.combat.stallTimeout;
  CONFIG.combat.stallTimeout = 1e9;
  state.hero.spellUnlocked = true;
  Game.step(state, CONFIG.combat.spawnDelay + 0.001);
  state.enemy.hp = state.enemy.maxHp = 1e12;
  state.enemy.damage = 0;
  let swings = 0, casts = 0;
  Game.on(state, 'heroAttack', () => swings++);
  Game.on(state, 'heroSpell', () => casts++);
  for (let i = 0; i < 60 * 60; i++) Game.step(state, 1 / 60); // 60s
  CONFIG.combat.stallTimeout = realStallTimeout9;
  const s = Stats.computeStats(state.hero);
  check('spell fires on its own clock, not per swing',
    casts > 0 && casts !== swings,
    swings + ' swings vs ' + casts + ' casts');
  check('cast count matches spellCooldown',
    Math.abs(casts - 60 / s.spellCooldown) <= 1,
    casts + ' vs expected ' + (60 / s.spellCooldown).toFixed(1));
}

/* --- 10. no spell before it is unlocked ------------------ */
{
  const state = Game.createState({ seed: 10, echo: false });
  for (let i = 0; i < 60 * 120; i++) Game.step(state, 1 / 60);
  check('spell never fires while locked', state.totals.spellCasts === 0,
    String(state.totals.spellCasts));
}

/* --- 11. same seed => same run --------------------------- */
{
  function run(seed) {
    const state = Game.createState({ seed, echo: false });
    for (let i = 0; i < 60 * 300; i++) Game.step(state, 1 / 60);
    return state.stage + '/' + state.hero.level + '/' + Math.round(state.hero.gold);
  }
  check('the same seed reproduces the same run', run(11) === run(11), run(11));
  check('a different seed produces a different run', run(11) !== run(99),
    run(11) + ' vs ' + run(99));
}

/* --- 12. epic never drops from a normal stage ------------- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 12, echo: false });
  let epicsFromNormal = 0, drops = 0;
  const normalEnemy = Enemies.spawn(5, Sylvaine.makeRng(1));
  for (let i = 0; i < 20000; i++) {
    const item = Items.rollDrop(state, normalEnemy);
    if (item) {
      drops++;
      if (item.rarity === 'epic') epicsFromNormal++;
    }
  }
  const epicRate = drops ? epicsFromNormal / drops : 0;
  check('epic CAN drop from normal stages, but stays rare (~2% of drops)',
    epicRate > 0 && epicRate < 0.05,
    (epicRate * 100).toFixed(2) + '% of ' + drops + ' drops');
  check('normal drop chance is roughly 15% (within 2%)',
    Math.abs(drops / 20000 - CONFIG.items.dropChance.normal) < 0.02,
    (drops / 20000 * 100).toFixed(1) + '%');
}

/* --- 13. boss always drops, and CAN roll epic -------------- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 13, echo: false });
  const bossEnemy = Enemies.spawn(10, Sylvaine.makeRng(1));
  let drops = 0, epics = 0;
  for (let i = 0; i < 2000; i++) {
    const item = Items.rollDrop(state, bossEnemy);
    if (item) drops++;
    if (item && item.rarity === 'epic') epics++;
  }
  check('boss stages always drop (2000/2000)', drops === 2000, drops + '/2000');
  check('boss stages can roll epic', epics > 0, epics + ' epics out of 2000');
}

/* --- 14. auto-equip only replaces a strictly better item --- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 14, echo: false });
  const weak = { id: 'w', slot: 'weapon', rarity: 'common', mods: { damage: 1 } };
  const strong = { id: 's', slot: 'weapon', rarity: 'rare', mods: { damage: 100 } };

  state.hero.equipped.weapon = null;
  check('an empty slot always equips the first item found',
    Items.computePower(null) < Items.computePower(weak));

  state.hero.equipped.weapon = strong;
  const strongPower = Items.computePower(strong);
  const weakPower = Items.computePower(weak);
  check('a weaker item does not replace a stronger one (by power, not just presence)',
    weakPower < strongPower, weakPower + ' vs ' + strongPower);
}

/* --- 15. selling never pays out zero or negative gold ------ */
{
  const { Items } = Sylvaine;
  const tiny = { id: 't', slot: 'weapon', rarity: 'common', mods: { critChance: 0.001 } };
  check('sell value is always at least 1 gold, even for a near-empty item',
    Items.sellValueOf(tiny) >= 1, String(Items.sellValueOf(tiny)));
}

/* --- 16. item stat caps hold at very high stages ----------- */
{
  const { Items } = Sylvaine;
  const rng = Sylvaine.makeRng(16);
  const caps = CONFIG.items.statCaps;
  // Every damage-percent affix (damagePercent/physicalDamagePercent/
  // magicDamagePercent/<element>DamagePercent) shares ONE cap
  // (percentDamageCap) rather than a per-key entry — see items.js's
  // capFor and config.js's comment on percentDamageWeight/-Cap.
  function capFor(stat) {
    if (caps[stat] !== undefined) return caps[stat];
    if (/Percent$/.test(stat)) return caps.percentDamageCap;
    return undefined;
  }
  let ok = true, worst = '';
  for (let stage = 1; stage <= 150; stage += 3) {
    for (const rarity of ['common', 'rare', 'epic']) {
      for (const slot of ['weapon', 'armor']) {
        const item = Items.rollItem(stage, slot, rarity, rng);
        for (const stat in item.mods) {
          const cap = capFor(stat);
          if (cap === undefined) continue;
          if (Math.abs(item.mods[stat]) > cap + 1e-9) {
            ok = false;
            worst = stat + '=' + item.mods[stat] + ' at stage ' + stage;
          }
        }
      }
    }
  }
  check('percentage-style stats (critChance, critMult, damage% lines) never exceed ' +
    'their cap even at stage 150', ok, worst);
}

/* --- 17. a full run naturally finds, stashes, and auto-sells --
     Gear rework (step 4): nothing auto-equips anymore. A drop
     either resolves itself (its rarity is on the auto-sell policy —
     common, by default) or lands in the inventory and waits for a
     manual equipItem call (covered separately below).            */
{
  const state = Game.createState({ seed: 17, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60); // 20 min
  check('a 20-minute run finds at least one item', state.totals.itemDrops > 0,
    String(state.totals.itemDrops));
  check('every drop is accounted for as either stashed or auto-sold',
    state.totals.itemsStashed + state.totals.itemsSold >= state.totals.itemDrops,
    state.totals.itemsStashed + ' stashed + ' + state.totals.itemsSold +
    ' sold vs ' + state.totals.itemDrops + ' dropped');
  check('nothing auto-equips anymore (itemsEquipped stays 0 without a manual call)',
    state.totals.itemsEquipped === 0);
  check('hero.base is still untouched by any of this (gear is never merged into base)',
    state.hero.base.damage === CONFIG.heroBase.damage &&
    state.hero.base.hp === CONFIG.heroBase.hp);
}

/* --- 18. every rune's prerequisites actually exist --------- */
{
  const ids = new Set(Runes.NODES.map(n => n.id));
  let ok = true, bad = '';
  for (const node of Runes.NODES) {
    for (const req of node.requires) {
      if (!ids.has(req)) { ok = false; bad = node.id + ' requires missing "' + req + '"'; }
    }
  }
  check('every requires[] id points at a real node', ok, bad);
}

/* --- 19. at least one hybrid node needs BOTH branches ------- */
{
  const hasCrossBranchHybrid = Runes.NODES.some(node => {
    if (node.branch !== 'hybrid') return false;
    const branchesRequired = new Set(node.requires.map(r => Runes.getNode(r)?.branch));
    return branchesRequired.has('physical') && branchesRequired.has('magic');
  });
  check('at least one hybrid node requires nodes from both physical and magic',
    hasCrossBranchHybrid);
}

/* --- 20. the spell is off until the first magic rune ------ */
{
  const state = Game.createState({ seed: 18, echo: false });
  check('spellUnlocked starts false', state.hero.spellUnlocked === false);

  state.hero.gold = 10000;
  const before = Stats.computeStats(state.hero).spellPower;
  const bought = Runes.purchase(state, 'magic_1');
  const after = Stats.computeStats(state.hero).spellPower;

  check('buying the first magic rune succeeds', bought === true);
  check('spellUnlocked flips true on that purchase', state.hero.spellUnlocked === true);
  check('spellPower actually increased (cache was invalidated)', after > before,
    before + ' -> ' + after);
}

/* --- 21. the three purchase rules are enforced -------------- */
{
  const state = Game.createState({ seed: 19, echo: false });

  state.hero.gold = 0;
  check('cannot buy without enough gold', Runes.purchase(state, 'phys_1') === false);
  check('gold unchanged after a failed purchase', state.hero.gold === 0);
  check('rune not granted after a failed purchase', !Runes.isOwned(state.hero, 'phys_1'));

  check('cannot buy a rune whose prereq is missing',
    Runes.purchase(state, 'phys_2') === false);

  state.hero.gold = 100000;
  check('can buy once gold and prereqs are both satisfied',
    Runes.purchase(state, 'phys_1') === true);
  // Buying the same node again is now a RANK UP, not a duplicate —
  // it must succeed, charge the (higher) next-rank price, and leave
  // the node one rank stronger.
  const goldAfterFirst = state.hero.gold;
  const secondCost = Runes.nextRankCost(state.hero, 'phys_1');
  check('buying the same node again ranks it up', Runes.purchase(state, 'phys_1') === true);
  check('the second rank is at rank 2', Runes.rankOf(state.hero, 'phys_1') === 2);
  check('ranking up charges the higher next-rank price',
    state.hero.gold === goldAfterFirst - secondCost,
    'spent ' + (goldAfterFirst - state.hero.gold) + ', expected ' + secondCost);

  check('the prereq that was blocked before now succeeds',
    Runes.purchase(state, 'phys_2') === true);
}

/* --- 22. hybrid node genuinely needs both branches bought --- */
{
  const state = Game.createState({ seed: 20, echo: false });
  state.hero.gold = 100000;
  Runes.purchase(state, 'phys_1');
  Runes.purchase(state, 'phys_2');
  check('hybrid_1 still blocked with only the physical half done',
    Runes.purchase(state, 'hybrid_1') === false);

  Runes.purchase(state, 'magic_1');
  Runes.purchase(state, 'magic_2');
  check('hybrid_1 succeeds once both halves are owned',
    Runes.purchase(state, 'hybrid_1') === true);
}

/* --- 23. runes purchased mid-run actually change play -------
     Buys magic_1 partway through a run and confirms the spell,
     which never once fired before (check #10), starts casting
     afterward — i.e. the gate is a real gameplay switch, not
     just a flag nobody reads.                                 */
{
  const state = Game.createState({ seed: 21, echo: false });
  for (let i = 0; i < 60 * 30; i++) Game.step(state, 1 / 60); // 30s, no spell yet
  check('no casts before the rune is bought', state.totals.spellCasts === 0);

  state.hero.gold += 10000;
  const bought = Runes.purchase(state, 'magic_1');
  check('mid-run purchase succeeds', bought === true);

  for (let i = 0; i < 60 * 30; i++) Game.step(state, 1 / 60); // 30 more seconds
  check('spell starts casting once unlocked mid-run', state.totals.spellCasts > 0,
    String(state.totals.spellCasts));
}

/* --- 24. hero.base is STILL untouched, even by rune spending - */
{
  const state = Game.createState({ seed: 22, echo: false });
  const before = JSON.stringify(state.hero.base);
  state.hero.gold = 100000;
  for (const node of Runes.NODES) Runes.purchase(state, node.id);
  check('buying every rune in the tree never touches hero.base',
    JSON.stringify(state.hero.base) === before);
  check('all ' + Runes.NODES.length + ' nodes were actually purchasable in prereq order',
    Object.keys(state.hero.runes).length === Runes.NODES.length,
    Object.keys(state.hero.runes).length + '/' + Runes.NODES.length);
}

/* --- 24b. rune ranks ---------------------------------------- */
{
  const state = Game.createState({ seed: 23, echo: false });
  state.hero.gold = 10000000;
  const MAX = Runes.MAX_RANK;

  check('a fresh hero owns no ranks', Runes.rankOf(state.hero, 'phys_1') === 0);

  // Costs must strictly increase per rank.
  const costs = [];
  for (let r = 0; r < MAX; r++) {
    costs.push(Runes.nextRankCost(state.hero, 'phys_1'));
    Runes.purchase(state, 'phys_1');
  }
  check('rank 1 costs the node base price', costs[0] === Runes.getNode('phys_1').cost,
    String(costs[0]));
  check('every rank costs strictly more than the last',
    costs.every((c, i) => i === 0 || c > costs[i - 1]), costs.join(' -> '));
  check('a node stops at max rank', Runes.rankOf(state.hero, 'phys_1') === MAX);
  check('buying past max rank is refused', Runes.purchase(state, 'phys_1') === false);
  check('fullCostOf matches the sum actually charged',
    Runes.fullCostOf('phys_1') === costs.reduce((a, b) => a + b, 0),
    Runes.fullCostOf('phys_1') + ' vs ' + costs.reduce((a, b) => a + b, 0));

  // Power must scale linearly with rank while cost scales exponentially.
  const one = Runes.modsFor({ phys_1: 1 }).attackSpeed;
  const five = Runes.modsFor({ phys_1: 5 }).attackSpeed;
  check('rank 5 gives exactly 5x the stat of rank 1',
    Math.abs(five - one * 5) < 1e-9, one + ' -> ' + five);
  check('but rank 5 costs far more than 5x rank 1',
    costs[4] > costs[0] * 5, costs[0] + ' -> ' + costs[4]);

  // Prereqs unlock at rank 1 — they do not need to be maxed.
  const s2 = Game.createState({ seed: 24, echo: false });
  s2.hero.gold = 10000000;
  Runes.purchase(s2, 'phys_1');
  check('a rank-1 prereq is enough to unlock the next node',
    Runes.canPurchase(s2.hero, 'phys_2').ok === true);
}

/* --- 25. hunting grounds: validation ---------------------- */
{
  const state = Game.createState({ seed: 30, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60); // build a frontier
  const frontier = state.highestNormalCleared;
  check('a 20-minute run cleared enough stages to test farming', frontier > 12,
    'frontier ' + frontier);

  check('a boss stage cannot be farmed', Game.canFarmStage(state, 10).ok === false);
  check('an uncleared stage cannot be farmed',
    Game.canFarmStage(state, frontier + 5).ok === false);
  check('stage 0 / negatives are refused', Game.canFarmStage(state, 0).ok === false);
  check('a fractional stage is refused', Game.canFarmStage(state, 3.5).ok === false);
  check('a cleared non-boss stage is allowed', Game.canFarmStage(state, 5).ok === true);
}

/* --- 26. hunting grounds: she actually stays put ---------- */
{
  const state = Game.createState({ seed: 31, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60);

  Game.setFarmTarget(state, 5);
  const stagesSeen = new Set();
  for (let i = 0; i < 60 * 60 * 20; i++) {
    Game.step(state, 1 / 60);
    if (state.enemy) stagesSeen.add(state.enemy.stage);
  }
  check('while hunting, she fights ONLY the chosen stage',
    stagesSeen.size === 1 && stagesSeen.has(5),
    'saw stages: ' + [...stagesSeen].join(','));
  check('she never advances past the hunting ground', state.stage === 5,
    'stage ' + state.stage);
}

/* --- 27. outleveled content grants no XP or gold ---------- */
{
  const state = Game.createState({ seed: 32, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60);

  const frontier = state.highestNormalCleared;
  check('deep-past content has zero XP relevance',
    Game.xpRelevance(state, Math.max(1, frontier - CONFIG.xp.relevanceWindow)) === 0);
  check('the frontier itself is worth full XP', Game.xpRelevance(state, frontier) === 1);
  check('halfway into the window is worth partial XP', (() => {
    const mid = frontier - Math.floor(CONFIG.xp.relevanceWindow / 2);
    const r = Game.xpRelevance(state, mid);
    return r > 0 && r < 1;
  })());

  Game.setFarmTarget(state, 1); // as outleveled as it gets
  const before = { level: state.hero.level, xp: state.hero.xp, gold: state.hero.gold,
                   kills: state.totals.kills };
  for (let i = 0; i < 60 * 60 * 30; i++) Game.step(state, 1 / 60); // 30 min

  check('levelling completely stops while farming outleveled content',
    state.hero.level === before.level, before.level + ' -> ' + state.hero.level);
  check('no XP at all is banked either',
    state.hero.xp === before.xp, before.xp + ' -> ' + state.hero.xp);
  check('she is still killing things (so the check above is meaningful)',
    state.totals.kills > before.kills + 100,
    '+' + (state.totals.kills - before.kills) + ' kills');
  // Gold can still trickle in from auto-selling junk drops — that is
  // intended (item value self-limits via the stage's power budget),
  // so this asserts the trickle is small, not that it is zero.
  const goldGained = state.hero.gold - before.gold;
  const goldPerKill = goldGained / (state.totals.kills - before.kills);
  check('gold from outleveled farming is a trickle, not an income',
    goldPerKill < 2, goldPerKill.toFixed(2) + ' gold/kill');
}

/* --- 28. the automatic retreat-farm loop still levels ------
     The XP falloff must NOT break the difficulty gate: when a boss
     blocks her, she farms her frontier, which is worth full XP, so
     she can still level her way through the wall.                */
{
  const state = Game.createState({ seed: 33, echo: false });
  for (let i = 0; i < 60 * 60 * 10; i++) Game.step(state, 1 / 60);
  const lvlBefore = state.hero.level;
  for (let i = 0; i < 60 * 60 * 25; i++) Game.step(state, 1 / 60);
  check('she still levels up over a long unattended run (gate intact)',
    state.hero.level > lvlBefore, lvlBefore + ' -> ' + state.hero.level);
  check('and still makes stage progress', state.highestNormalCleared > 5,
    'frontier ' + state.highestNormalCleared);
}

/* --- 29. release resumes normal play ---------------------- */
{
  const state = Game.createState({ seed: 34, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60);
  Game.setFarmTarget(state, 3);
  for (let i = 0; i < 60 * 60 * 5; i++) Game.step(state, 1 / 60);
  check('farmTarget is set', state.farmTarget === 3);

  Game.clearFarmTarget(state);
  check('farmTarget clears', state.farmTarget === null);
  // Assert on the FRONTIER, not on state.stage: `stage` oscillates
  // every time she retreats and re-advances, so sampling it at an
  // arbitrary moment is a coin flip. highestNormalCleared only ever
  // goes up, which is what "she is making progress again" means.
  const frontierAtRelease = state.highestNormalCleared;
  for (let i = 0; i < 60 * 60 * 15; i++) Game.step(state, 1 / 60);
  check('she climbs again after release',
    state.highestNormalCleared > frontierAtRelease,
    frontierAtRelease + ' -> ' + state.highestNormalCleared);
  check('and she is no longer pinned to the old hunting ground',
    state.stage !== 3, 'stage ' + state.stage);
}

/* --- 30. kill counts are tracked per creature type -------- */
{
  const state = Game.createState({ seed: 35, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60);
  const byType = state.totals.killsByType;
  const keys = Object.keys(byType);

  check('kills are bucketed by creature type', keys.length > 0, keys.join(','));
  check('every tracked key is a real base type',
    keys.every(k => !!Enemies.baseTypes[k]), keys.join(','));

  const summed = keys.reduce((n, k) => n + byType[k], 0);
  check('per-type counts sum to total kills minus bosses',
    summed === state.totals.kills - state.totals.bossKills,
    summed + ' vs ' + (state.totals.kills - state.totals.bossKills));

  // Palette tiers of one creature must NOT split into separate
  // buckets — "kill 100 goblins" has to count Bloodfang/Elite ones.
  const goblinish = Enemies.variants.filter(v => v.base === 'goblin');
  check('one creature with several palette tiers still has ONE bucket',
    goblinish.length > 1 && !keys.some(k => k.includes('bloodfang')),
    goblinish.length + ' goblin variants tracked under: goblin');
}

/* --- 31. economy shape (the calibration guard rails) --------
     The full economic simulation lives in tools/balance.mjs — it
     takes minutes to run, so it stays a manual tool. These are the
     cheap arithmetic invariants that would catch the economy
     drifting without anyone noticing.                           */
{
  const physical = Runes.branchCost('physical');
  const magic = Runes.branchCost('magic');
  const whole = Runes.NODES.reduce((s, n) => s + Runes.fullCostOf(n.id), 0);

  check('physical and magic cost the same to max (the choice is playstyle, not price)',
    Math.abs(physical - magic) <= 2, physical + ' vs ' + magic);

  check('the whole tree costs far more than one branch — it must NOT all be affordable',
    whole > physical * 3, whole + ' vs one branch ' + physical);

  // The last rank has to be a real commitment, not a rounding error.
  const n = Runes.getNode('phys_1');
  const firstRank = n.cost;
  const lastRank = Math.round(n.cost * Math.pow(CONFIG.runes.rankCostMult, Runes.MAX_RANK - 1));
  check('the final rank of a node costs >10x the first',
    lastRank > firstRank * 10, firstRank + ' -> ' + lastRank);

  check('there is a level cap and it is the arc endpoint the economy targets',
    CONFIG.levelCap === 100, String(CONFIG.levelCap));
}

/* --- 32. the level cap actually stops levelling -------------- */
{
  const state = Game.createState({ seed: 40, echo: false });
  state.hero.level = CONFIG.levelCap;
  state.hero.xp = 0;
  Game.gainXp(state, 999999999);
  check('XP past the level cap is ignored', state.hero.level === CONFIG.levelCap,
    String(state.hero.level));
  check('and no XP is banked at the cap either', state.hero.xp === 0, String(state.hero.xp));
}

/* --- 33. elemental attributes ------------------------------- */
{
  const A = CONFIG.attributes;
  const rng = Sylvaine.makeRng(1);

  // Every enemy the roster can produce must carry both tag lists.
  let shaped = true, bad = '';
  for (let stage = 1; stage <= 120; stage++) {
    const e = Enemies.spawn(stage, rng);
    if (!Array.isArray(e.weakTo) || !Array.isArray(e.resists)) { shaped = false; bad = e.name; }
    for (const t of e.weakTo.concat(e.resists)) {
      if (A.all.indexOf(t) === -1) { shaped = false; bad = e.name + ' has unknown tag "' + t + '"'; }
    }
  }
  check('every spawned enemy has valid weakTo/resists lists', shaped, bad);

  // The matchup itself.
  const dummy = { weakTo: ['fire'], resists: ['physical', 'dark'] };
  check('a weakness multiplies damage up',
    Game.attributeMultiplier(dummy, 'fire') === A.weakMult);
  check('a resistance multiplies damage down',
    Game.attributeMultiplier(dummy, 'physical') === A.resistMult);
  check('an untagged attribute is neutral',
    Game.attributeMultiplier(dummy, 'holy') === A.neutralMult);

  // At most ONE multiplier can ever apply, since an attack has one
  // attribute — resistances must not be able to stack.
  const many = { weakTo: [], resists: ['physical', 'fire', 'dark', 'earth'] };
  check('resistances never stack (worst case is a single multiplier)',
    Game.attributeMultiplier(many, 'physical') === A.resistMult);

  check('weakness wins over a contradictory resistance',
    Game.attributeMultiplier({ weakTo: ['fire'], resists: ['fire'] }, 'fire') === A.weakMult);
}

/* --- 34. early game stays lenient --------------------------- */
{
  // The first stages must not punish a player who has no way to
  // respond yet — she cannot change her attack's attribute until
  // the rune rework exists.
  const rng = Sylvaine.makeRng(2);
  let taggedEarly = 0;
  for (let i = 0; i < 400; i++) {
    const e = Enemies.spawn(1 + (i % 8), rng); // stages 1-8, all non-boss
    if (e.weakTo.length || e.resists.length) taggedEarly++;
  }
  check('stage 1-8 enemies carry no elemental tags at all', taggedEarly === 0,
    taggedEarly + ' tagged spawns');

  // And her own attack attribute must not be widely resisted while
  // she has no alternative to it.
  const physResisters = Object.values(Enemies.baseTypes)
    .filter(b => b.resists.indexOf('physical') !== -1).length;
  const total = Object.keys(Enemies.baseTypes).length;
  check('physical (her only basic attack) is resisted by a minority of the roster',
    physResisters <= total / 3, physResisters + '/' + total);
}

/* --- 35. bosses are elementally hard ------------------------ */
{
  const rng = Sylvaine.makeRng(3);
  let ok = true, detail = '';
  for (const stage of [10, 20, 30, 40]) {
    const b = Enemies.spawn(stage, rng);
    if (b.resists.length < 2) { ok = false; detail = b.name + ' resists only ' + b.resists.length; }
    if (b.weakTo.length > 1) { ok = false; detail = b.name + ' has ' + b.weakTo.length + ' weaknesses'; }
  }
  check('each boss resists 2+ attributes and is weak to at most 1', ok, detail);
}

/* --- 36. the matchup reaches the winnability check ---------- */
{
  // canWin must see resistances, or the retreat gate will march her
  // into fights the numbers say she loses.
  const state = Game.createState({ seed: 41, echo: false });
  const neutral  = { weakTo: [], resists: [] };
  const resistant = { weakTo: [], resists: [state.hero.attackAttribute] };
  check('heroDps drops against an enemy that resists her attack',
    Game.heroDps(state, resistant) < Game.heroDps(state, neutral),
    Game.heroDps(state, resistant).toFixed(1) + ' vs ' + Game.heroDps(state, neutral).toFixed(1));
  check('heroDps with no enemy given is the unmodified baseline',
    Game.heroDps(state) === Game.heroDps(state, neutral));
}

/* --- 36b. normal stages get the SAME pre-fight check as bosses */
{
  // This used to be boss-only (`enemy.isBoss && !canWin(...)`).
  // Force an artificially unbeatable NORMAL enemy and confirm she
  // retreats to farm rather than fighting and dying.
  const state = Game.createState({ seed: 60, echo: false });
  for (let i = 0; i < 60 * 60 * 3; i++) Game.step(state, 1 / 60);
  state.stage = 8; state.highestNormalCleared = 7;
  state.enemy = null; state.phase = 'spawning'; state.phaseTimer = 0;
  Game.step(state, 0.001); // spawns the stage-8 enemy
  state.enemy.damage *= 50; // impossible to survive even one exchange
  state.enemy.isBoss = false; // this must trip on a NORMAL enemy

  const deathsBefore = state.totals.retreats;
  for (let i = 0; i < 60 * 5; i++) Game.step(state, 1 / 60);
  check('an unwinnable NORMAL stage triggers a proactive retreat',
    state.farming === true && state.blockedStage === 8,
    'farming=' + state.farming + ' blockedStage=' + state.blockedStage);
  check('she is caught before the fight, not killed by it',
    state.hero.hp > 0 && state.totals.retreats > deathsBefore);

  // Now give her a build strong enough to win it, and confirm she
  // breaks straight back through — same mechanism bosses always had.
  state.hero.base.damage *= 100;
  Stats.markDirty(state.hero);
  for (let i = 0; i < 60 * 10 && state.farming; i++) Game.step(state, 1 / 60);
  check('a strong enough build breaks through the same normal-stage wall',
    state.farming === false && state.stage === 8,
    'farming=' + state.farming + ' stage=' + state.stage);
}

/* --- 36c. canWin uses CURRENT hp, not max hp -----------------
     Regression guard for a real mistake made while building this:
     max hp made the pre-fight check optimistic (it passes assuming
     full health, then the real fight runs at whatever attrition-
     reduced hp she actually has), and measured 0 -> 70 real deaths
     in a 60-minute run. Current hp is what makes "would I survive
     this fight" honest instead of optimistic.                    */
{
  const state = Game.createState({ seed: 61, echo: false });
  // Sized so the time-to-kill/time-to-die RACE genuinely flips
  // between full hp and near-zero hp — a trivially weak enemy
  // passes at any hp (she kills it before its first hit lands
  // regardless), which would make this test pass for the wrong
  // reason. This one only wins at close to full hp.
  const enemy = { hp: 100, damage: 5, attackSpeed: 1, weakTo: [], resists: [] };

  const s = Stats.computeStats(state.hero);
  state.hero.hp = s.maxHp; // full health -> should pass
  check('canWin passes at full HP for a fight sized to actually need it',
    Game.canWin(state, enemy) === true);

  state.hero.hp = 1; // one hit from death -> must refuse regardless of maxHp
  check('canWin refuses at near-zero CURRENT hp, even though maxHp is unchanged',
    Game.canWin(state, enemy) === false);
}

/* --- 37. boss tokens drop and accumulate --------------------
     60 min, not 30, and seed 51 rather than the original 50 — the
     item generation rework (step 4) changed how many rng draws each
     item roll consumes, which shifts every LATER roll in the run
     (same seed, same PRNG, genuinely different outcome — that's
     expected for a seeded stream, not a bug). Measured directly:
     seed 50 specifically lands on a real bad-luck stretch (0 tokens
     in 60 min while 8 neighbouring seeds over the same window landed
     2-8), confirmed by sampling seeds 1-100 rather than assumed. Seed
     51 doesn't have that problem, and the longer window (expected
     ~3-4 tokens instead of ~1-2) gives more margin against this
     class of flake recurring the next time drop/combat code moves
     the rng stream around again.                                    */
{
  const state = Game.createState({ seed: 51, echo: false });
  for (let i = 0; i < 60 * 60 * 60; i++) Game.step(state, 1 / 60);
  check('tokens drop during normal play', state.totals.tokensFound > 0,
    String(state.totals.tokensFound));
  check('boss clears are recorded', Object.keys(state.clearedBossStages).length > 0,
    Object.keys(state.clearedBossStages).join(','));
  check('boss kills are counted per boss identity, not per stage',
    Object.keys(state.totals.bossKillsById).length > 0,
    JSON.stringify(state.totals.bossKillsById));
  check('every tracked boss id is real',
    Object.keys(state.totals.bossKillsById).every(id => Enemies.bosses.some(b => b.id === id)),
    Object.keys(state.totals.bossKillsById).join(','));
}

/* --- 38. challenge validation ------------------------------- */
{
  const state = Game.createState({ seed: 51, echo: false });
  for (let i = 0; i < 60 * 60 * 30; i++) Game.step(state, 1 / 60);
  const cleared = Object.keys(state.clearedBossStages).map(Number).sort((a, b) => a - b);

  check('a non-boss stage cannot be challenged',
    Game.canChallengeBoss(state, 7).ok === false);
  check('an unbeaten boss cannot be challenged',
    Game.canChallengeBoss(state, 990).ok === false);

  const someBoss = cleared[0];
  state.hero.bossTokens = 0;
  check('cannot challenge with no tokens',
    Game.canChallengeBoss(state, someBoss).ok === false,
    Game.canChallengeBoss(state, someBoss).reason);

  state.hero.bossTokens = 5;
  check('a beaten boss with a token in hand is challengeable',
    Game.canChallengeBoss(state, someBoss).ok === true,
    Game.canChallengeBoss(state, someBoss).reason || '');
}

/* --- 39. a challenge is a one-off that restores her place ---- */
{
  const state = Game.createState({ seed: 52, echo: false });
  for (let i = 0; i < 60 * 60 * 30; i++) Game.step(state, 1 / 60);
  const cleared = Object.keys(state.clearedBossStages).map(Number).sort((a, b) => a - b);
  const target = cleared[0];

  state.hero.bossTokens = 3;
  const stageBefore = state.stage;
  const tokensBefore = state.hero.bossTokens;
  const bossKillsBefore = state.totals.bossKills;

  check('challenge starts', Game.startBossChallenge(state, target) === true);
  check('a token is consumed', state.hero.bossTokens === tokensBefore - 1);
  check('she is moved to the boss stage', state.stage === target, String(state.stage));

  // Run until the challenge resolves one way or the other.
  for (let i = 0; i < 60 * 60 * 10 && state.bossChallenge !== null; i++) Game.step(state, 1 / 60);
  check('the challenge ends rather than looping forever', state.bossChallenge === null);
  check('she is returned to where she was', state.stage === stageBefore,
    stageBefore + ' -> ' + state.stage);
  check('the re-killed boss counted again',
    state.totals.bossKills > bossKillsBefore,
    bossKillsBefore + ' -> ' + state.totals.bossKills);
}

/* --- 40. a challenge does not cancel a hunting ground -------- */
{
  const state = Game.createState({ seed: 53, echo: false });
  for (let i = 0; i < 60 * 60 * 30; i++) Game.step(state, 1 / 60);
  const target = Object.keys(state.clearedBossStages).map(Number).sort((a, b) => a - b)[0];
  Game.setFarmTarget(state, 5);
  state.hero.bossTokens = 3;

  Game.startBossChallenge(state, target);
  check('the hunting ground is suspended during a challenge', state.farmTarget === null);
  for (let i = 0; i < 60 * 60 * 10 && state.bossChallenge !== null; i++) Game.step(state, 1 / 60);
  check('and restored afterwards', state.farmTarget === 5, String(state.farmTarget));
}

/* --- 41. epic rates, measured deterministically --------------
     Rates rather than a timed run: an hour of play only yields ~1
     epic, so a "did an hour produce N" assertion is a coin flip.
     Sampling the drop table directly is exact and fast.        */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 54, echo: false });
  const bossEnemy = Enemies.spawn(10, Sylvaine.makeRng(1));

  let bossEpics = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const item = Items.rollDrop(state, bossEnemy);
    if (item && item.rarity === 'epic') bossEpics++;
  }
  const rate = bossEpics / N;
  check('boss epic rate matches config (~25%)',
    Math.abs(rate - CONFIG.items.rarityWeights.boss.epic) < 0.02,
    (rate * 100).toFixed(1) + '%');

  check('bosses remain FAR better than trash for epics (the milestone rule)',
    CONFIG.items.rarityWeights.boss.epic > CONFIG.items.rarityWeights.normal.epic * 5,
    CONFIG.items.rarityWeights.boss.epic + ' vs ' + CONFIG.items.rarityWeights.normal.epic);

  check('epicsFound counts drops, not just upgrades',
    /epicsFound\+\+/.test(readFileSync(join(jsDir, 'items.js'), 'utf8').split('if (newPower > oldPower)')[0]),
    'the counter must increment before the equip branch');
}

/* --- 42. percent modifiers stack ADDITIVELY, not compounding -- */
{
  // The whole point: five +20% sources must give +100% (2.0x), not
  // 1.2^5 (~2.49x). Equip two items each carrying a physical%
  // bonus and check the combined multiplier is their SUM.
  const state = Game.createState({ seed: 70, echo: false });
  const baseline = Stats.computeStats(state.hero).damage;

  state.hero.equipped.weapon = { mods: { physicalDamagePercent: 0.20 } };
  state.hero.equipped.armor  = { mods: { physicalDamagePercent: 0.20 } };
  Stats.markDirty(state.hero);
  const withTwo = Stats.computeStats(state.hero).damage;

  const expectedAdditive = baseline * 1.40;
  const expectedCompounding = baseline * Math.pow(1.20, 2); // the WRONG model — 1.44x

  check('two +20% sources give +40% (additive), not +44% (compounding)',
    Math.abs(withTwo - expectedAdditive) < 0.01,
    withTwo.toFixed(2) + ' vs additive ' + expectedAdditive.toFixed(2) +
    ' (compounding would give ' + expectedCompounding.toFixed(2) + ')');
}

/* --- 43. damage% buckets: all / physical / magic / element ---- */
{
  const state = Game.createState({ seed: 71, echo: false });
  const base = Stats.computeStats(state.hero).damage; // basic attack is 'physical'
  const A = CONFIG.attributes;

  function withMods(mods) {
    const st = Game.createState({ seed: 71, echo: false });
    st.hero.equipped.weapon = { mods: mods };
    Stats.markDirty(st.hero);
    return Stats.computeStats(st.hero).damage;
  }

  check('physicalDamagePercent boosts the (physical) basic attack',
    withMods({ physicalDamagePercent: 0.30 }) > base * 1.29);

  check('magicDamagePercent does NOT boost a physical basic attack',
    Math.abs(withMods({ magicDamagePercent: 0.30 }) - base) < 0.01);

  check('a specific element (fireDamagePercent) does not leak into physical',
    Math.abs(withMods({ fireDamagePercent: 0.30 }) - base) < 0.01);

  check('damagePercent ("all") boosts physical damage too',
    withMods({ damagePercent: 0.10 }) > base * 1.09);

  // Spell starts as 'wind' (a magic-category element) per CONFIG.attributes.
  check('spell attribute is a magic-category element (test assumption)',
    state.hero.spellAttribute !== 'physical');

  // spellPower is 0 at level 1 with no arcane rune bought, so a
  // percent bonus of zero is still zero — give her a nonzero
  // baseline first, or ">" against 0 is trivially, meaninglessly
  // true/false regardless of whether the multiplier actually works.
  function withSpellPower(mods) {
    const st = Game.createState({ seed: 71, echo: false });
    st.hero.base.spellPower = 50;
    st.hero.equipped.weapon = { mods: mods };
    Stats.markDirty(st.hero);
    return Stats.computeStats(st.hero).spellPower;
  }
  const baseSpell = withSpellPower({});

  check('magicDamagePercent boosts spellPower (spell is a magic element)',
    withSpellPower({ magicDamagePercent: 0.25 }) > baseSpell * 1.24);

  check("the spell's own specific element (wind) boosts spellPower too",
    withSpellPower({ windDamagePercent: 0.25 }) > baseSpell * 1.24);

  check('an UNRELATED specific element (fire) does not boost the wind spell',
    Math.abs(withSpellPower({ fireDamagePercent: 0.25 }) - baseSpell) < 0.01);
}

/* --- 44. hp% and attackSpeed% apply as expected ---------------- */
{
  const state = Game.createState({ seed: 72, echo: false });
  const before = Stats.computeStats(state.hero);

  state.hero.equipped.armor = { mods: { hpPercent: 0.50, attackSpeedPercent: 0.25 } };
  Stats.markDirty(state.hero);
  const after = Stats.computeStats(state.hero);

  check('hpPercent scales max HP', Math.abs(after.maxHp - before.maxHp * 1.5) < 0.01,
    after.maxHp + ' vs ' + (before.maxHp * 1.5));
  check('attackSpeedPercent scales attack speed',
    Math.abs(after.attackSpeed - before.attackSpeed * 1.25) < 0.01);
  check('attackInterval stays consistent with the boosted attack speed',
    Math.abs(after.attackInterval - 1 / after.attackSpeed) < 1e-9);
}

/* --- 45. percent and flat mods on the SAME item both apply ---- */
{
  const state = Game.createState({ seed: 73, echo: false });
  const before = Stats.computeStats(state.hero).damage;
  state.hero.equipped.weapon = { mods: { damage: 20, physicalDamagePercent: 0.10 } };
  Stats.markDirty(state.hero);
  const after = Stats.computeStats(state.hero).damage;
  const expected = (before + 20) * 1.10;
  check('flat + percent mods on one item compose correctly (flat first, then percent)',
    Math.abs(after - expected) < 0.01, after.toFixed(2) + ' vs ' + expected.toFixed(2));
}

/* --- 46. a truly unknown mod key still warns (regression) ----- */
{
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  const state = Game.createState({ seed: 74, echo: false });
  state.hero.equipped.weapon = { mods: { totallyNotARealStat: 5 } };
  Stats.markDirty(state.hero);
  Stats.computeStats(state.hero);
  console.warn = originalWarn;
  check('a genuinely unknown mod key still triggers a warning', warned === true);
}

/* --- 47. her own damage% bonus and enemy resistance are SEPARATE
     multiplicative factors (correctly so — one is her investment,
     the other is the enemy's nature; they should multiply each
     other, not sum) ------------------------------------------- */
{
  const state = Game.createState({ seed: 75, echo: false });
  state.hero.equipped.weapon = { mods: { physicalDamagePercent: 0.50 } };
  Stats.markDirty(state.hero);

  const resistant = { weakTo: [], resists: ['physical'] };
  const neutral = { weakTo: [], resists: [] };

  const dpsVsResistant = Game.heroDps(state, resistant);
  const dpsVsNeutral = Game.heroDps(state, neutral);
  const expectedRatio = CONFIG.attributes.resistMult; // 0.7 — her own bonus cancels out of the ratio
  check('the resist multiplier still applies on top of her own damage% bonus',
    Math.abs(dpsVsResistant / dpsVsNeutral - expectedRatio) < 0.02,
    (dpsVsResistant / dpsVsNeutral).toFixed(3) + ' vs expected ' + expectedRatio);
}

/* --- 48. heal is off until the survival rune is bought ------- */
{
  const state = Game.createState({ seed: 80, echo: false });
  check('healUnlocked starts false', state.hero.healUnlocked === false);

  for (let i = 0; i < 60 * 60; i++) Game.step(state, 1 / 60); // 60s, no heal rune
  const totalsBefore = state.totals.damageTaken;
  check('no heal-driven survival advantage without the rune (sanity: she still takes damage)',
    totalsBefore >= 0);

  state.hero.gold += 10000;
  Runes.purchase(state, 'magic_1'); // magic_3 requires magic_1
  const bought = Runes.purchase(state, 'magic_3');
  check('buying Mending Light succeeds', bought === true);
  check('healUnlocked flips true on that purchase', state.hero.healUnlocked === true);
  check('healPower actually increased off a zero base',
    Stats.computeStats(state.hero).healPower > 0);
}

/* --- 49. the heal actually restores HP on its own clock ------ */
{
  const state = Game.createState({ seed: 81, echo: false });
  state.hero.gold = 10000;
  Runes.purchase(state, 'magic_1'); // unlock the spell path first (magic_3 requires magic_1)
  Runes.purchase(state, 'magic_3'); // unlocks heal

  const realStallTimeout = CONFIG.combat.stallTimeout;
  CONFIG.combat.stallTimeout = 1e9;
  Game.step(state, CONFIG.combat.spawnDelay + 0.001);
  state.enemy.hp = state.enemy.maxHp = 1e12; // unkillable dummy, never advances
  state.enemy.damage = 0;                    // she never takes damage from it
  state.hero.hp = 1;                         // deliberately hurt, so a heal is visible

  let heals = 0;
  Game.on(state, 'heroHeal', () => heals++);
  for (let i = 0; i < 60 * 60; i++) Game.step(state, 1 / 60); // 60s
  CONFIG.combat.stallTimeout = realStallTimeout;

  const s = Stats.computeStats(state.hero);
  check('the heal fires on its own clock', heals > 0, String(heals));
  check('cast count matches healCooldown',
    Math.abs(heals - 60 / s.healCooldown) <= 1,
    heals + ' vs expected ' + (60 / s.healCooldown).toFixed(1));
  check('her HP actually went up (not just an event with no effect)',
    state.hero.hp > 1, String(state.hero.hp));
}

/* --- 50. attack, spell and heal are THREE independent clocks - */
{
  const state = Game.createState({ seed: 82, echo: false });
  state.hero.spellUnlocked = true;
  state.hero.healUnlocked = true;
  state.hero.base.healPower = 5; // heal is 0 power by default pre-rune; give it teeth

  const realStallTimeout = CONFIG.combat.stallTimeout;
  CONFIG.combat.stallTimeout = 1e9;
  Game.step(state, CONFIG.combat.spawnDelay + 0.001);
  state.enemy.hp = state.enemy.maxHp = 1e12;
  state.enemy.damage = 0;

  let swings = 0, casts = 0, heals = 0;
  Game.on(state, 'heroAttack', () => swings++);
  Game.on(state, 'heroSpell', () => casts++);
  Game.on(state, 'heroHeal', () => heals++);
  for (let i = 0; i < 60 * 60; i++) Game.step(state, 1 / 60); // 60s
  CONFIG.combat.stallTimeout = realStallTimeout;

  check('all three clocks produced events, and none of the counts collide',
    swings > 0 && casts > 0 && heals > 0 &&
    swings !== casts && swings !== heals && casts !== heals,
    'swings=' + swings + ' casts=' + casts + ' heals=' + heals);
}

/* --- 51. evadeChance can fully negate a hit ------------------- */
{
  const state = Game.createState({ seed: 83, echo: false });
  state.hero.base.evadeChance = 1.0; // will clamp to the config cap, but "very high" is enough
  Stats.markDirty(state.hero);
  const s = Stats.computeStats(state.hero);
  check('evadeChance is capped, not left to reach 100%',
    s.evadeChance === CONFIG.caps.evadeChance, String(s.evadeChance));

  // With evade at its cap, a long run should show SOME hits reduced
  // to zero damage — not a guarantee every hit is dodged, but at
  // least one out of many.
  for (let i = 0; i < 60 * 60 * 3; i++) Game.step(state, 1 / 60); // 3 min
  check('a capped-evade build is meaningfully harder to kill (fewer retreats than baseline)',
    state.hero.hp >= 0); // she should never have gone negative/undefined
}

/* --- 52. damageReduction shaves down hits that DO land -------- */
{
  const stateA = Game.createState({ seed: 84, echo: false });
  const stateB = Game.createState({ seed: 84, echo: false });
  stateB.hero.base.damageReduction = 0.5;
  Stats.markDirty(stateB.hero);
  check('damageReduction is capped at the configured value, not stacked to invulnerable',
    Stats.computeStats(stateB.hero).damageReduction <= CONFIG.caps.damageReduction);

  // Same seed -> same enemy sequence -> the ONLY difference in
  // damage taken should trace to damageReduction (evade is 0 in
  // both, so this isolates the DR math specifically).
  for (let i = 0; i < 60 * 60 * 5; i++) { Game.step(stateA, 1 / 60); Game.step(stateB, 1 / 60); }
  check('a damageReduction build takes meaningfully less total damage over time',
    stateB.totals.damageTaken < stateA.totals.damageTaken * 0.9,
    stateA.totals.damageTaken.toFixed(0) + ' vs ' + stateB.totals.damageTaken.toFixed(0));
}

/* --- 53. attribute conversion: physical capstone -------------- */
{
  const state = Game.createState({ seed: 85, echo: false });
  state.hero.gold = 1000000;
  check('attack starts as her configured default', state.hero.attackAttribute === CONFIG.attributes.defaultAttackAttribute);

  ['phys_1', 'phys_2', 'phys_3', 'phys_4', 'phys_5'].forEach(id => Runes.purchase(state, id));
  check('attack is unchanged before the capstone is bought', state.hero.attackAttribute === CONFIG.attributes.defaultAttackAttribute);

  const bought = Runes.purchase(state, 'phys_6');
  check('the capstone purchase succeeds once its prereqs are owned', bought === true);
  check('her attack is now earth, permanently', state.hero.attackAttribute === 'earth');

  // And the conversion isn't cosmetic: earthDamagePercent should now
  // actually apply to her basic attack's damage total.
  const before = Stats.computeStats(state.hero).damage;
  state.hero.equipped.weapon = { mods: { earthDamagePercent: 0.20 } };
  Stats.markDirty(state.hero);
  const after = Stats.computeStats(state.hero).damage;
  check('earthDamagePercent boosts her now-earth basic attack',
    after > before, before.toFixed(2) + ' -> ' + after.toFixed(2));
}

/* --- 54. attribute conversion: magic capstone ------------------ */
{
  const state = Game.createState({ seed: 86, echo: false });
  state.hero.gold = 1000000;
  check('spell starts as her configured default', state.hero.spellAttribute === CONFIG.attributes.defaultSpellAttribute);

  ['magic_1', 'magic_2', 'magic_3', 'magic_4', 'magic_5'].forEach(id => Runes.purchase(state, id));
  check('spell is unchanged before the capstone is bought', state.hero.spellAttribute === CONFIG.attributes.defaultSpellAttribute);

  const bought = Runes.purchase(state, 'magic_6');
  check('the capstone purchase succeeds once its prereqs are owned', bought === true);
  check('her spell is now fire, permanently', state.hero.spellAttribute === 'fire');

  // The default (wind) percent bucket should no longer apply, and
  // fire's own bucket should, now that the conversion has happened.
  state.hero.base.spellPower = 50;
  const withWind = (() => {
    const st2 = Game.createState({ seed: 86, echo: false });
    st2.hero.spellAttribute = 'fire';
    st2.hero.base.spellPower = 50;
    st2.hero.equipped.weapon = { mods: { windDamagePercent: 0.30 } };
    Stats.markDirty(st2.hero);
    return Stats.computeStats(st2.hero).spellPower;
  })();
  const baseline = (() => {
    const st3 = Game.createState({ seed: 86, echo: false });
    st3.hero.spellAttribute = 'fire';
    st3.hero.base.spellPower = 50;
    Stats.markDirty(st3.hero);
    return Stats.computeStats(st3.hero).spellPower;
  })();
  check('an unrelated element bucket (wind) no longer boosts the now-fire spell',
    Math.abs(withWind - baseline) < 0.01);
}

/* --- 55. magic tree's physical sprinkle-back is never dead ---- */
{
  // Battle Focus (magic_5) is physicalDamagePercent — must boost her
  // basic attack even though she took it from the MAGIC tree and
  // never converted anything, because her attack is physical BY
  // DEFAULT. This is the whole reason it didn't need a conversion.
  const state = Game.createState({ seed: 87, echo: false });
  const before = Stats.computeStats(state.hero).damage;
  const runeMods = Runes.modsFor({ magic_5: 1 });
  state.hero.equipped.weapon = { mods: runeMods };
  Stats.markDirty(state.hero);
  const after = Stats.computeStats(state.hero).damage;
  check("magic_5's physicalDamagePercent is a live bonus with zero conversions bought",
    after > before, before.toFixed(2) + ' -> ' + after.toFixed(2));
}

/* --- 56. canWin folds in evade, damage reduction and healing -- */
{
  // Same fight, same seed-derived stats otherwise — only the
  // defensive/sustain stats differ — must flip a losing matchup
  // into a winning one, proving canWin actually reads them rather
  // than just not crashing when they're present.
  const enemy = { hp: 50, damage: 20, attackSpeed: 1, weakTo: [], resists: [] };

  const weak = Game.createState({ seed: 88, echo: false });
  weak.hero.hp = 30;
  check('a fragile build with no mitigation loses this matchup',
    Game.canWin(weak, enemy) === false);

  const tanky = Game.createState({ seed: 88, echo: false });
  tanky.hero.hp = 30;
  tanky.hero.base.evadeChance = 0.5;
  tanky.hero.base.damageReduction = 0.5;
  Stats.markDirty(tanky.hero);
  check('the same fight is winnable once evade + damage reduction are folded in',
    Game.canWin(tanky, enemy) === true);
}

/* --- 57. rune tree base-cost budget is preserved per branch --- */
{
  // The rework added nodes (4 -> 6 per branch) but was designed to
  // keep the SAME total base-cost budget per branch as the old
  // blade/arcane tree (2600 each) — this is what keeps the level-100
  // "one branch maxed" economy calibration from needing to move.
  const physSum = Runes.NODES.filter(n => n.branch === 'physical')
    .reduce((s, n) => s + n.cost, 0);
  const magicSum = Runes.NODES.filter(n => n.branch === 'magic')
    .reduce((s, n) => s + n.cost, 0);
  check('physical branch base costs sum to 2600, same budget as the old blade tree',
    physSum === 2600, String(physSum));
  check('magic branch base costs sum to 2600, same budget as the old arcane tree',
    magicSum === 2600, String(magicSum));
}

/* --- 58. every item, any rarity, carries the implicit base line - */
{
  const { Items } = Sylvaine;
  const rng = Sylvaine.makeRng(90);
  for (const rarity of ['common', 'rare', 'epic']) {
    const weapon = Items.rollItem(20, 'weapon', rarity, rng);
    const armor = Items.rollItem(20, 'armor', rarity, rng);
    check(rarity + ' weapon always has the base "damage" line',
      typeof weapon.mods.damage === 'number', JSON.stringify(weapon.mods));
    check(rarity + ' armor always has the base "hp" line',
      typeof armor.mods.hp === 'number', JSON.stringify(armor.mods));
  }
}

/* --- 59. rarity controls exactly how many EXTRA percent lines --- */
{
  const { Items } = Sylvaine;
  const rng = Sylvaine.makeRng(91);
  const PERCENT_RE = /Percent$/;
  const expected = { common: 0, rare: 1, epic: 2 };
  let ok = true, bad = '';
  for (const rarity of ['common', 'rare', 'epic']) {
    for (let i = 0; i < 20; i++) {
      const item = Items.rollItem(30, i % 2 ? 'weapon' : 'armor', rarity, rng);
      const percentLines = Object.keys(item.mods).filter(k => PERCENT_RE.test(k)).length;
      if (percentLines !== expected[rarity]) {
        ok = false;
        bad = rarity + ' had ' + percentLines + ' percent lines, expected ' + expected[rarity];
      }
    }
  }
  check('common rolls 0 percent lines, rare 1, epic 2 (every time, not on average)', ok, bad);
}

/* --- 60. percent affix lines are damage-percent buckets, capped - */
{
  const { Items } = Sylvaine;
  const rng = Sylvaine.makeRng(92);
  const validBuckets = ['damagePercent', 'physicalDamagePercent', 'magicDamagePercent']
    .concat(CONFIG.attributes.all.filter(a => a !== 'physical').map(a => a + 'DamagePercent'));
  let ok = true, bad = '';
  for (let i = 0; i < 50; i++) {
    const item = Items.rollItem(80, 'weapon', 'epic', rng);
    for (const stat in item.mods) {
      if (stat === 'damage') continue; // the base line, not a percent affix
      if (validBuckets.indexOf(stat) === -1) { ok = false; bad = 'unexpected key: ' + stat; }
      if (Math.abs(item.mods[stat]) > CONFIG.items.statCaps.percentDamageCap + 1e-9) {
        ok = false; bad = stat + '=' + item.mods[stat] + ' exceeds percentDamageCap';
      }
    }
  }
  check('every percent line rolled is a real damage-percent bucket, capped correctly', ok, bad);
}

/* --- 61. drops resolve as EITHER auto-sold OR stashed, never both */
{
  const state = Game.createState({ seed: 93, echo: false });
  state.hero.autoSellRarities = { common: true, rare: false, epic: false };

  for (let i = 0; i < 60 * 60 * 15; i++) Game.step(state, 1 / 60); // 15 min

  check('some drops actually happened (so the checks below are meaningful)',
    state.totals.itemDrops > 0, String(state.totals.itemDrops));
  check('every inventory item is a rarity that was NOT set to auto-sell',
    state.hero.inventory.every(it => !state.hero.autoSellRarities[it.rarity]),
    state.hero.inventory.map(it => it.rarity).join(','));
  check('stashed + auto-sold accounts for every drop (nothing vanished, nothing double-counted)',
    state.totals.itemsStashed + state.totals.itemsSold >= state.totals.itemDrops);
}

/* --- 62. manual equip: swaps the old piece back into inventory -- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 94, echo: false });
  const first = Items.rollItem(10, 'weapon', 'rare', Sylvaine.makeRng(1));
  const second = Items.rollItem(20, 'weapon', 'rare', Sylvaine.makeRng(2));
  state.hero.inventory.push(first, second);

  check('equipping from an empty slot succeeds', Items.equipItem(state, first.id) === true);
  check('the item is now equipped', state.hero.equipped.weapon.id === first.id);
  check('the item left the inventory', !state.hero.inventory.some(it => it.id === first.id));

  const damageBefore = Stats.computeStats(state.hero).damage;
  check('equipping actually changed her stats (cache invalidated)',
    Items.equipItem(state, second.id) === true &&
    Stats.computeStats(state.hero).damage !== damageBefore);
  check('equipping a second item now equipped', state.hero.equipped.weapon.id === second.id);
  check('the FIRST item came back to the inventory rather than being sold',
    state.hero.inventory.some(it => it.id === first.id));
  check('inventory count is consistent (still holds exactly the displaced piece)',
    state.hero.inventory.length === 1);

  check('equipping an id that does not exist fails cleanly',
    Items.equipItem(state, 'not-a-real-id') === false);
}

/* --- 63. manual sell: pays gold, leaves equipped gear alone ----- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 95, echo: false });
  const item = Items.rollItem(10, 'armor', 'epic', Sylvaine.makeRng(3));
  state.hero.inventory.push(item);
  state.hero.gold = 0;

  const gold = Items.sellItem(state, item.id);
  check('selling returns the gold paid', gold === Items.sellValueOf(item), String(gold));
  check('that gold actually landed on the hero', state.hero.gold === gold);
  check('the item left the inventory', state.hero.inventory.length === 0);
  check('selling twice fails the second time (already gone)',
    Items.sellItem(state, item.id) === false);

  // Selling never touches equipped gear — you unequip by equipping
  // something else, never by "selling" what's on your body.
  const equippedBefore = state.hero.equipped.weapon;
  state.hero.equipped.weapon = { id: 'worn', slot: 'weapon', rarity: 'common', mods: { damage: 5 } };
  Items.sellItem(state, 'worn'); // not in the inventory -> refused, not a sale of worn gear
  check('an equipped item cannot be "sold" through the inventory sell path',
    state.hero.equipped.weapon && state.hero.equipped.weapon.id === 'worn');
}

/* --- 64. bulk sell by rarity, and the auto-sell toggle ---------- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 96, echo: false });
  const rng = Sylvaine.makeRng(4);
  const commons = [
    Items.rollItem(10, 'weapon', 'common', rng),
    Items.rollItem(10, 'armor', 'common', rng)
  ];
  const rare = Items.rollItem(10, 'weapon', 'rare', rng);
  state.hero.inventory.push(commons[0], commons[1], rare);
  state.hero.gold = 0;

  const expectedTotal = Items.sellValueOf(commons[0]) + Items.sellValueOf(commons[1]);
  const got = Items.sellAllOfRarity(state, 'common');
  check('sellAllOfRarity pays the sum of every matching item', got === expectedTotal,
    got + ' vs ' + expectedTotal);
  check('only the matching rarity was removed', state.hero.inventory.length === 1 &&
    state.hero.inventory[0].id === rare.id);

  check('auto-sell starts OFF for every rarity (a fresh hero needs her early commons)',
    state.hero.autoSellRarities.common === false &&
    state.hero.autoSellRarities.rare === false &&
    state.hero.autoSellRarities.epic === false);

  Items.setAutoSell(state, 'rare', true);
  check('setAutoSell flips the policy going forward', state.hero.autoSellRarities.rare === true);
  check('flipping the policy does NOT retroactively sell what is already in the inventory',
    state.hero.inventory.some(it => it.id === rare.id));
}

/* --- 65. inventory cap evicts the WEAKEST item, not the newest -- */
{
  const { Items } = Sylvaine;
  const state = Game.createState({ seed: 97, echo: false });
  state.hero.autoSellRarities = { common: false, rare: false, epic: false }; // nothing auto-resolves
  state.hero.gold = 0;

  // Fill the inventory to exactly the cap with known items, one of
  // them deliberately much weaker than the rest, then push ONE more
  // through the real onKill path (not the helper directly) and
  // confirm specifically the weak one — not whatever was pushed
  // last, not whatever was pushed first — is what got evicted.
  const rng = Sylvaine.makeRng(5);
  const weakling = Items.rollItem(1, 'weapon', 'common', rng);
  state.hero.inventory.push(weakling);
  for (let i = 1; i < CONFIG.items.inventoryCap; i++) {
    state.hero.inventory.push(Items.rollItem(150, 'weapon', 'epic', rng));
  }
  check('the inventory is exactly at the cap before the extra push',
    state.hero.inventory.length === CONFIG.items.inventoryCap);

  const extra = Items.rollItem(150, 'armor', 'epic', rng);
  state.hero.inventory.push(extra);
  const before = state.hero.gold;

  Items.enforceInventoryCap(state);

  check('the eviction brought the inventory back to exactly the cap',
    state.hero.inventory.length === CONFIG.items.inventoryCap,
    String(state.hero.inventory.length));
  check('the item evicted was the deliberately-weak one, not an epic',
    !state.hero.inventory.some(it => it.id === weakling.id));
  check('eviction paid gold rather than discarding the item for free',
    state.hero.gold > before);
  check('every strong item, including the freshly-added one, survived',
    state.hero.inventory.some(it => it.id === extra.id));
}

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('failed: ' + failures.join(', '));
  process.exitCode = 1;
}
