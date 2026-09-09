/* =============================================================
   tools/balance.mjs — economy calibration harness.
   -------------------------------------------------------------
   simulate.mjs plays the game but never SPENDS gold, so it has
   always been measuring a hero with an empty rune tree — fine for
   checking combat pacing, useless for checking the economy.

   This runs the same game with a simple buying policy standing in
   for the player, so the numbers it reports are the ones a real
   playthrough would see.

   Usage:
     node tools/balance.mjs                     # default: max blade
     node tools/balance.mjs --branch arcane
     node tools/balance.mjs --days 5 --hz 30
     node tools/balance.mjs --nobuy             # spend nothing

   The calibration target (see README): reaching the level cap
   should afford ONE branch maxed with a little left over — not
   the whole tree. This prints exactly that comparison.
   ============================================================= */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const jsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
for (const f of ['config.js', 'rng.js', 'log.js', 'stats.js', 'items.js',
                 'runes.js', 'enemies.js', 'game.js']) {
  new Function(readFileSync(join(jsDir, f), 'utf8')).call(globalThis);
}
const { Sylvaine } = globalThis;
const { Game, Runes, CONFIG } = Sylvaine;

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return isNaN(Number(next)) ? next : Number(next);
}

const branch  = String(flag('branch', 'blade'));
const days    = Number(flag('days', 4));
const hz      = Number(flag('hz', 30));
const seed    = Number(flag('seed', 777));
const noBuy   = flag('nobuy', false) === true;
const quiet   = flag('quiet', false) === true;

/* ---- the stand-in player ------------------------------------
   Buys the cheapest available rank inside the target branch, as
   soon as it can afford it. Deliberately simple: a real player
   optimises better, so this is a conservative floor rather than a
   best case.

   `arcane_1` is bought regardless of branch when the target is
   arcane; for a blade run nothing outside blade is ever bought,
   which is exactly the "max ONE tree" case being calibrated.  */
function buyStep(state) {
  if (noBuy) return;
  for (;;) {
    const options = Runes.NODES
      .filter(n => n.branch === branch)
      .filter(n => !Runes.isMaxed(state.hero, n.id))
      .filter(n => Runes.prereqsMet(state.hero, n))
      .map(n => ({ id: n.id, cost: Runes.nextRankCost(state.hero, n.id) }))
      .sort((a, b) => a.cost - b.cost);

    if (!options.length || options[0].cost > state.hero.gold) return;
    if (!Runes.purchase(state, options[0].id)) return;
  }
}

/* ---- run ---------------------------------------------------- */
const state = Game.createState({ seed, echo: false });
const dt = 1 / hz;
const totalSteps = Math.round(days * 24 * 3600 * hz);
const cap = CONFIG.levelCap || Infinity;

let lifetimeGold = 0;
let lastGold = state.hero.gold;
let reachedCapAt = null;
let goldAtCap = null;
const milestones = [];
const wantLevels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
let nextMilestone = 0;

for (let i = 0; i < totalSteps; i++) {
  Game.step(state, dt);

  // Track gold EARNED (not held), since spending hides income.
  if (state.hero.gold > lastGold) lifetimeGold += state.hero.gold - lastGold;
  lastGold = state.hero.gold;

  if (i % 20 === 0) { buyStep(state); lastGold = state.hero.gold; }

  while (nextMilestone < wantLevels.length && state.hero.level >= wantLevels[nextMilestone]) {
    milestones.push({
      level: wantLevels[nextMilestone],
      hours: +(state.time / 3600).toFixed(2),
      stage: state.highestNormalCleared,
      goldEarned: Math.round(lifetimeGold),
      ranks: Runes.totalRanks(state.hero)
    });
    nextMilestone++;
  }
  if (reachedCapAt === null && state.hero.level >= cap) {
    reachedCapAt = state.time;
    goldAtCap = lifetimeGold;
  }
}

/* ---- report -------------------------------------------------- */
const branchCosts = {
  blade: Runes.branchCost('blade'),
  arcane: Runes.branchCost('arcane'),
  hybrid: Runes.branchCost('hybrid')
};
const wholeTree = Runes.NODES.reduce((s, n) => s + Runes.fullCostOf(n.id), 0);

if (!quiet) {
  console.log(`\n=== ${days}d @ ${hz}Hz, seed ${seed}, policy: ` +
    (noBuy ? 'spend nothing' : `max the ${branch} branch`) + ' ===');
  console.log('\nlevel   hours   stage   gold earned   ranks');
  for (const m of milestones) {
    console.log(
      String(m.level).padStart(5),
      String(m.hours).padStart(7),
      String(m.stage).padStart(7),
      String(m.goldEarned).padStart(13),
      String(m.ranks).padStart(7));
  }
}

const finalLevel = state.hero.level;
const spent = Math.round(lifetimeGold - state.hero.gold);
console.log('\n--- end of run ---');
console.log({
  level: finalLevel + (cap !== Infinity ? '/' + cap : ''),
  reachedCap: reachedCapAt !== null ? +(reachedCapAt / 3600).toFixed(2) + 'h' : 'NO',
  hoursSimulated: +(state.time / 3600).toFixed(1),
  stage: state.highestNormalCleared,
  goldEarnedLifetime: Math.round(lifetimeGold),
  goldSpentOnRunes: spent,
  goldLeftover: Math.round(state.hero.gold),
  ranksBought: Runes.totalRanks(state.hero) + '/' + (Runes.NODES.length * Runes.MAX_RANK)
});

console.log('\n--- calibration target ---');
console.log('cost to max one branch:', branchCosts);
console.log('cost to max WHOLE tree:', wholeTree);
const cheapest = Math.min(branchCosts.blade, branchCosts.arcane);
if (goldAtCap === null) {
  console.log('never reached the level cap — cannot measure the target ratio');
} else {
  console.log('gold earned by the time level ' + cap + ' was reached:', Math.round(goldAtCap));
  console.log(`  / cheapest branch = ${(goldAtCap / cheapest).toFixed(2)}x ` +
    `(target ~1.1-1.3x: one branch maxed plus a little)`);
  console.log(`  / whole tree      = ${(goldAtCap / wholeTree).toFixed(2)}x ` +
    `(must stay well under 1.0 — the tree must NOT be fully affordable)`);
}
console.log('(gold kept flowing after the cap — lifetime total was ' +
  Math.round(lifetimeGold) + ' by the end of the run; that surplus is the ' +
  'endless tail, not part of the calibrated arc.)');
