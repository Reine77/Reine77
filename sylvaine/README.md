# Sylvaine — Idle RPG Auto-Battler

Vanilla HTML/CSS/JS. No frameworks, no build step, no dependencies.

## Phase 1 (current) — game logic only, no UI

**In the browser:** open `sylvaine/index.html` directly, then open the console (F12).
The page itself is deliberately almost empty; the game reports to the console.

Debug commands available on `window.S`:

| command | what it does |
| --- | --- |
| `S.help()` | list these |
| `S.state` | the entire game state object |
| `S.stats()` | her computed final stats |
| `S.dps()` | expected DPS, crits averaged in |
| `S.pause()` / `S.resume()` | stop / start the loop |
| `S.fast(600)` | simulate 600 seconds instantly |
| `S.verbose(true)` | log every swing (loud) |
| `S.unlockSpell()` | debug-only; Phase 3 does it properly |
| `S.report()` | totals table |
| `S.reset(seed)` | start over with a given seed |

**In Node (faster for balance work):**

```
cd sylvaine
node tools/simulate.mjs --minutes 60          # play an hour in ~a second
node tools/simulate.mjs --minutes 5 --verbose # every swing
node tools/simulate.mjs --seed 7 --spell      # different run, spell forced on
node tools/simulate.mjs --minutes 60 --hz 144 # framerate comparison
node tools/checks.mjs                         # 23 rule assertions
```

## Files

```
index.html          load order + why these are not ES modules
js/config.js        every tuning number, no logic
js/rng.js           seedable RNG, so runs are reproducible
js/log.js           combat log (console now, DOM panel in Phase 4)
js/stats.js         computeStats + the dirty-flag cache
js/enemies.js       roster, palette-swap variants, stage curve
js/game.js          all the rules; step(state, dt) is the only entry point
js/loop.js          requestAnimationFrame + the dt clamp
js/main.js          browser entry point and the S.* debug API
tools/simulate.mjs  headless runner
tools/checks.mjs    sanity assertions
assets/sprites/     (Phase 5) enemy + hero PNGs
assets/intro/       (Phase 10) the five intro stills
```

## Three architectural decisions worth knowing

**1. Classic scripts, not ES modules.** `import`/`export` cannot be used here.
Browsers apply CORS to module fetches, and a file opened from disk has no
origin, so `<script type="module">` fails outright over `file://`. Since "no
build step, open index.html directly" is a hard requirement, each file wraps
itself in an IIFE and attaches to one shared global, `window.Sylvaine`. The
`<script>` order in `index.html` is the dependency order. You still get real
file separation; you just get it without a module loader.

**2. `hero.base` is never written to.** Gear and runes are modifiers layered on
top, and `computeStats` rebuilds the total from scratch every time it runs.
If equipping a sword did `base.damage += 5`, unequipping would have to subtract
exactly 5 forever — and any double-apply or rounding bug would permanently
corrupt the base value with no way to detect it. Rebuilding from scratch means
a bug can affect at most one recompute.

**3. `step(state, dt)` knows nothing about the screen or the clock.** The
browser feeds it real frame times; `tools/simulate.mjs` feeds it a fixed 1/60
and plays an hour instantly. Same code path both times, which is the only
reason the numbers are checkable before anything is rendered.

## What Phase 1 verified

- Timers are framerate-independent: 30 / 60 / 61 / 144 / 240 Hz all produce the
  same swing count for the same game time (±1 from a swing landing on a
  boundary). Both timers use `while (timer <= 0)` rather than `if`, so a long
  frame resolves every swing that should have happened instead of dropping the
  extras.
- `dt` is clamped to 0.25s in `loop.js`. A backgrounded tab therefore pauses
  rather than resolving ten minutes of combat in one frame. Real offline
  progress is Phase 8's job and will be computed deliberately from a stored
  timestamp.
- Boss stages land on exactly every 10th stage, at ~4x the normal HP curve, and
  carry their own sprite.
- The retreat gate works: an unwinnable boss sends her back to farm the last
  cleared normal stage, and each farm kill re-tests whether the blocked stage is
  now possible. There is no game-over and no permadeath.
- Enemy data is 6 base sprites driving 20 variants via palette treatments, plus
  4 boss sprites cycled with treatments for the endless tail.

## Known balance state (expected, not a bug)

Pacing was retuned after first review: the original numbers put the first
boss 34 *seconds* into the game, which reads more like a speedrun than an
idle game. `enemy.hp.base` went from 40 to 150 to stretch fight length, with
`enemy.damage.base` scaled down by the same ~3.75x factor to hold the
attrition curve steady — HP alone controls pacing, damage alone controls
difficulty, and they have to move together or "slower" quietly becomes
"harder" instead. `combat.stallTimeout` also had to move with it (60s to
240s): a legitimately winnable boss fight can now take 60-90s, which used to
trip the stall-safety net meant for stuck fights.

With the current numbers, seed 12345 reaches the first boss at ~2 minutes
(rejected, not ready), farms up, and beats it around the 5-minute mark. A
30-minute run reaches roughly stage 19, level 17, ~3k gold. Gold is still
piling up largely unspent because Phase 1 has only *one* of the three power
sources implemented:

1. **Levels** (XP) — implemented, deliberately slow.
2. **Runes** (gold) — Phase 3. This is why ~43k gold is piling up unspent.
3. **Equipment** (drops) — Phase 2, the source of the big non-linear jumps.

Enemy HP grows 13% per stage (exponential) while levels grow her damage
linearly, so walls are inevitable and intentional — they are what makes gold
worth spending. Expect to re-tune `config.js` once Phases 2 and 3 give her the
other two channels; the numbers here are a baseline, not a final balance.

## Phase plan

- [x] **1** Game logic, console only
- [ ] **2** Items, `computeStats` aggregation, drop table, auto-equip/auto-sell
- [ ] **3** Rune tree data, purchase validation, spell-unlock gate
- [ ] **4** Minimal DOM UI
- [ ] **5** Sprites: hero state swaps, sword trail, enemy hit-flash/death CSS
- [ ] **6** Rune tree UI
- [ ] **7** Juice: floating numbers, HP bar lerp, crit flash, drop toasts
- [ ] **8** Save/load + offline progress from a stored timestamp
- [ ] **9** Whispers log (boss-defeat story fragments)
- [ ] **10** Intro sequence (5 stills, click to advance, skippable)
