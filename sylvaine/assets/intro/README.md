# Intro stills (Phase 10)

Five 16:9 images, each shown with ONE line of text, faded in, advanced on
click. Skippable at any point, and skipped automatically once a save exists.

| order | file | scene |
| --- | --- | --- |
| 1 | `intro_courtyard.png` | young Sylvaine drilling alone; courtiers walk past without looking |
| 2 | `intro_study.png` | Aldreth teaching her, the green rune alight between them |
| 3 | `intro_pass.png` | the horde column pouring through the eastern pass by moonlight |
| 4 | `intro_gate.png` | the gate standing open from the inside, drawbar discarded, NO battle damage |
| 5 | `intro_door.png` | Aldreth pressing the signet into her hands, fire behind them |

## Draft lines — one per still

These are placeholders to be replaced with your own wording; Phase 10 reads
them from a plain array so editing them is a one-line change.

1. "Fourth in a line of three. Nobody watched her, so nobody stopped her."
2. "Steel in the mornings. Magic in the evenings. He never once called her bastard."
3. "Orcs do not lay a siege in one night. Something had unified them."
4. "The gate was not broken. It was opened."
5. "He pressed his signet into her hand, and did not follow."

## Notes for implementation

- Full-bleed backgrounds, so no transparency required — these can stay as
  opaque PNGs (or JPEGs, if the file sizes get uncomfortable).
- Still 4 carries the entire betrayal reveal in one visual detail. The line
  should point at the undamaged timber, not at the horde.
- Still 5 is painted at noticeably higher fidelity than stills 1-4, which are
  chunkier pixel work. A gap between intro art and gameplay art is fine and
  expected — a gap *inside* the intro sequence is more visible, because the
  player sees the five back to back. Either bring 5 down toward the others or
  bring 1-4 up; it does not affect any code either way.
- Aspect ratios must match each other exactly, or the frame will resize
  between clicks. Phase 10 will letterbox into one fixed 16:9 box regardless,
  but matching sources avoid any cropping decisions.
