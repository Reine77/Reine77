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
| `S.farmStage(30)` | park on a cleared, non-boss stage and farm it indefinitely |
| `S.autoAdvance()` | release the hunting ground, resume climbing |
| `S.killCounts()` | kills per creature type (what pet/companion unlocks will read) |

**In Node (faster for balance work):**

```
cd sylvaine
node tools/simulate.mjs --minutes 60          # play an hour in ~a second
node tools/simulate.mjs --minutes 5 --verbose # every swing
node tools/simulate.mjs --seed 7 --spell      # different run, spell forced on
node tools/simulate.mjs --minutes 60 --hz 144 # framerate comparison
node tools/checks.mjs                         # 97 rule assertions
node tools/balance.mjs                        # economy calibration (spends gold)
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
tools/balance.mjs   economy calibration (plays WITH a gold-spending policy)
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

## Hunting grounds (player-chosen farming)

Added after the Phase 5 review, ahead of the companion/pet phases that need
it. The player can lock onto any **cleared, non-boss** stage and farm it
forever instead of auto-climbing — the groundwork for "wolf pups only drop
from dire wolves, which only spawn in stages 30-50".

**The cost is progression.** XP *and* gold scale down the further a stage is
behind your frontier (highest normal stage cleared): full value at the
frontier, falling linearly to **exactly zero** `config.xp.relevanceWindow`
stages back (default 10). Farming old content earns you drops and kill
counts, and nothing else. That's the trade the choice is meant to be about —
you pause your climb to hunt something specific.

Two things that are deliberately *not* symmetrical here:

- **Item drops have no falloff.** Item power rolls from the stage's own
  budget curve, so a stage-5 drop is junk to a stage-50 hero automatically.
  Drops self-limit; currencies don't, so only currencies needed a rule.
- **Gold needed the brake too, which wasn't obvious.** The first draft only
  slowed XP, reasoning that per-kill gold already shrinks exponentially with
  stage. Measuring it disproved that: kill *rate* rises as content
  trivialises (capped only by `spawnDelay`, ~30 kills/min), which more than
  cancels the smaller reward. 40 minutes parked on stage 5 out-earned 25
  minutes of real climbing 4:1 — enough to buy the entire 9,900g rune tree
  without fighting anything dangerous. Gold now uses the same falloff.

Guard rails:

- Boss stages can't be farmed (they're one-off fights).
- You can't pick a stage you haven't cleared.
- If a hunting ground turns out to be lethal, the lock **releases itself**
  rather than looping her into the same death forever, and says so in the log.
- The automatic retreat-farm loop is untouched: when a boss blocks her she
  farms her frontier, which is worth full XP, so she can still level through
  the wall. Breaking that would break the whole difficulty gate —
  `tools/checks.mjs` check 28 exists specifically to catch it.

Kill counts are now tracked per creature type (`totals.killsByType`), keyed
on the base type rather than the display name — so "Bloodfang Goblin",
"Elite Goblin" and "Goblin" all count toward the same bucket, which is what
a future "kill 100 of these" requirement needs.

## The economy (rune ranks + calibration)

Every rune node can be bought **5 times**. Each rank adds the node's mods
again (power is *linear* in rank) while the price multiplies by
`config.runes.rankCostMult` = 3.1 (cost is *exponential*). So `blade_1` runs
150g → 465g → 1,442g → 4,469g → 13,855g, and the fifth rank of anything is a
real commitment rather than an afterthought. That's what turns gold from a
finite 9,900g shopping list into a sink that never runs dry.

**Calibration target: reaching the level cap (100) should afford ONE branch
maxed, with a little left over — not the whole tree.** Measured across 7
seeds with `tools/balance.mjs`: **1.13–1.16×** the cost of one branch, and
**0.31×** the cost of the whole tree. Blade and arcane are deliberately
priced identically (353,219g each) so choosing between them is about
playstyle, not price. The hybrid branch is costlier on purpose — it's the
capstone, and it requires both other branches anyway.

### Two measurement traps worth knowing about

**Measure at the milestone, not at a wall-clock time.** The first attempt
measured lifetime gold after a fixed 3 days and reported a *73× spread*
across seeds — which looked like the economy was pure luck and untunable.
It was a measurement error: seeds that hit level 100 early kept earning for
hours afterwards at exponentially deeper stages. Measured at the moment the
cap is reached — the thing the target is actually about — the same seeds
land within ±0.02 of each other. `balance.mjs` now reports the at-cap number
and labels the post-cap surplus separately.

**The simulator has to spend gold.** `simulate.mjs` never buys anything, so
every economy number it produced was for a hero with an empty rune tree.
`tools/balance.mjs` exists because of that: it runs the same game with a
stand-in player that buys the cheapest available rank in a chosen branch.

### The arc-length tension (unresolved on purpose)

Slowing the XP curve to stretch the arc does **not** work as a simple knob,
and it's worth knowing why before touching it:

| `xp.growth` | time to level 100 | reliability | gold ÷ branch |
| --- | --- | --- | --- |
| 1.07 | 1–5h | 7/7 seeds cap | 1.14x ✅ |
| 1.08 | 3.6h–never | 2/3 seeds cap | 5.2x |
| 1.09 | 15.8h–never | 1/3 seeds cap | 11.6x |
| 1.10 | 40.7h–never | 1/3 seeds cap | 25.9x |

Slower levelling means she spends far longer at deep stages, where gold is
exponential — so the ratio explodes — *and* levels are a load-bearing power
source, so slowing them makes some runs stall permanently below the cap.

So the arc is currently **~1–5 hours of continuous game time** to level 100.
The "day or two" wall-clock experience depends on Phase 8's offline progress
(at a fraction of the online rate) plus the fact that nobody watches an idle
game continuously. Genuinely stretching the *active* arc would need rune
costs that scale with progress rather than fixed prices — a structural
change, deliberately not done yet.

`node tools/balance.mjs --branch arcane --days 5` re-runs the whole
measurement.

## Elemental attributes (step 1 of the build-strategy rework)

Six attributes — `physical, fire, wind, earth, dark, holy`. Every source of
damage carries exactly **one**, and enemies carry `weakTo` / `resists` lists.
Weak = 1.5x damage, resisted = 0.7x, otherwise 1.0x.

**Resistances can never stack.** An attack has one attribute, so at most one
multiplier applies — the worst case is bounded and predictable. That's
deliberate: an auto-battler can't swap loadouts mid-fight, so an unbounded
resistance stack would just be an invisible wall.

It cost almost nothing to add because every damage source already funnelled
through a single `damageEnemy()` in `game.js` — attributes needed exactly one
interception point.

### Leniency is data, not a special case

Early grunts (goblin, war-hound, orc) have **no tags at all**, and the first
tagged enemy now appears after the first boss. Nothing punishes a player for a
system they haven't met yet. There is no "leniency multiplier" anywhere in the
code — it's just an empty list on the early roster.

### The mistake this step caught

The first pass tagged **12 of 24** enemies as resisting `physical` — and
`physical` is her only basic attack, with no way to spec out of it until the
rune rework. That's a 30% damage cut across half the game with **zero
counterplay**, and it immediately showed up as a test failure (she stalled and
stopped climbing). Trimmed to 5 of 24, kept only where "your sword doesn't work
here" genuinely reads: wraith (incorporeal), stone golem, black knight (plate),
ettin, and the final boss.

The general rule it taught, worth keeping for the next steps: **don't ship a
counter before its counterplay exists.** More physical resistance can be added
in the rune step, once she can actually respond to it.

### Current state is deliberately near-invisible

A 45-minute run logs ~172 hits on a weakness and **0 resisted** — she only
fields physical and wind, so today the system is almost pure upside. It
sharpens when the rune rework gives her fire/dark/holy to choose between.
Tags are shown on the enemy panel rather than hidden, since they're meant to
drive build and hunting-ground decisions.

`canWin` folds the matchup in per damage source, so the retreat gate can't
march her into a fight the numbers say she loses.

## Normal-stage walls (build/gear can unblock them, not just bosses)

The pre-fight winnability check (`canWin`) used to run only before bosses —
normal stages just resolved for real, on the reasoning that a ~10-15s normal
fight is cheap enough to let her try and possibly die. That stopped being the
right call once normal-stage enemies could carry real elemental resistances:
a build that's simply wrong for the current stage should be caught and
explained the same way an underleveled boss attempt already was, not
discovered by repeatedly dying.

**Every enemy now gets the same pre-fight check**, elemental matchup
included. So a normal-stage wall works exactly like a boss wall always did:
she retreats to farm the last stage she can actually beat, and after every
farm kill the game re-asks "could I win now?" with current gear/runes/level
folded in — the moment a purchase or drop tips the answer, she goes right
back and clears it. Verified directly: force an artificially unbeatable
normal-stage enemy, confirm she retreats and farms; boost her stats, confirm
she immediately breaks back through.

**A mistake caught by measuring, not reasoning about it:** `canWin` compares
time-to-kill against time-to-die, and time-to-die used her hp. Whether that
should be her *current* hp or her *max* hp turned out to matter a lot once
this check ran before every stage instead of just rare bosses. Current hp
seemed to cause "thrashing" — bouncing between two adjacent stages every few
minutes — so the first attempt switched it to max hp on the theory that the
check should mean "is this content within my build," not "how bruised am I
right now." That was wrong, and measuring proved it backwards: max hp made
the check *optimistic* (it passes assuming full health, then the real fight
runs at whatever attrition-reduced hp she actually has), and real deaths in a
60-minute run went from **0 to 70**. Current hp is what makes the check an
honest "would I survive this specific fight," and the "thrashing" was never
a bug — it's the same attrition mechanic (`combat.healOnKill` is a partial
top-up, not a full heal) that already existed via real deaths before this
change, just now caught proactively instead of paid for in HP. Reverted to
current hp; verified 0 real deaths across 4 seeds over 3 hours each,
progression unaffected (stage 55+ reached in all of them).

## Boss tokens and epic availability

**The problem:** a whole playthrough contains only ~5 boss encounters (bosses
are every 10 stages, she reaches ~50-60), and epics dropped only from bosses
at 10%. Measured result: **0-1 epics in an entire 3-day run**, across every
seed. The epic tier, and the "epics are the milestone reward" rule, was
effectively dead content.

**The fix — three levers, because they solve different problems:**

| lever | before | after | why |
| --- | --- | --- | --- |
| Boss epic rate | 10% | 25% | bosses stay the reliable source |
| Trash epic rate | 0% | 2% | the only high-volume kill source (~300-650/run vs ~5 bosses), so this is what makes idling produce epics |
| Boss tokens | — | ~1.5%/kill, 25% from bosses | directed agency: re-fight a boss you choose |

Measured after: **5-8 epics per playthrough**, and boss encounters went from
5 to 10-19.

### Why re-fighting old bosses is safe without any new guard rails

Two rules already in the codebase make it self-limiting, so no anti-farm
logic was needed:

- **Item power rolls from the stage it dropped at**, so a stage-10 epic is
  junk to a stage-50 hero. You can't farm easy bosses for good gear.
- **The XP/gold relevance falloff already applies**, so an outleveled boss
  pays ~0 XP and ~0 gold. A token fight is purely about the drop.

The only thing worth enforcing is that she can actually *win*, so a rare
token is never burned on a fight the numbers say she loses — and a challenge
she's driven out of **refunds its token**.

### Selectable, and tracked per boss identity

The challenge picks a specific cleared boss *stage* (which pins both the
identity and the loot's power level). Kills are counted in
`totals.bossKillsById` keyed on boss **identity** — `maw`, not stage 20 —
because Maw recurs at 20/60/100/… and a future "defeat Maw 10 times" elite
pet unlock means the creature, not one stage.

A token is a plain counter on the hero, **not** an inventory item, so none of
this depends on the gear-inventory work.

### This also fixes two things that weren't on the list

- **Phase 9's whispers log** delivers one story fragment per boss defeat. At
  5 defeats per run the entire story would have been 5 lines.
- The four boss sprites were each being seen roughly once.

### Two bugs found while building it

- **`epicsFound` only counted epics that were EQUIPPED.** One that dropped
  and wasn't an upgrade got sold and never counted, despite the name. Now
  counted on the drop, with `epicsEquipped` tracking the subset separately.
  (Re-measured: it did not change the original 0-1 diagnosis — with trash
  epics at 0%, found and equipped were nearly identical.)
- **`tools/checks.mjs` restored `stallTimeout` to a hardcoded `60`** after
  temporarily raising it — but the real configured value is `240` since the
  pacing retune. Roughly 20 tests had been silently running under the wrong
  config. It now saves and restores the actual value.

## Percent-modifier stat model (step 2 of the build-strategy rework)

The prerequisite for everything left in that rework: `stats.js`'s aggregation
was purely flat addition (`base + levelGrowth + gearMods + runeMods`). Diablo-
style gear affixes ("+15% fire damage") and letting flat stats keep mattering
at high stages (see Phase 2's write-up on `critChance`/`critMult` going dead
once capped) both need a second, multiplicative layer on top.

**The one rule that matters: percentages from different sources SUM before
being applied once — they never multiply each other.**

```
damage = flatDamage * (1 + item1% + item2% + rune%)     <- this
damage = flatDamage * (1+item1%) * (1+item2%) * ...      <- NOT this
```

The wrong version compounds — five +20% sources give `1.2⁵ ≈ 2.49×`, not
`2.0×`, and each *additional* stacked source accelerates faster than the
last. Against an enemy curve that grows a fixed 13%/stage, that's a runaway
that would make the level-100 calibration (one branch maxed, ~1.15×)
meaningless the moment gear entered the picture. The additive version is
linear in how much you stack, which is what keeps that calibration valid —
confirmed by re-running `tools/balance.mjs` after this change: still **1.15×**,
unchanged, because nothing generates a percent mod yet (see below).

### The bucket rules

Damage percent bonuses are split into buckets that also **sum**, never
multiply, before the one `(1 + total)` is applied:

- `damagePercent` — applies to every hit, any source, any attribute ("all").
- `physicalDamagePercent` — applies only when the hit's attribute is
  `physical` (today: her basic attack, always).
- `magicDamagePercent` — applies to any *non*-physical attribute (today: her
  spell, which is `wind`) — the broad "magic" category.
- `<element>DamagePercent` (`fireDamagePercent`, `windDamagePercent`, …) —
  applies only to that exact attribute.

So her spell (currently `wind`) gets `all + magic + wind`; her basic attack
(currently `physical`) gets `all + physical`. `critChance`/`critMult` were
deliberately left flat-only — "+5% crit chance" reads as +0.05 additive in
every ARPG that uses the phrase, not as "5% of your current value," so
giving them a `*Percent` key would be a trap, not a feature.

One thing that composes *correctly* by staying separate: her own damage%
bonus and an enemy's elemental resistance are two different multiplicative
factors (her build vs. the enemy's nature), and they're supposed to multiply
each other rather than sum — verified directly (check 47): a +50% physical
bonus doesn't change the ratio between fighting a physical-resistant enemy
and a neutral one, which stays exactly `0.7×` either way.

### Where the multiplier actually gets applied

Baked directly into `computeStats`'s `damage`/`spellPower` output — not into
`game.js`'s damage-dealing code — by looking up which attribute each source
currently carries at compute time. That one decision means `heroDps`/`canWin`
(the retreat gate), the actual damage dealt in combat, and the stat panel
display all automatically agree, since all three already read
`s.damage`/`s.spellPower` from the same cached `computeStats` result — zero
changes needed anywhere else.

At the time this was written, that lookup read `CONFIG.attributes.basicAttack`
/`.spell` — two globally-fixed constants, since nothing could yet change her
attack's element. Step 3 (below) is exactly the change that couples this to
the hero instead: `hero.attackAttribute`/`hero.spellAttribute`, mutable, so a
rune conversion node can actually move the needle here.

### Current state: inert, on purpose

Nothing in `items.js` or `runes.js` generates a percent mod yet — this step
was the plumbing only. `tools/balance.mjs` confirms zero drift in the
economy as a result. Steps 3 (rune tree rework) and 4 (gear rework) are what
actually populate these keys.

`tools/checks.mjs` grew from 133 to 148 assertions, covering: additive vs.
compounding stacking, all four bucket rules (including the two "must NOT
leak" negative cases — magic doesn't boost physical, an unrelated element
doesn't boost the wrong spell), `hpPercent`/`attackSpeedPercent`, flat+percent
composing correctly on one item, the existing unknown-key warning still
firing, and the percent-bonus/resistance separation above.

## Rune tree rework (step 3 of the build-strategy rework)

Where the previous two steps were pure plumbing (attributes existed but
nothing used them meaningfully; percent mods existed but nothing generated
them), this is the step that turns the rune tree into the actual decision
the earlier steps were building toward. The tree is re-themed around two
identities — **physical** (attackSpeed/critChance/critMult, plus two new
defensive stats) and **magic** (spellPower/spellCooldown, plus a new heal) —
each with exactly one elemental "conversion" capstone, on a hybrid bridge
that stays orthogonal to both.

### Why conversion, not sprinkled bonus nodes

The original plan (from the user's spec) was to "sprinkle in 1-2 elemental
skills" per tree. The naive version of that — a flat `+15% fire damage` node
sitting in the physical tree — would be a **dead pick**: her attack starts
`physical` and stays `physical` unless something else changes it, so a fire%
bonus does nothing until some other node (which doesn't exist) makes her
deal fire damage. That's a trap disguised as a choice.

The fix: make the elemental node **convert** the damage source's attribute
outright, and grant that element's own damage% bucket in the *same* node
(`{ mods: { earthDamagePercent: 0.15 }, convertsAttackTo: 'earth' }`). Buying
it is the moment it starts mattering — never a bet on some other node
existing. It also sidesteps needing any "mutually exclusive node" machinery:
with exactly one conversion target per tree, there's no "which of several
elemental picks do I take" to arbitrate.

- **physical tree → earth.** Capstone `phys_6` ("Avalanche Strike") converts
  her basic attack to earth. Matches the spec's "mostly physical and earth."
- **magic tree → fire.** Capstone `magic_6` ("Wyrmfire Communion") converts
  her spell to fire. The spec called this "the rest" of the elements (fire/
  dark/holy were all viable; fire was picked as the flavor) — her spell
  already starts as `wind` by default, so the magic tree was already
  elemental before this step; the capstone is a second, deliberate elemental
  choice on top.
- **The one sprinkle that needed no conversion**: `magic_5` ("Battle Focus")
  is a flat `physicalDamagePercent` bonus sitting in the *magic* tree. It
  isn't dead on arrival the way a naive elemental sprinkle would be, because
  her basic attack is `physical` **by default** — a caster who never touches
  `phys_6` still gets a live bonus to her still-physical sword arm from the
  moment she buys it. This is the one place the spec's "sprinkle physical/
  earth back into magic" request could be satisfied for free.

Conversion is **permanent, no refund** — same one-way-door convention as
`unlocksSpell`/`unlocksHeal`. `hero.attackAttribute`/`hero.spellAttribute`
now live on the hero (not `CONFIG`), initialized from
`CONFIG.attributes.defaultAttackAttribute`/`defaultSpellAttribute` in
`makeHero()`, and every attribute lookup in `game.js`/`stats.js` reads the
hero's field instead of the old config constant.

### The survival skill: heal, placed early

The spec asked for "a survival skill like heal in magic early tree." `magic_3`
("Mending Light") sits one purchase deep — a direct sibling of the
spell-unlock node, not buried at the end — and gates `hero.healUnlocked` the
same way `magic_1` gates `hero.spellUnlocked`. The heal is a **third,
completely independent timer** (`hero.timers.heal`, ticked in `tickHero`
alongside attack and spell) rather than a rider on either existing clock —
same reasoning that already applied to keeping attack and spell separate:
"heal every Nth swing" would make `attackSpeed` upgrades passively buff
survival too, which isn't the story attackSpeed is supposed to tell.

Like the spell, the heal timer is **not reset when a new fight begins** — a
free heal every spawn would trivialize the attrition system that is the
game's actual difficulty (`combat.healOnKill`'s partial top-up). It keeps
ticking across fights, same as `spellUnlocked`'s timer always has.

### The defensive stats: evade and damage reduction

The spec asked for "more defense related skill in physical (evade, damage
reduction)" — two new flat stats, `evadeChance` and `damageReduction`, both
0..1, both **flat-only** (no `*Percent` counterpart) for the same reason
`critChance`/`critMult` are: "+5% evade chance" reads as +0.05 additive, not
as a multiplier of itself.

Both are **hard-capped** (`CONFIG.caps.evadeChance = 0.5`,
`damageReduction = 0.5`) — uncapped, either alone could reach 100% and make
her functionally unkillable, which would turn off the entire retreat/
attrition system that is the game's real difficulty curve. In `enemyAttack`,
evade is rolled first (a fully-avoided hit skips damage reduction entirely —
zero is zero), and only a hit that lands gets shaved by damage reduction.

### Folding all three into the winnability check

`canWin`'s time-to-die math previously only knew about raw enemy DPS. It now
folds in the full defensive picture on the incoming side:

```
effectiveEnemyDps = max(0, rawEnemyDps * (1 - evadeChance) * (1 - damageReduction) - healPerSecond)
```

A build that heals faster than it takes damage reads as `ttd = Infinity` —
correctly "unkillable," not just "survives a bit longer." This is what makes
`phys_3`/`phys_5` (evade/DR) and `magic_3` (heal) real alternatives to raw
offense for getting past a wall, not just quality-of-life padding.

### A real bug this step exposed (not introduced)

Re-running `tools/checks.mjs` after wiring the RNG-consuming evade roll into
`enemyAttack` broke a previously-passing test — "she climbs again after
release" — with `highestNormalCleared` measurably *decreasing* over a run
(38 → 33), which should be impossible; it's meant to be monotonic.

Root cause, found by tracing kill/retreat events rather than guessing:
`advance()`'s normal-climb branch did `state.highestNormalCleared =
state.stage` — an **unconditional overwrite**, not a "raise the high-water
mark" `Math.max`. That's harmless during a simple linear climb (`state.stage`
only ever goes up one at a time in that branch) but breaks the moment a
chain-retreat resumes her automatic farming at a `blockedStage` *below* a
stage she'd already reached earlier in the same run — the next normal kill
would silently drag her recorded frontier back down with it, which quietly
re-triggers the XP/gold outleveled-content falloff on stages she'd already
earned full credit for, and could even block `canFarmStage` on ground she'd
legitimately cleared.

This bug pre-dated step 3 — extending `canWin` to normal stages (an earlier
piece of work) is what made chain-retreats on non-boss stages possible in
the first place. It just happened not to trigger for any seed the existing
test suite's RNG streams hit, until step 3's new `state.rng.chance()` call
in `enemyAttack` shifted every subsequent random draw for every seed. Fixed
with `Math.max(state.highestNormalCleared, state.stage)`; a check already
covers the invariant (the "she climbs again after release" test, now
guaranteed to fail loudly again if this regresses).

### Budget preservation, verified

The tree grew from 4+4 nodes (blade/arcane) to 6+6 (physical/magic), by
design **preserving the same base-cost sum per branch** (2600 each, same as
before) so the level-100 "one branch maxed, ~1.15× leftover" calibration
wouldn't need to move. Re-ran `tools/balance.mjs --branch physical` and
`--branch magic` after the rework: **1.16×** for both, unchanged within
rounding, and physical/magic still cost identically to max (353,221 vs.
353,220 gold) — confirming the "the choice is playstyle, not price"
invariant survived the re-theme.

`tools/checks.mjs` grew from 148 to 176 assertions: the heal gate and its
independent clock, evade fully negating a hit, damage reduction shaving one
that lands (both against their configured caps), both conversion capstones
(inert before purchase, permanent and bucket-correct after), the magic
tree's physical sprinkle being live with zero conversions bought, `canWin`
correctly flipping a losing matchup to winning once evade/DR/heal are
present, the branch base-cost budget staying at 2600 each, and every
existing blade/arcane-named test renamed to physical/magic in place.

## Gear rework (step 4 of the build-strategy rework)

The last of the four build-strategy steps. The original gear system
auto-resolved every drop instantly — beats what's equipped, auto-equip;
otherwise auto-sell — with no inventory screen at all. That made gear pure
noise: whatever the code decided was "better" is what she wore, no choice in
it. This is the step that finally gives gear a decision, per the spec's
explicit ask for "standard Diablo gear... a simple gear selection... you can
set auto sell for lower rarity like common" — the option the user picked
over auto-equip-only when the tension between the two was raised earlier.

### The Diablo-style rarity shape

Every item, any rarity, carries the same one **implicit base line** —
`damage` for a weapon, `hp` for armor, exactly the "just atk/def" the common
tier asked for. Rarity adds **percent-modifier lines** on top of that base,
drawn from the physical/magic/neutral damage-percent system step 2 built:

- **common** — base line only, 0 extra lines.
- **rare** — base line + 1 percent line.
- **epic** — base line + 2 percent lines.

The percent pool is `damagePercent` ("neutral" — the `all` bucket),
`physicalDamagePercent`, `magicDamagePercent`, plus every **specific
element** from `CONFIG.attributes.all` (`fireDamagePercent`,
`windDamagePercent`, ...). This is the first thing in the game that actually
populates the percent-mod keys step 2 left deliberately inert, and — because
step 3 made attack/spell attributes mutable — the first thing that makes a
specific-element affix a real, sometimes-relevant roll instead of dead
weight (a `holyDamagePercent` weapon affix does nothing for her default
physical attack, but is exactly what an `earth`-converted build, or a future
holy-converted one, would want).

Every percent-damage line shares one weight and one cap
(`items.powerWeights.percentDamageWeight` / `items.statCaps.percentDamageCap`,
currently 0.35) rather than nine near-identical config entries — same
"percentage stats have a natural ceiling" reasoning `critChance`/`critMult`
already established, just applied to a whole family of keys at once instead
of one at a time.

### What's still automatic, and what isn't

The **drop roll** (does a kill drop anything, at what rarity) is unchanged
— still pure RNG off the same table as before. What changed is what happens
**after** a drop: `hero.autoSellRarities` (default `{ common: true, rare:
false, epic: false }`, per the spec's "auto sell for lower rarity like
common") decides whether a rarity resolves itself immediately — sold on the
spot for gold, same as the old behaviour always did for everything — or
lands in `hero.inventory` and waits.

Waiting items get resolved by hand, through four new `items.js` functions
that are all the game rules ever needed to add: `equipItem` (swaps in an
item; whatever it replaces goes **back into the inventory**, not sold —
switching gear to try something shouldn't cost you the old piece),
`sellItem`, `sellAllOfRarity` (bulk-sell one rarity — the "I just turned
auto-sell off a while back and there's a pile of these now" button), and
`setAutoSell` (flips the policy going forward only — it deliberately does
**not** retroactively sell what's already sitting in the inventory; a
settings change having a surprise side effect would be exactly the kind of
thing this project's own "measure, don't assume" discipline exists to catch,
so it just doesn't do that at all).

A soft `inventoryCap` (40) keeps a long unattended run's inventory array
from growing forever when auto-sell is off: pushing an item past the cap
auto-sells the **weakest** item currently held (by `computePower`, not
necessarily the new one), so an old, unwanted common always loses to a
fresh rare rather than the newest find getting evicted by insertion order.

### Reserved icon space, no art yet

Per an explicit ask while building this: every item row — equipped or in
the inventory — reserves a small (26px) square for an icon. No icon art
exists yet, so it degrades the same way the hero/enemy sprites already do:
an `<img>` pointing at `assets/icons/<slot>.png` that stays invisible until
it actually loads, with a tiny text fallback (`WPN`/`ARM`) shown instead,
using the exact same load/error listener shape `render.js`'s
`setupImageFallback` already established for the portraits. The point is
that the *layout* is real now — dropping in a real icon sheet later is an
asset-only change, not a UI rewrite.

### Verified, not assumed

Re-ran `tools/balance.mjs` after this change specifically because it was a
plausible way to quietly break the level-100 economy calibration: the old
auto-resolve system put item-sell gold in the hero's pocket immediately for
every non-upgrade, and `balance.mjs`'s stand-in buying-policy bot never
manually equips or sells anything, so switching rare/epic to
inventory-and-wait could have meant that gold silently stopped flowing in
the harness's own measurement. Measured directly: **1.17×** (previously
1.16×), unchanged within rounding — item-sell gold was never a significant
fraction of the total next to kill rewards, so no rebalancing was needed.

`tools/checks.mjs` grew from 176 to 211 assertions: every rarity always
carries its base line, the exact percent-line count per rarity holds (not
just on average — every single roll), percent lines are real buckets and
respect the shared cap, drops resolve as auto-sold XOR stashed (never both,
never neither), a manual equip swap returns the displaced piece to the
inventory rather than selling it, selling never touches equipped gear,
`sellAllOfRarity` and the auto-sell toggle both behave (including the "does
NOT retroactively sell" contract), and inventory-cap eviction removes the
deliberately-weakest item even when a much stronger one was pushed in at
the same time. One existing test (`tools/checks.mjs`'s boss-token check)
also needed its seed changed after this rework — not because of a bug, but
because item generation now consumes a different number of `rng` draws per
roll, which shifts every later random outcome in a run for a FIXED seed
(the same effect step 3 hit with `highestNormalCleared`, this time
confirmed harmless by sampling neighbouring seeds directly rather than
assumed).

## Phase plan

- [x] **1** Game logic, console only
- [x] **2** Items, `computeStats` aggregation, drop table (originally
      auto-equip/auto-sell — replaced by a real inventory + manual equip in
      the gear rework above)
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
