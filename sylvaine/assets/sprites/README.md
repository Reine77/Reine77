# Sprite assets

Filenames are referenced by `js/enemies.js` (enemies) and `js/render.js`
(hero), so they must match exactly, lowercase.

**Phase 5's wiring is live** — drop a file in here with the exact name below
and it appears in-game on your next page load, no code changes needed. Until
a file exists, that slot just shows the old placeholder box/text instead of
a broken image; nothing breaks either way. This folder currently has no
image files in it, so right now everything is still showing placeholders.

## Hero

`idle` and `hurt` are real 4-frame animations now; `attack` and `spell` are
still single static images (see "Why attack/spell aren't animated yet"
below). `js/render.js`'s `HERO_ANIM` is the one place that knows which
states are multi-frame vs. single, so upgrading a single-frame state to a
real animation later is a data change there, not a rewrite.

| file(s) | state | notes |
| --- | --- | --- |
| `sylvaine_idle_1.png` … `_4.png` | resting, LOOPS | the default; cycles continuously at 260ms/frame while nothing else is happening |
| `sylvaine_attack.png` | mid-swing lunge | single frame, faces RIGHT, holds ~200ms then reverts to idle |
| `sylvaine_hurt_1.png` … `_4.png` | pained recoil, plays ONCE | also reused for the boss-retreat beat, with a fade/dim; the 4th frame is a deliberately deeper flinch pose, not a misalignment — her feet sit ~18px higher than the other 3 frames on purpose |
| `sylvaine_spell.png` | casting | single frame, rune above the palm, holds ~200ms then reverts to idle |
| `sword_trail.png` | attack overlay | separate transparent layer, absolutely positioned, fades in/out with the attack |

### Attack has 3 interchangeable variants (once its alpha is fixed — see below)

The intended design: `sylvaine_attack1_1..4.png` / `attack2_1..4.png` /
`attack3_1..4.png` — three different 4-frame swing animations, one picked
at random (plain `Math.random()`, not the game's seeded RNG — this is pure
presentation) every time `heroAttack` fires. `js/render.js`'s `HERO_ANIM`
already supports this shape (a state can list multiple "variants" and picks
one at random) — it's just not wired to these three sets yet, because:

### Why attack/spell aren't animated yet — a real export problem, not a TODO

Sheets for `attack1`/`attack2`/`attack3`/`magic` (spell) came back as flat
**RGB with no alpha channel at all** — a near-white but not perfectly
uniform background (measured: values ranging ~208–255, not a clean flat
255,255,255) baked into the pixels, unlike `idle`/`hurt` which had real
transparency. Shipping them as-is would flash a visible pale box behind her
on every attack/cast — worse than today's single clean image, not better —
so they were deliberately left OUT of this folder rather than committed
looking broken. **To finish this: re-export those 4 sheets with real alpha**
(same tool/settings that produced `idle`/`hurt` correctly), then slice each
into 4 frames named `sylvaine_attack1_1.png` … `sylvaine_attack3_4.png` /
`sylvaine_magic_1.png` … `_4.png`, drop them in here, and update
`HERO_ANIM.attack`/`.spell` in `js/render.js` to list them — no other code
changes needed, the frame-player is generic over "how many frames" already.

Feet were checked across the sheets that DO have real content either way,
for what it's worth: idle/attack1/attack2/attack3/magic all land within 1-2
of each other, which is why the code above already assumes they'll line up
fine once the alpha issue is fixed.

## Enemies — 20 base types, one static image each

20 distinct sprites now, not 6 — this roster is meant to actually feel
different as you climb, not just get shinier. Grouped below by roughly
where each one starts appearing (see `minStage` per variant in
`js/enemies.js` for the exact numbers); draw them in whatever order you
like, the game degrades gracefully either way (see this folder's note
at the top).

**Early grunts (stage ~1-30):**
`goblin.png`, `warhound.png`, `orc.png`

**Mid-early — grunts start banding together (stage ~15-55):**
`goblin_horde.png` (Goblin Horde — one picture, a cluster of goblins, not
literally multiple combatants), `warhound_pack.png` (War-Hound Pack, same
idea), `shaman.png` (Horde Shaman), `orc_brute.png` (Orc Brute — bigger,
meaner orc), `dire_wolf.png` (Dire Wolf — fast beast, distinct from the
War-Hound)

**Mid — the heavy hitters proper (stage ~12-60):**
`troll.png`, `ogre.png`, `harpy.png` (flying scout-type)

**Mid-late — named leaders and casters (stage ~40-105):**
`troll_totem.png` (Troll Totem-Master), `dark_acolyte.png` (Dark Acolyte —
human caster; ties into the "someone opened the gate" betrayal thread from
the story if you want to lean into that visually), `ogre_bandmaster.png`
(Ogre Bandmaster), `black_knight.png` (Black Knight — corrupted/armored
human)

**Late — rare, dangerous, endless-tail uniques (stage ~65+, no upper limit):**
`wraith.png`, `stone_golem.png`, `ettin.png` (Two-Headed Ettin), `cyclops.png`,
`wyvern.png`

Every one of the original 6 grunt types ALSO gets palette-swap tiers (the
existing bloodfang/frost/elite/voidtouch CSS hue-rotates) layered on top of
its single sprite — that system is unchanged and still free variety, it's
just no longer the ONLY source of variety. The 14 new types are plain-only
for now; adding palette tiers to any of them later is one data line in
`js/enemies.js`, same as before, zero new art required if you don't want to.

All enemy visual feedback is CSS, never a second sprite per type:
hit = `filter: brightness(3)` for ~80ms, death = fade + slight scale-down +
downward drift, attack tell = `translateX(-8px)`.

Enemies face LEFT.

## Bosses — their own art, they are the milestone moments

`boss_gorruk.png`, `boss_maw.png`, `boss_unifier.png`, `boss_crown.png`

## Two things to check on export

1. **Real alpha, not a painted checkerboard.** The grey checker pattern is how
   an editor *displays* transparency. If it gets flattened into the pixels on
   export, it renders in-game as a literal grey grid behind her. Open the PNG
   over a coloured background to confirm before dropping it in here.
2. **One consistent canvas size across all five hero states**, with her feet at
   the same height in each. The states get swapped in place on one element, so
   any difference in canvas size or footing makes her jump a few pixels every
   time she swings.

Relative scale between enemy sprites is intentional and must NOT be
normalised — see the `scale` field per base type in `js/enemies.js`. A goblin
is 0.70, an ogre is 1.45.
