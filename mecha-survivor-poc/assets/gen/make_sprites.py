#!/usr/bin/env python3
"""
Generates placeholder sprite PNGs for the Mecha Survivor POC.

Style rules (kept consistent on purpose so these are easy to hand off to an
AI sprite-generation tool later — see assets/README.md):
  - Flat color blocks, bold ~3px dark outlines, no gradients/AA-heavy shading.
  - Transparent background (RGBA).
  - Every sprite faces RIGHT by default (the game flips horizontally for left).
  - Canvas sizes are fixed per category and are already powers-of-two-ish
    square/rect frames so a real spritesheet can drop in at the same size.
"""

import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "sprites")
os.makedirs(OUT, exist_ok=True)

OUTLINE = (20, 18, 22, 255)


def new_canvas(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def poly(draw, points, fill, outline=OUTLINE, width=3):
    draw.polygon(points, fill=fill)
    draw.line(points + [points[0]], fill=outline, width=width, joint="curve")


def ellipse(draw, box, fill, outline=OUTLINE, width=3):
    draw.ellipse(box, fill=fill, outline=outline, width=width)


def rect(draw, box, fill, outline=OUTLINE, width=3, radius=0):
    if radius:
        draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    else:
        draw.rectangle(box, fill=fill, outline=outline, width=width)


# ---------------------------------------------------------------------------
# Player mecha (wanzer-style, exposed cockpit with visible pilot)
# ---------------------------------------------------------------------------

def make_player_mecha(path, hull=(90, 110, 140), accent=(230, 90, 130), hair=(230, 60, 110)):
    W = H = 128
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)

    # shadow
    ellipse(d, (24, 118, 104, 126), (0, 0, 0, 90), outline=None, width=0)

    # back leg (slightly behind, darker)
    dark_hull = tuple(max(0, c - 35) for c in hull)
    poly(d, [(46, 78), (58, 78), (54, 118), (40, 118)], dark_hull)
    rect(d, (36, 114, 60, 122), dark_hull, radius=3)

    # front leg
    poly(d, [(62, 76), (78, 76), (76, 118), (58, 118)], hull)
    rect(d, (54, 114, 82, 124), hull, radius=3)
    ellipse(d, (56, 96, 78, 112), hull)  # knee joint

    # hip/waist block
    rect(d, (48, 66, 88, 84), dark_hull, radius=4)

    # torso hull
    poly(d, [(40, 40), (92, 34), (98, 70), (36, 76)], hull)
    # chest panel lines
    d.line([(48, 46), (48, 66)], fill=OUTLINE, width=2)
    d.line([(66, 40), (64, 72)], fill=OUTLINE, width=2)

    # shoulder armor (far)
    ellipse(d, (30, 34, 50, 54), dark_hull)
    # far arm holding secondary grip, tucked
    rect(d, (28, 50, 40, 70), dark_hull, radius=3)

    # exposed cockpit well (open top on the torso) — this is the "wanzer" tell
    ellipse(d, (50, 16, 94, 48), (35, 38, 46, 255))  # cockpit rim/interior shadow
    ellipse(d, (54, 20, 90, 44), (50, 54, 64, 255), outline=None, width=0)

    # pilot bust sitting in the cockpit (drawn back-to-front: suit, head, hair, eyes)
    rect(d, (63, 30, 83, 44), accent, radius=4)           # flight suit torso/shoulders
    ellipse(d, (66, 8, 84, 28), (245, 205, 175, 255))     # face (skin), drawn full
    ellipse(d, (64, 3, 86, 17), hair)                      # hair cap over top of head
    ellipse(d, (58, 12, 70, 30), hair)                     # left pigtail
    ellipse(d, (80, 12, 92, 30), hair)                     # right pigtail
    ellipse(d, (71, 18, 74, 21), OUTLINE, outline=None, width=0)  # eye dot
    ellipse(d, (78, 18, 81, 21), OUTLINE, outline=None, width=0)  # eye dot

    # near shoulder armor (big, front)
    ellipse(d, (78, 30, 104, 56), hull)
    ellipse(d, (84, 36, 98, 50), dark_hull, outline=None, width=0)

    # near arm + cannon extended to the right (auto-attack weapon)
    rect(d, (92, 44, 112, 60), hull, radius=4)
    rect(d, (106, 48, 124, 58), (60, 62, 70, 255), radius=3)
    rect(d, (118, 49, 126, 57), (25, 24, 28, 255), radius=2)  # muzzle
    ellipse(d, (106, 47, 114, 61), dark_hull)  # elbow joint

    img.save(path)


# ---------------------------------------------------------------------------
# Enemy: Mutant Crawler (fodder)
# ---------------------------------------------------------------------------

def make_mutant_crawler(path):
    W = H = 64
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    body = (110, 150, 60)
    dark = (70, 100, 35)
    spike = (150, 40, 60)

    ellipse(d, (14, 44, 50, 56), (0, 0, 0, 80), outline=None, width=0)  # shadow

    # legs
    for lx in (14, 26, 38, 48):
        poly(d, [(lx, 40), (lx + 6, 40), (lx + 4, 52), (lx - 2, 52)], dark)

    # body
    ellipse(d, (10, 22, 54, 46), body)
    # back spikes
    for sx in (18, 28, 38):
        poly(d, [(sx, 24), (sx + 6, 24), (sx + 3, 12)], spike)

    # head/mouth area (front = right)
    ellipse(d, (42, 26, 60, 42), body)
    poly(d, [(48, 36), (60, 34), (48, 40)], (30, 20, 20, 255))  # open jaw
    ellipse(d, (52, 27, 57, 32), (220, 40, 40, 255), outline=None, width=0)  # glow eye
    ellipse(d, (53, 28, 56, 31), (255, 210, 60, 255), outline=None, width=0)

    img.save(path)


# ---------------------------------------------------------------------------
# Enemy: Scavenger (mid-tier raider)
# ---------------------------------------------------------------------------

def make_scavenger(path):
    W = H = 80
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    cloth = (150, 110, 60)
    armor = (95, 90, 80)
    skin = (190, 150, 120)

    ellipse(d, (20, 68, 60, 76), (0, 0, 0, 80), outline=None, width=0)  # shadow

    # legs
    rect(d, (28, 54, 38, 72), cloth, radius=3)
    rect(d, (40, 54, 50, 72), cloth, radius=3)

    # torso w/ scrap armor plate
    rect(d, (24, 28, 54, 58), cloth, radius=6)
    poly(d, [(22, 30), (40, 26), (56, 32), (52, 46), (26, 46)], armor)

    # head with mask/goggles
    ellipse(d, (28, 8, 50, 30), skin)
    rect(d, (28, 14, 50, 20), (40, 42, 46, 255), radius=3)  # goggles band
    ellipse(d, (32, 14, 39, 20), (120, 220, 220, 255), outline=None, width=0)
    ellipse(d, (41, 14, 48, 20), (120, 220, 220, 255), outline=None, width=0)

    # far arm
    rect(d, (18, 32, 26, 50), cloth, radius=3)

    # near arm + jury-rigged blaster pointed right
    rect(d, (50, 34, 62, 46), cloth, radius=3)
    rect(d, (58, 36, 78, 44), (75, 70, 62, 255), radius=3)
    rect(d, (72, 35, 80, 45), (35, 32, 30, 255), radius=2)

    img.save(path)


# ---------------------------------------------------------------------------
# Boss: Rogue Robot
# ---------------------------------------------------------------------------

def make_rogue_robot(path):
    W = H = 192
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    hull = (60, 62, 70)
    dark = (35, 36, 42)
    glow = (230, 40, 40)

    ellipse(d, (36, 176, 156, 190), (0, 0, 0, 100), outline=None, width=0)

    # wide stance legs
    poly(d, [(56, 120), (84, 120), (78, 178), (50, 178)], dark)
    poly(d, [(108, 120), (136, 120), (142, 178), (114, 178)], dark)
    rect(d, (42, 172, 90, 188), dark, radius=6)
    rect(d, (100, 172, 148, 188), dark, radius=6)

    # hip block
    rect(d, (64, 104, 128, 128), hull, radius=6)

    # torso
    poly(d, [(50, 46), (142, 40), (152, 108), (40, 114)], hull)
    d.line([(70, 52), (66, 106)], fill=OUTLINE, width=3)
    d.line([(120, 46), (124, 104)], fill=OUTLINE, width=3)

    # core sensor / eye
    ellipse(d, (80, 66, 112, 92), dark)
    ellipse(d, (88, 74, 104, 84), glow, outline=None, width=0)

    # big shoulder cannons
    ellipse(d, (24, 42, 60, 78), hull)
    ellipse(d, (34, 52, 50, 68), dark, outline=None, width=0)
    ellipse(d, (132, 36, 172, 74), hull)
    ellipse(d, (142, 46, 160, 64), dark, outline=None, width=0)

    # arms with heavy weapons
    rect(d, (18, 74, 40, 118), hull, radius=6)
    rect(d, (0, 96, 26, 112), (25, 24, 28, 255), radius=3)

    rect(d, (150, 70, 174, 116), hull, radius=6)
    rect(d, (168, 90, 194, 108), (25, 24, 28, 255), radius=3)

    # head unit
    rect(d, (78, 14, 114, 44), hull, radius=8)
    ellipse(d, (88, 22, 104, 34), glow, outline=None, width=0)

    img.save(path)


# ---------------------------------------------------------------------------
# Projectiles
# ---------------------------------------------------------------------------

def make_player_bolt(path):
    W, H = 20, 12
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    ellipse(d, (0, 2, 20, 10), (90, 220, 255, 255), outline=(20, 60, 80, 255), width=2)
    ellipse(d, (3, 4, 11, 8), (230, 250, 255, 230), outline=None, width=0)
    img.save(path)


def make_enemy_bolt(path):
    W, H = 16, 16
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    ellipse(d, (1, 1, 15, 15), (210, 90, 40, 255), outline=(70, 25, 10, 255), width=2)
    ellipse(d, (5, 5, 11, 11), (255, 190, 90, 255), outline=None, width=0)
    img.save(path)


# ---------------------------------------------------------------------------
# Pickups
# ---------------------------------------------------------------------------

def make_xp_gem(path):
    W = H = 20
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    poly(d, [(10, 1), (18, 10), (10, 19), (2, 10)], (70, 230, 120, 255))
    poly(d, [(10, 4), (15, 10), (10, 16), (5, 10)], (170, 255, 200, 255))
    img.save(path)


def make_chest(path, open_lid):
    W = H = 40
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    wood = (150, 105, 60)
    metal = (90, 90, 95)
    ellipse(d, (6, 34, 34, 39), (0, 0, 0, 80), outline=None, width=0)

    rect(d, (6, 20, 34, 34), wood, radius=3)
    d.line([(6, 27), (34, 27)], fill=OUTLINE, width=2)
    rect(d, (17, 20, 23, 34), metal, radius=2)

    if open_lid:
        poly(d, [(6, 20), (34, 20), (33, 6), (7, 10)], wood)
        ellipse(d, (14, 10, 26, 22), (255, 230, 120, 220), outline=None, width=0)
    else:
        rect(d, (6, 12, 34, 20), wood, radius=3)
        ellipse(d, (17, 14, 23, 20), metal)

    img.save(path)


# ---------------------------------------------------------------------------
# Ground tile (seamless-ish wasteland dirt)
# ---------------------------------------------------------------------------

def make_ground_tile(path):
    W = H = 128
    img = new_canvas(W, H)
    d = ImageDraw.Draw(img)
    base = (92, 84, 70, 255)
    d.rectangle((0, 0, W, H), fill=base)

    def wrapped_ellipse(cx, cy, rx, ry, fill):
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                d.ellipse((cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry), fill=fill)

    patches = [
        (20, 24, 14, 8, (82, 74, 60, 255)),
        (96, 40, 18, 10, (100, 92, 76, 255)),
        (50, 90, 20, 12, (80, 72, 58, 255)),
        (110, 100, 12, 8, (104, 96, 80, 255)),
        (10, 100, 10, 6, (86, 78, 64, 255)),
    ]
    for cx, cy, rx, ry, fill in patches:
        wrapped_ellipse(cx, cy, rx, ry, fill)

    cracks = [
        (5, 5, 40, 30), (40, 30, 55, 60), (80, 10, 70, 45),
        (100, 70, 120, 110), (20, 80, 45, 115), (90, 90, 115, 60),
    ]
    for x1, y1, x2, y2 in cracks:
        d.line((x1, y1, x2, y2), fill=(60, 54, 44, 255), width=2)

    img.save(path)


if __name__ == "__main__":
    make_player_mecha(os.path.join(OUT, "player_mecha.png"))
    make_mutant_crawler(os.path.join(OUT, "enemy_mutant_crawler.png"))
    make_scavenger(os.path.join(OUT, "enemy_scavenger.png"))
    make_rogue_robot(os.path.join(OUT, "boss_rogue_robot.png"))
    make_player_bolt(os.path.join(OUT, "projectile_player.png"))
    make_enemy_bolt(os.path.join(OUT, "projectile_enemy.png"))
    make_xp_gem(os.path.join(OUT, "pickup_xp_gem.png"))
    make_chest(os.path.join(OUT, "chest_closed.png"), open_lid=False)
    make_chest(os.path.join(OUT, "chest_open.png"), open_lid=True)
    make_ground_tile(os.path.join(OUT, "tile_ground.png"))
    print("Generated sprites into", os.path.abspath(OUT))
