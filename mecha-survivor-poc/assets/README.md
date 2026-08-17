# Placeholder art — replacement guide

Everything in `sprites/` is programmatically generated placeholder art (see
`gen/make_sprites.py`, needs `Pillow`: `pip install Pillow && python3
gen/make_sprites.py`). It's deliberately flat-colored with bold outlines and
a clean, unambiguous silhouette per part (legs / torso / cockpit / weapon on
the mecha; body / spikes / eyes on the crawler; etc.) so it doubles as a
clean reference image for an AI sprite generator (e.g. AutoSprite-style
tools) — good line art in, good sprite out.

## Rules to follow when swapping in real art

1. **Keep the filename and canvas size identical.** The loader in
   `src/scenes/BootScene.js` references these exact keys/paths — drop a new
   PNG in at the same path and size and nothing else needs to change.
2. **Transparent background (RGBA PNG).** No baked-in shadow/ground — the
   game draws its own drop shadow and ground tile underneath.
3. **Face right.** Every sprite is authored facing right; the game flips
   horizontally (`setFlipX`) for leftward movement/aim instead of loading a
   mirrored frame. Don't bake in a left-facing pose.
4. **Center the subject in the canvas** with a small margin, matching the
   current placeholder framing — physics bodies and `setDisplaySize` calls
   assume the character roughly fills the frame.
5. Currently every entity is a **single static frame** (no walk/attack
   animation) to keep the POC simple. If you generate an idle/walk/attack
   spritesheet, switch the relevant `this.load.image(...)` call in
   `BootScene.js` to `this.load.spritesheet(...)` with the frame size, and
   swap the `sprite` creation in `Player.js`/`Enemy.js` to add an
   `anims.create(...)` + `.play(...)`. That's the only code that needs to
   change.

## Canvas sizes per asset

| File | Size (px) | Notes |
|---|---|---|
| `player_mecha.png` | 128×128 | Wanzer-style biped, open cockpit top, pilot bust visible (skin + hair + flight suit) |
| `enemy_mutant_crawler.png` | 64×64 | Fodder — low quadruped, spikes, glowing eye |
| `enemy_scavenger.png` | 80×80 | Mid-tier — humanoid raider, goggles, jury-rigged blaster |
| `boss_rogue_robot.png` | 192×192 | Wave 6 boss — heavy biped robot, glowing red sensor/eye, twin shoulder cannons |
| `projectile_player.png` | 20×12 | Cyan energy bolt |
| `projectile_enemy.png` | 16×16 | Orange scrap/plasma shot |
| `pickup_xp_gem.png` | 20×20 | Green diamond |
| `chest_closed.png` / `chest_open.png` | 40×40 | Power-up chest, two states |
| `tile_ground.png` | 128×128 | Seamless-ish wasteland dirt tile |

## Regenerating placeholders

```bash
cd mecha-survivor-poc/assets/gen
pip install Pillow
python3 make_sprites.py
```

Edit the shapes/colors in `make_sprites.py` directly if you want to iterate
on the placeholder look before final art is ready.
