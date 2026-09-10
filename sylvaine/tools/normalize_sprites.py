#!/usr/bin/env python3
"""
normalize_sprites.py — force a batch of sprite frames onto one
consistent canvas, feet-aligned, before they go in assets/sprites/.

Why this exists: AI image editors (gpt-image-1's edit endpoint in
particular) don't guarantee the output canvas matches the input canvas
size unless you pass a matching `size` explicitly, and the ChatGPT UI
gives no size control over edits at all. A hero animation whose frames
don't share one canvas size and one foot height jumps a few pixels
every time it swings — this script measures and fixes that instead of
trusting the generator's output size.

What it does, per invocation (one call = one animation's frame set):
  1. Verifies every frame is RGBA with a real alpha channel (not a
     flattened checkerboard) — same check this project has always done
     by hand via PIL before shipping a batch.
  2. Finds each frame's content bounding box (getbbox on the alpha
     channel) and crops to it — the bottom edge of that crop is that
     frame's foot line, regardless of where it sat in the original,
     differently-sized canvas.
  3. Optionally (--scale-ref), rescales every OTHER frame's cropped
     content so its bbox height matches the reference frame's — see
     "Canvas size vs. actual character scale" below for why this is a
     separate, opt-in step rather than something this script assumes.
  4. Picks one target canvas size — explicit via --width/--height, or
     auto: big enough to hold the widest/tallest cropped content plus
     --margin on every side.
  5. Re-pastes every frame's cropped content onto that shared canvas,
     bottom-anchored on the same canvas row for every frame (so all
     feet land at the same height) and horizontally centered on its
     own content, then writes it to the output directory under the
     same filename.

Usage:
  python3 tools/normalize_sprites.py in/sylvaine_attack1_*.png -o assets/sprites/
  python3 tools/normalize_sprites.py in/*.png -o out/ --width 627 --height 627
  python3 tools/normalize_sprites.py in/*.png -o out/ --scale-ref in/frame_1.png

Run once per animation (per state), not across states — different
states are allowed to use different canvas sizes (see
assets/sprites/README.md's "canvas sizes are NOT uniform across
states" table); what must match is every FRAME WITHIN one state.

Canvas size vs. actual character scale
---------------------------------------
Matching canvas size and foot row (steps 1-2 and 4-5) does NOT mean
every frame draws her at the same size. If the generator renders her
taller in one frame than another, both still end up on the same canvas
with feet on the same row, but she'll visibly grow/shrink mid-animation
— a real, separate bug this script can't tell apart from an
INTENTIONAL pose change (a crouch frame is supposed to measure
shorter) without a human eyeballing it first. That's what --scale-ref
is for: point it at whichever frame's size you've decided is the
correct one, and every other frame's content gets rescaled (preserving
its own aspect ratio) to match that frame's bbox height before being
placed. Only use it once you've confirmed the size difference across
frames is drift, not a pose the animation actually needs.
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")


def load_and_check(path):
    im = Image.open(path)
    if im.mode != 'RGBA':
        print(f"  WARNING: {os.path.basename(path)} is mode {im.mode}, not RGBA "
              f"— it has no alpha channel at all. Converting, but check the "
              f"original export settings; this usually means it will render "
              f"as a flat box, not a transparent sprite.")
        im = im.convert('RGBA')
    alpha_min, _alpha_max = im.split()[-1].getextrema()
    if alpha_min == 255:
        print(f"  WARNING: {os.path.basename(path)} has an alpha channel but "
              f"it's fully opaque (min={alpha_min}) — likely a flattened "
              f"checkerboard, not real transparency. Re-export before using.")
    return im


def content_bbox(im, path):
    bbox = im.split()[-1].getbbox()
    if bbox is None:
        sys.exit(f"{os.path.basename(path)} is fully transparent, nothing to align on")
    return bbox  # (left, top, right, bottom)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('frames', nargs='+', help="frame image paths, one animation's worth")
    ap.add_argument('-o', '--out', required=True, help='output directory')
    ap.add_argument('--width', type=int, help='target canvas width (default: auto)')
    ap.add_argument('--height', type=int, help='target canvas height (default: auto)')
    ap.add_argument('--margin', type=int, default=4,
                     help='px of breathing room added around content on auto canvas (default 4)')
    ap.add_argument('--scale-ref', metavar='PATH',
                     help="rescale every other frame's content to match this frame's bbox "
                          "height (must be one of the paths in `frames`). Only use this once "
                          "you've confirmed a size difference across frames is generator drift, "
                          "not an intentional pose change.")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    frames = []
    for path in args.frames:
        im = load_and_check(path)
        bbox = content_bbox(im, path)
        content = im.crop(bbox)
        cw, ch = content.size
        frames.append({'path': path, 'content': content, 'cw': cw, 'ch': ch})
        print(f"  {os.path.basename(path)}: original canvas {im.size[0]}x{im.size[1]}, "
              f"content bbox {bbox} -> cropped {cw}x{ch}")

    if args.scale_ref:
        ref = next((f for f in frames if os.path.samefile(f['path'], args.scale_ref)), None)
        if ref is None:
            sys.exit(f"--scale-ref {args.scale_ref} is not one of the input frames")
        target_h = ref['ch']
        print(f"\nScaling every frame's content to match "
              f"{os.path.basename(ref['path'])}'s height ({target_h}px):")
        for f in frames:
            if f is ref:
                continue
            scale = target_h / f['ch']
            new_w = max(1, round(f['cw'] * scale))
            new_h = target_h
            print(f"  {os.path.basename(f['path'])}: {f['cw']}x{f['ch']} -> "
                  f"{new_w}x{new_h} (scale {scale:.3f})")
            f['content'] = f['content'].resize((new_w, new_h), Image.LANCZOS)
            f['cw'], f['ch'] = new_w, new_h

    if args.width and args.height:
        canvas_w, canvas_h = args.width, args.height
    else:
        canvas_w = max(f['cw'] for f in frames) + 2 * args.margin
        canvas_h = max(f['ch'] for f in frames) + 2 * args.margin

    foot_line = canvas_h - args.margin  # every frame's cropped bottom lands here
    print(f"\nTarget canvas: {canvas_w}x{canvas_h}, shared foot line y={foot_line}\n")

    for f in frames:
        content, cw, ch = f['content'], f['cw'], f['ch']
        if cw > canvas_w or ch > canvas_h:
            sys.exit(f"{os.path.basename(f['path'])}'s content ({cw}x{ch}) doesn't fit "
                     f"the target canvas ({canvas_w}x{canvas_h}) — pass explicit "
                     f"--width/--height large enough for every frame.")
        out = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
        paste_x = (canvas_w - cw) // 2
        paste_y = foot_line - ch
        out.paste(content, (paste_x, paste_y), content)
        out_path = os.path.join(args.out, os.path.basename(f['path']))
        out.save(out_path)
        print(f"  -> {out_path}  (foot at canvas y={foot_line}, pasted at {paste_x},{paste_y})")

    print(f"\n{len(frames)} frame(s) normalized to a shared {canvas_w}x{canvas_h} "
          f"canvas with a common foot line. Re-check with the usual alpha/bbox "
          f"eyeball pass before dropping into assets/sprites/.")


if __name__ == '__main__':
    main()
