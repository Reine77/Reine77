# Sprite assets

Filenames are referenced by `js/enemies.js` (enemies) and `js/render.js`
(hero), so they must match exactly, lowercase.

**Phase 5's wiring is live** — drop a file in here with the exact name below
and it appears in-game on your next page load, no code changes needed. Until
a file exists, that slot just shows the old placeholder box/text instead of
a broken image; nothing breaks either way. This folder currently has no
image files in it, so right now everything is still showing placeholders.

## Hero — one static image per state, no frame animation

| file | state | notes |
| --- | --- | --- |
| `sylvaine_idle.png` | resting | the default; every other state reverts to this after ~200ms |
| `sylvaine_attack.png` | mid-swing lunge | faces RIGHT |
| `sylvaine_hurt.png` | pained recoil | also reused for the boss-retreat beat, with a fade/dim |
| `sylvaine_spell.png` | casting | rune above the palm |
| `sword_trail.png` | attack overlay | separate transparent layer, absolutely positioned, fades in/out with the attack |

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
