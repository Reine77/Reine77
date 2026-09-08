/* =============================================================
   tools/simulate.mjs — run the game in Node, no browser.
   -------------------------------------------------------------
   Usage:
     node tools/simulate.mjs                 # 10 minutes, quiet
     node tools/simulate.mjs --minutes 60    # 1 hour
     node tools/simulate.mjs --seed 7 --verbose
     node tools/simulate.mjs --spell         # force the spell on
     node tools/simulate.mjs --hz 144        # check framerate independence

   WHY this exists: "I want to verify the numbers behave BEFORE
   anything is rendered" is exactly what this does. It loads the
   same js/ files the browser loads and plays hours of game in
   under a second. Because the RNG is seeded, the same seed
   always gives the same run, so when you change a config value
   you see the effect of that change and nothing else.

   HOW it loads classic scripts: the game files are plain
   scripts that attach to a global, not ES modules. So we read
   them as text and run them with `new Function`, handing each
   one `globalThis`. That is the same thing a browser does with
   a <script> tag — just done by hand.
   ============================================================= */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const jsDir = join(here, '..', 'js');

// Same order as index.html. Note main.js is NOT loaded — it is
// the browser entry point and would start a rAF loop.
const files = ['config.js', 'rng.js', 'log.js', 'stats.js', 'enemies.js', 'game.js'];
for (const file of files) {
  const src = readFileSync(join(jsDir, file), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(src).call(globalThis);
}

const { Sylvaine } = globalThis;

/* ---- arguments ---- */
const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return isNaN(Number(next)) ? next : Number(next);
}

const minutes = Number(flag('minutes', 10));
const seed    = Number(flag('seed', 12345));
const hz      = Number(flag('hz', 60));
const verbose = flag('verbose', false) === true;
const spell   = flag('spell', false) === true;

Sylvaine.CONFIG.debug.logEverySwing = verbose;

const state = Sylvaine.Game.createState({ seed, echo: true });
if (spell) {
  state.hero.spellUnlocked = true;
  state.hero.timers.spell = Sylvaine.Stats.computeStats(state.hero).spellCooldown;
}

/* ---- run ---- */
const dt = 1 / hz;
const steps = Math.round(minutes * 60 * hz);

console.log(`--- simulating ${minutes} min at ${hz}Hz, seed ${seed}${spell ? ', spell on' : ''} ---`);
for (let i = 0; i < steps; i++) Sylvaine.Game.step(state, dt);

/* ---- summary ---- */
const s = Sylvaine.Stats.computeStats(state.hero);
console.log('\n--- after ' + Math.round(state.time) + 's of game time ---');
console.log({
  stage: state.stage,
  farming: state.farming,
  blockedStage: state.blockedStage,
  highestNormalCleared: state.highestNormalCleared,
  level: state.hero.level,
  gold: Math.round(state.hero.gold),
  hp: Math.round(state.hero.hp) + '/' + Math.round(s.maxHp),
  damage: Number(s.damage.toFixed(1)),
  attackSpeed: Number(s.attackSpeed.toFixed(2)),
  critChance: Number((s.critChance * 100).toFixed(1)) + '%',
  expectedDps: Math.round(Sylvaine.Game.heroDps(state)),
  ...state.totals
});
