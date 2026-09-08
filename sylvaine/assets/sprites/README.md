# Sprite assets

Filenames are referenced by `js/enemies.js` (enemies) and Phase 5 (hero), so
they must match exactly, lowercase.

## Hero — one static image per state, no frame animation

| file | state | notes |
| --- | --- | --- |
| `sylvaine_idle.png` | resting | the default; every other state reverts to this after ~200ms |
| `sylvaine_attack.png` | mid-swing lunge | faces RIGHT |
| `sylvaine_hurt.png` | pained recoil | also reused for the boss-retreat beat, with a fade/dim |
| `sylvaine_spell.png` | casting | rune above the palm |
| `sword_trail.png` | attack overlay | separate transparent layer, absolutely positioned, fades in/out with the attack |

## Enemies — one static image each

`goblin.png`, `warhound.png`, `orc.png`, `shaman.png`, `troll.png`, `ogre.png`

Higher tiers are NOT new files. They reuse these via the CSS colour
treatments in `js/enemies.js` (`treatments`), so a new tier is one line of
data and zero new art.

All enemy visual feedback is CSS, never a second sprite:
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
