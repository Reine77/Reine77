# Sprite assets

Filenames are referenced by `js/enemies.js` (enemies) and `js/render.js`
(hero), so they must match exactly, lowercase.

**Phase 5's wiring is live** — drop a file in here with the exact name below
and it appears in-game on your next page load, no code changes needed. Until
a file exists, that slot just shows the old placeholder box/text instead of
a broken image; nothing breaks either way. This folder currently has no
image files in it, so right now everything is still showing placeholders.

## Hero

Every state is a real 4-frame animation now. `js/render.js`'s `HERO_ANIM` is
the one place that knows the frame count/timing/variants per state, so
adding a 5th attack variant, say, is a data change there, not a rewrite.

| file(s) | state | notes |
| --- | --- | --- |
| `sylvaine_idle_1.png` … `_4.png` | resting, LOOPS | the default; cycles continuously at 260ms/frame while nothing else is happening |
| `sylvaine_attack1_1..4.png`, `attack2_1..4.png` | mid-swing lunge, plays ONCE | a NORMAL hit picks attack1 or attack2 at random (plain `Math.random()`, never the game's seeded RNG — pure presentation) |
| `sylvaine_attack3_1..4.png` | crit swing, plays ONCE | reserved for crits specifically — a crit is never attack1/2, and attack1/2 never plays on a crit. `game.js`'s `heroAttack` event already carries `crit` on its payload for exactly this branch |
| `sylvaine_hurt_1.png` … `_4.png` | pained recoil, plays ONCE | also reused for the boss-retreat beat, with a fade/dim; the 4th frame is a deliberately deeper flinch pose, not a misalignment — her feet sit ~18px higher than the other 3 frames on purpose |
| `sylvaine_spell_1.png` … `_4.png` | casting, plays ONCE | rune/wind swirl above the palm |
| `sword_trail.png` | attack overlay | separate transparent layer, absolutely positioned, fades in/out with the attack — no file dropped in yet, still shows nothing (see the graceful-degradation note above) |

### Canvas sizes are NOT uniform across states — measured, not assumed

Every hero `<img>` renders inside a fixed 150×190px box via CSS
`object-fit: contain`, which scales each state's own frames to fit while
preserving THEIR aspect ratio — so a state whose source canvas is a
different shape renders at a different actual size inside that box, even
though the box itself never changes. Measured directly rather than
eyeballed:

| state | frame canvas | aspect | rendered size in the 150×190 box |
| --- | --- | --- | --- |
| idle / hurt | 627×627 | 1.00 (square) | 150 × 150 |
| attack1 / attack2 | 669×587 | 1.14 | 150 × 131.6 |
| attack3 (crit) | 627×627 | 1.00 (square) | 150 × 150 — matches idle exactly |
| spell | 656×599 | 1.10 | 150 × 137 |

So a normal attack or a spell cast renders very slightly shorter (~13-18px,
~10%) than idle — noticeable if you look for it, but smaller than the ~40px
gap that existed before this batch (the old single `sylvaine_spell.png` was
a 765×1024 portrait canvas, rendering a full 190px tall against idle's
150px). The crit swing (attack3) happens to land on exactly the same
square aspect ratio idle/hurt use, so THAT transition has zero size jump.
If this becomes worth chasing further, the fix is re-exporting attack1/2/
spell on a square canvas to match idle/hurt/attack3 — not a code change.

Feet were checked the same way as every other batch: within each sheet's
own 4 frames, not just eyeballed. attack1 lands all 4 at the same y; attack2
and spell each have one frame ~30px higher (a genuine mid-lunge foot-lift /
casting-stance shift, not a misalignment); attack3's calm 4th frame sits
~46px higher than its other 3, consistent with it being the most upright,
least-crouched pose in that sheet.

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
