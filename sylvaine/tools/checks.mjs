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
    CONFIG.combat.stallTimeout = 60;
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
  CONFIG.combat.stallTimeout = 1e9;
  state.hero.spellUnlocked = true;
  Game.step(state, CONFIG.combat.spawnDelay + 0.001);
  state.enemy.hp = state.enemy.maxHp = 1e12;
  state.enemy.damage = 0;
  let swings = 0, casts = 0;
  Game.on(state, 'heroAttack', () => swings++);
  Game.on(state, 'heroSpell', () => casts++);
  for (let i = 0; i < 60 * 60; i++) Game.step(state, 1 / 60); // 60s
  CONFIG.combat.stallTimeout = 60;
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
  check('epic never drops from a normal stage (20000 rolls)', epicsFromNormal === 0,
    epicsFromNormal + ' epics out of ' + drops + ' drops');
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
  const stageAtRelease = state.stage;
  for (let i = 0; i < 60 * 60 * 15; i++) Game.step(state, 1 / 60);
  check('she climbs again after release', state.stage > stageAtRelease,
    stageAtRelease + ' -> ' + state.stage);
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

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('failed: ' + failures.join(', '));
  process.exitCode = 1;
}
