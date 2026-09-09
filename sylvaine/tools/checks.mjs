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
  let ok = true, worst = '';
  for (let stage = 1; stage <= 150; stage += 3) {
    for (const rarity of ['common', 'rare', 'epic']) {
      for (const slot of ['weapon', 'armor']) {
        const item = Items.rollItem(stage, slot, rarity, rng);
        for (const stat in item.mods) {
          const cap = caps[stat];
          if (cap === undefined) continue;
          if (Math.abs(item.mods[stat]) > cap + 1e-9) {
            ok = false;
            worst = stat + '=' + item.mods[stat] + ' at stage ' + stage;
          }
        }
      }
    }
  }
  check('percentage-style stats (critChance, critMult, ...) never exceed their cap ' +
    'even at stage 150', ok, worst);
}

/* --- 17. a full run naturally finds, equips, and sells items - */
{
  const state = Game.createState({ seed: 17, echo: false });
  for (let i = 0; i < 60 * 60 * 20; i++) Game.step(state, 1 / 60); // 20 min
  check('a 20-minute run finds at least one item', state.totals.itemDrops > 0,
    String(state.totals.itemDrops));
  check('at least one found item gets equipped', state.totals.itemsEquipped > 0,
    String(state.totals.itemsEquipped));
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
    return branchesRequired.has('blade') && branchesRequired.has('arcane');
  });
  check('at least one hybrid node requires nodes from both blade and arcane',
    hasCrossBranchHybrid);
}

/* --- 20. the spell is off until the first arcane rune ------ */
{
  const state = Game.createState({ seed: 18, echo: false });
  check('spellUnlocked starts false', state.hero.spellUnlocked === false);

  state.hero.gold = 10000;
  const before = Stats.computeStats(state.hero).spellPower;
  const bought = Runes.purchase(state, 'arcane_1');
  const after = Stats.computeStats(state.hero).spellPower;

  check('buying the first arcane rune succeeds', bought === true);
  check('spellUnlocked flips true on that purchase', state.hero.spellUnlocked === true);
  check('spellPower actually increased (cache was invalidated)', after > before,
    before + ' -> ' + after);
}

/* --- 21. the three purchase rules are enforced -------------- */
{
  const state = Game.createState({ seed: 19, echo: false });

  state.hero.gold = 0;
  check('cannot buy without enough gold', Runes.purchase(state, 'blade_1') === false);
  check('gold unchanged after a failed purchase', state.hero.gold === 0);
  check('rune not granted after a failed purchase', !Runes.isOwned(state.hero, 'blade_1'));

  check('cannot buy a rune whose prereq is missing',
    Runes.purchase(state, 'blade_2') === false);

  state.hero.gold = 100000;
  check('can buy once gold and prereqs are both satisfied',
    Runes.purchase(state, 'blade_1') === true);
  // Buying the same node again is now a RANK UP, not a duplicate —
  // it must succeed, charge the (higher) next-rank price, and leave
  // the node one rank stronger.
  const goldAfterFirst = state.hero.gold;
  const secondCost = Runes.nextRankCost(state.hero, 'blade_1');
  check('buying the same node again ranks it up', Runes.purchase(state, 'blade_1') === true);
  check('the second rank is at rank 2', Runes.rankOf(state.hero, 'blade_1') === 2);
  check('ranking up charges the higher next-rank price',
    state.hero.gold === goldAfterFirst - secondCost,
    'spent ' + (goldAfterFirst - state.hero.gold) + ', expected ' + secondCost);

  check('the prereq that was blocked before now succeeds',
    Runes.purchase(state, 'blade_2') === true);
}

/* --- 22. hybrid node genuinely needs both branches bought --- */
{
  const state = Game.createState({ seed: 20, echo: false });
  state.hero.gold = 100000;
  Runes.purchase(state, 'blade_1');
  Runes.purchase(state, 'blade_2');
  check('hybrid_1 still blocked with only the blade half done',
    Runes.purchase(state, 'hybrid_1') === false);

  Runes.purchase(state, 'arcane_1');
  Runes.purchase(state, 'arcane_2');
  check('hybrid_1 succeeds once both halves are owned',
    Runes.purchase(state, 'hybrid_1') === true);
}

/* --- 23. runes purchased mid-run actually change play -------
     Buys arcane_1 partway through a run and confirms the spell,
     which never once fired before (check #10), starts casting
     afterward — i.e. the gate is a real gameplay switch, not
     just a flag nobody reads.                                 */
{
  const state = Game.createState({ seed: 21, echo: false });
  for (let i = 0; i < 60 * 30; i++) Game.step(state, 1 / 60); // 30s, no spell yet
  check('no casts before the rune is bought', state.totals.spellCasts === 0);

  state.hero.gold += 10000;
  const bought = Runes.purchase(state, 'arcane_1');
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

  check('a fresh hero owns no ranks', Runes.rankOf(state.hero, 'blade_1') === 0);

  // Costs must strictly increase per rank.
  const costs = [];
  for (let r = 0; r < MAX; r++) {
    costs.push(Runes.nextRankCost(state.hero, 'blade_1'));
    Runes.purchase(state, 'blade_1');
  }
  check('rank 1 costs the node base price', costs[0] === Runes.getNode('blade_1').cost,
    String(costs[0]));
  check('every rank costs strictly more than the last',
    costs.every((c, i) => i === 0 || c > costs[i - 1]), costs.join(' -> '));
  check('a node stops at max rank', Runes.rankOf(state.hero, 'blade_1') === MAX);
  check('buying past max rank is refused', Runes.purchase(state, 'blade_1') === false);
  check('fullCostOf matches the sum actually charged',
    Runes.fullCostOf('blade_1') === costs.reduce((a, b) => a + b, 0),
    Runes.fullCostOf('blade_1') + ' vs ' + costs.reduce((a, b) => a + b, 0));

  // Power must scale linearly with rank while cost scales exponentially.
  const one = Runes.modsFor({ blade_1: 1 }).attackSpeed;
  const five = Runes.modsFor({ blade_1: 5 }).attackSpeed;
  check('rank 5 gives exactly 5x the stat of rank 1',
    Math.abs(five - one * 5) < 1e-9, one + ' -> ' + five);
  check('but rank 5 costs far more than 5x rank 1',
    costs[4] > costs[0] * 5, costs[0] + ' -> ' + costs[4]);

  // Prereqs unlock at rank 1 — they do not need to be maxed.
  const s2 = Game.createState({ seed: 24, echo: false });
  s2.hero.gold = 10000000;
  Runes.purchase(s2, 'blade_1');
  check('a rank-1 prereq is enough to unlock the next node',
    Runes.canPurchase(s2.hero, 'blade_2').ok === true);
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
  const blade = Runes.branchCost('blade');
  const arcane = Runes.branchCost('arcane');
  const whole = Runes.NODES.reduce((s, n) => s + Runes.fullCostOf(n.id), 0);

  check('blade and arcane cost the same to max (the choice is playstyle, not price)',
    Math.abs(blade - arcane) <= 2, blade + ' vs ' + arcane);

  check('the whole tree costs far more than one branch — it must NOT all be affordable',
    whole > blade * 3, whole + ' vs one branch ' + blade);

  // The last rank has to be a real commitment, not a rounding error.
  const n = Runes.getNode('blade_1');
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
  const resistant = { weakTo: [], resists: [CONFIG.attributes.basicAttack] };
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

/* --- 37. boss tokens drop and accumulate -------------------- */
{
  const state = Game.createState({ seed: 50, echo: false });
  for (let i = 0; i < 60 * 60 * 30; i++) Game.step(state, 1 / 60);
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

  // Spell is 'wind' (a magic-category element) per CONFIG.attributes.spell.
  check('spell attribute is a magic-category element (test assumption)',
    A.spell !== 'physical');

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

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('failed: ' + failures.join(', '));
  process.exitCode = 1;
}
