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
for (const f of ['config.js', 'rng.js', 'log.js', 'stats.js', 'enemies.js', 'game.js']) {
  new Function(readFileSync(join(jsDir, f), 'utf8')).call(globalThis);
}
const { Sylvaine } = globalThis;
const { Game, Stats, Enemies, CONFIG } = Sylvaine;

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

/* --- 6. enemy variants reuse base sprites ---------------- */
{
  const sprites = new Set(Object.values(Enemies.baseTypes).map(b => b.sprite));
  let ok = true;
  for (const v of Enemies.variants) {
    if (!Enemies.baseTypes[v.base]) ok = false;
    if (!Enemies.treatments[v.treatment]) ok = false;
  }
  check('every variant points at a real base type and treatment', ok);
  check('base sprite count is small (' + sprites.size + ' files for ' +
    Enemies.variants.length + ' variants)', sprites.size <= 6);
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

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('failed: ' + failures.join(', '));
  process.exitCode = 1;
}
