# Sylvaine — Idle RPG Auto-Battler

Vanilla HTML/CSS/JS. No frameworks, no build step, no dependencies.

## Phase 5 (current) — sprite integration

**In the browser:** open `sylvaine/index.html` directly. Same VS-style split
arena as Phase 4, now with real `<img>` sprite layers wired up for the hero's
4 states and every enemy — see `assets/sprites/README.md` for exact filenames
if you're dropping art in. No file there yet? Everything still shows the
Phase 4 placeholder boxes/text, cleanly, not a broken-image icon. The console
(F12) still works exactly as before — every `S.*` debug command is still there.

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
| `S.report()` | totals table (now includes equipped gear + item stats) |
| `S.reset(seed)` | start over with a given seed |
| `S.inventory()` | what's equipped right now |
| `S.giveItem('weapon'\|'armor', 'common'\|'rare'\|'epic')` | force-roll + equip a test item |
| `S.rollLoot(n)` | simulate n drop rolls at the current stage; reports rarity/slot counts, touches no other state |
| `S.runes()` | the whole tree: owned / affordable / locked-and-why, one row per node |
| `S.buyRune('arcane_1')` | attempt a real purchase (spends real gold) |
| `S.giveGold(5000)` | debug: hand her gold, for testing runes without waiting on the economy |

**In Node (faster for balance work):**

```
cd sylvaine
node tools/simulate.mjs --minutes 60          # play an hour in ~a second
node tools/simulate.mjs --minutes 5 --verbose # every swing
node tools/simulate.mjs --seed 7 --spell      # different run, spell forced on
node tools/simulate.mjs --minutes 60 --hz 144 # framerate comparison
node tools/checks.mjs                         # 55 rule assertions
```

## Files

```
index.html          load order + why these are not ES modules
css/style.css       Phase 4's quick dark theme; Phase 7 revisits it
js/config.js        every tuning number, no logic
js/rng.js           seedable RNG, so runs are reproducible
js/log.js           combat log (console + DOM panel; totalPushed lets
                    render.js know when a new line arrived)
js/stats.js         computeStats + the dirty-flag cache
js/items.js         item generation, drop table, auto-equip/auto-sell
js/runes.js         rune tree data, purchase validation, spell-unlock gate
js/enemies.js       roster, palette-swap variants, stage curve
js/game.js          all the rules; step(state, dt) is the only entry point
js/loop.js          requestAnimationFrame + the dt clamp
js/render.js        reads state, writes DOM — never the reverse. Also
                    the Phase 5 sprite state machine (hero) and
                    sprite/filter/effects wiring (enemies)
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
- Enemy data started as 6 base sprites driving 20 variants via palette
  treatments; grew to 20 base types (grunts through named endgame uniques —
  see `assets/sprites/README.md`) after the initial art review, with the
  original 6 keeping their palette-swap tiers on top. Plus 4 boss sprites
  cycled with treatments for the endless tail.

## What Phase 2 added

- **Items are generated from a "power budget"**, not hand-written stat ranges
  per rarity: `budget = base * growth^(stage-1) * rarityMult`, split across
  1-3 random stats and converted to values via a per-stat weight. Same shape
  as `enemies.js`'s HP curve, so loot scales automatically as stages get
  harder — no per-stage tables to maintain by hand.
- **Auto-equip compares a weighted "power" score, not a literal stat sum.**
  `+0.1 attackSpeed` and `+5 damage` are both small numbers but not worth the
  same amount (attackSpeed compounds into DPS, damage adds to it), so a raw
  sum would make the logic irrationally prefer damage stats. The weight table
  (`config.js` → `items.powerWeights`) is the same one used to size an item's
  rolls in the first place, so generation and comparison agree.
- **Percentage stats are capped per-affix** (`items.statCaps`): `critChance`
  and `critMult` have a real ceiling — 100% crit chance is already the
  maximum possible value — but the item budget grows exponentially forever,
  same as enemy HP. Without a cap, a stage-40+ roll produced things like
  "+250% crit chance" on one affix. `computeStats` already clamps the FINAL
  total so nothing broke, but the item itself was nonsense; `damage`,
  `spellPower`, and `hp` are deliberately left uncapped since they have no
  natural ceiling and are the intended "big non-linear jump" channel.
- Verified against 50,000-roll samples: normal stages drop ~15.1% of the
  time (85/15 common/rare split), boss stages drop 100% of the time (40/50/10
  common/rare/epic split), and epic never appears outside a boss kill —
  matching the spec's drop table exactly (`tools/checks.mjs` checks 12-13).
- When a better item is found, the item it replaces is auto-sold too — there
  is no inventory, so nothing sits in a bag; it's either worn or converted to
  gold immediately (`tools/checks.mjs` check 14).

## What Phase 3 added

- **The rune tree is a flat array, not a nested structure**, exactly as the
  spec required: each node names its own prerequisites by id
  (`requires: [...]`), and the tree shape emerges entirely from those
  references. That's what lets a hybrid node require two nodes from two
  different branches at once — a nested `{children:[...]}` tree can't
  express "my parent is two different nodes" without becoming a graph
  anyway, so this starts as one. It's also why saving the tree later
  (Phase 8) is just an array of owned ids, and why rendering it (Phase 6)
  is a matter of walking `requires` to draw the lines.
- **10 nodes**: 4 blade (attackSpeed/critChance/critMult), 4 arcane
  (spellPower/spellCooldown), 2 hybrid — `hybrid_1` requires one blade node
  and one arcane node directly, `hybrid_2` is the capstone requiring both
  branch-4 nodes plus `hybrid_1`.
- **The spell doesn't exist until `arcane_1` is bought.** Before that,
  `hero.spellUnlocked` is false and `game.js`'s tick loop never even reads
  the spell timer — she doesn't have a weak spell, she has no spell.
  Verified mid-run: 30 seconds with zero casts, buy the rune, the next 30
  seconds show real casts (`tools/checks.mjs` check 23) — the gate is a
  functioning switch, not a flag nobody reads.
- **All three purchase rules enforced together**: enough gold, prerequisites
  owned, not already owned. A failed purchase spends nothing and grants
  nothing — verified by attempting `hybrid_1` with only half its
  prerequisites bought (fails), then succeeding once both branches are in
  (`tools/checks.mjs` checks 21-22).
- `tools/checks.mjs` grew from 34 to 55 assertions.

## Known limitation, carried forward on purpose

Runes still don't have any way to auto-buy — the player has to type
`S.buyRune(id)` by hand, since there's no UI yet (that's Phase 6). This
means a long `S.fast(...)` run will pile up unspent gold exactly like
Phase 1/2's runs did, because nothing in the simulation itself decides to
spend it. That's expected and not a bug: the spec is explicit that "which
rune nodes to buy" is the ONE decision a human player makes, so the game
logic was never supposed to buy runes on its own.

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

## What Phase 4 added

- **`render.js` reads state, writes DOM — and never the reverse**, same
  discipline as everything before it: game logic doesn't know the screen
  exists (`loop.js` still just calls `Game.step`), and rendering doesn't
  mutate game state directly. The one exception is intentional: clicking a
  rune's Buy button calls `Runes.purchase(state, id)` — the exact same public
  action `S.buyRune(id)` already used. The rules for whether that succeeds
  still live entirely in `runes.js`; the click just forwards to it.
- **The combat log only rebuilds its DOM when something actually changed.**
  `log.js` grew a `totalPushed` counter (see its header comment) because
  `entries.length` alone can't tell you "did a new line arrive" once the log
  hits its 200-entry cap and starts shifting old lines out — the array stops
  growing while lines keep coming in. Comparing `totalPushed` against a
  locally remembered number is exact and free every frame it *hasn't*
  changed, which is most frames.
- **The rune-buy list is deliberately not the real tree UI.** It's one flat
  list of buttons — the real clickable tree with prerequisite lines is
  Phase 6. This exists now so runes don't require the console anymore.
- **Companion and Pet got two reserved, empty slots in the layout**
  (`#supportRow`) and nothing else — no data model, no mechanics. They
  weren't in the original spec; they're planned as their own future phases
  (see below) with the same design rigor items/runes got, not squeezed into
  this one.
- Verified end-to-end in headless Chromium (not just Node): the page loads
  with zero JS errors, all 10 rune rows render, the HP bar width and combat
  log are being written by the live render loop (not just present at parse
  time), and `S.reset(seed)` rebuilds the rune list correctly instead of
  duplicating it (a real bug caught in testing — `buildRuneList()` wasn't
  clearing old rows before appending new ones).

## What Phase 5 added

- **The hero is a state machine over 4 fixed images**, driven entirely by
  `game.js`'s own events (`heroAttack`, `heroSpell`, `heroDamaged`,
  `retreat`) — planted back in Phase 1 specifically so a later phase could
  hook them without touching combat code, and this is the phase that finally
  used them. Swap the sprite, start a ~200ms revert timer back to idle; a
  newer event always cancels a pending revert rather than racing it.
- **Enemies are one static file per current enemy**, chosen once on the
  `spawn` event — not every frame, since the enemy doesn't change sprite
  between spawns. Higher tiers are the exact same file with a CSS
  `hue-rotate` filter applied via inline style, reading the `filter` field
  `enemies.js` already carried since Phase 1's roster design. Hit, death,
  and the attack-tell lunge are all CSS on that one image — never a second
  sprite, exactly per spec. The hit-flash combines the tier's hue-rotate
  with a `brightness(3)` spike in one `filter` value rather than fighting
  over which one wins — see `render.js`'s comment on why that has to be
  done manually instead of with a CSS `@keyframes` animation (an animated
  `filter` property would silently blow away the tier's inline hue-rotate
  while it plays).
- **Graceful degradation, not a broken-image icon.** Most of the roster
  won't have real art for a while — this project's sprites get added by
  hand over time (see `assets/sprites/README.md`). Every sprite `<img>`
  defaults to invisible and only gets revealed on a real `load` event; an
  `error` event (file doesn't exist yet) reveals the pre-Phase-5 placeholder
  box/text instead. The whole animation system runs identically either way —
  it just has nothing to visually swap between until a file exists.
- Portrait boxes grew from 96×96 (icon-sized) to 150×190, since the actual
  hero reference art is a tall ~3:4 portrait, not a square icon; `#arena`'s
  min-height grew to match.
- Verified in headless Chromium, not just read by eye: forced `heroAttack`
  through the real event system and confirmed the `<img src>` actually
  swapped to `sylvaine_attack.png` and reverted to `sylvaine_idle.png` after
  the timeout; forced a mock enemy through `spawn`/`enemyDamaged`/
  `heroDamaged`/`enemyKilled` and confirmed the filter/scale/lunge/dying
  classes all land exactly as designed; re-measured the hero/enemy panel
  alignment from Phase 4 to confirm the larger portraits didn't reopen that
  bug (still ~2px, unchanged).

## Phase plan

- [x] **1** Game logic, console only
- [x] **2** Items, `computeStats` aggregation, drop table, auto-equip/auto-sell
- [x] **3** Rune tree data, purchase validation, spell-unlock gate
- [x] **4** Minimal DOM UI
- [x] **5** Sprites: hero state swaps, sword trail, enemy hit-flash/death CSS
      (system is fully wired and tested; visual result depends on real PNGs
      landing in `assets/sprites/` — see that folder's README)
- [ ] **6** Rune tree UI (the real clickable tree; Phase 4's list is a stand-in)
- [ ] **7** Juice: floating numbers, HP bar lerp, crit flash, drop toasts
- [ ] **8** Save/load + offline progress from a stored timestamp
- [ ] **9** Whispers log (boss-defeat story fragments)
- [ ] **10** Intro sequence (5 stills, click to advance, skippable)
- [ ] **11** Companion system (own combatant, periodic-cast timer, own
      acquisition rule) — added to the roadmap during Phase 4 review, not
      part of the original spec
- [ ] **12** Pet system (passive-only stat modifiers — mechanically closer to
      a rune/item than a combatant) — same origin as Phase 11
