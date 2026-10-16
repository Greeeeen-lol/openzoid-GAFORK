# Template D — radial-wipe shape intro ("TEMPLATE", magenta key, mint palette)

Source: fourth user template studied via MCP (1920x1080, 30 fps, 450 f, 70 tracks).
Style: flat geometric motion design: radial pie wipes, ring bursts, line rays,
diamonds/starbursts, hatched rectangles, two-tone mint/white palette on a magenta
key colour, outlined beveled text. Recipes R# are in `openzoid-mograph-recipes`
(R24–R28 come from this template).

## What it looks like

| Frames | What happens |
|---|---|
| 0–75 | Solid magenta (key colour, `Greenscreen` adjustment Shutter doublesided cover 0.5) |
| 64–158 | First ellipse-ring reveal (Circle) |
| 75–154 | 6 line rays (Line - TOP/VTOP/BOT/VBOT/LTOP/LBOT) + "Firework" shapes shoot out from centre |
| 75–189 | Radial pie wipes: 5 CircleT layers (BG/VBOT/BOT/TOP/VTOP), each a ring cut from wedges that sweep −2π (R24), interleaved with "RW" layers (rotating rect groups) |
| 89–111 | HLine RIGHT/MID/LEFT staggered ~9–13 f |
| 102–125 | "Pop" scenes (Shutter-filled, masked, Transform) staggered 102/111/125 |
| 116–138 | Flash adjustment clips (white Shutters) 116/125/138 |
| ~139 | DROP: big hit, directional blur 0→2 (f139, "exponential in") →0 (f214, "exponential out") |
| 146 | MAIN BG + 4 colour shutters + wavy side shapes + MAIN/OUTLINE BG SHAPES (CONT MOV drift) take over |
| 148–156 | 9-copy echo transition, 1 f apart, light→dark (R25) |
| 160–293 | Diamonds D1–D4 (masked, Transform, Flip) at ~160/168/180/193 and again 254/262/275/287; Starburst shapes 132/187/198/221/281/293 |
| 173–269 | 4 staggered negative/edge-detect/colorize adjustment clips (a masked "x-ray" pass) |
| 263–360 | Splitscreen panels scroll one tile (R26) |
| 298–391 | End: frame multiplies into a 3×3 reflected wall (R27) while a soft black radial shutter closes; back to magenta key |

Rhythm: accents step ~8–13 f; the big phases sit at 75 (shapes start), ~139/146 (drop),
~298 (out). Every big move uses the two-step expo ease (R23), some with `elastic out`
on the settle (mask sizes).

## Track stack (bottom → top)

| Tracks | Role |
|---|---|
| v0 Greenscreen | key-colour solid (magenta [1,0,0.667]) — under everything |
| v1–v10 | radial wipe rings (CircleT) interleaved with RW rect groups |
| v11–v21 | line rays, fireworks, horizontal lines |
| v22–v24 | white flash Shutters |
| v25–v27 | "Pop" shapes |
| v28 DIAMOND SHAPE | two shapes + Chroma Key cutout (R11) |
| v29–v32 | main background: shutter solid, 4 colour shutters, wavy side shapes (flipped pair) |
| v33–v41 | 9× "RW TOP - Transision" echo stack (R25) |
| v42–v43 | MAIN BG SHAPES + OUTLINE copy, both under a CONT MOV group drifting forever |
| v44–v58 | circles, CB, D1–D4 diamonds, starbursts, particles |
| v59 TEXT [[EDIT THIS]] | composite; "LR PAN" group + 2 Transforms for the camera-like moves |
| v60–v65 | radial white wipes, splitscreens, x-ray adjustment clips |
| v66 FX | master: FLASH group, Duplicates, Image Overlay, Color Shift, Fisheye, Shutters, Bloom, B+C, Static, Edge Detection, Blur, Pixel Sort, Anamorphic Lens Flare |
| v67 Sync | DROP group (RGB Shift, Duplicate, Fisheye, Wavy, B+C, Shake, Directional Blur) + Sync group |
| v68 Others | misc group |
| v69 END TRANSITION | FX group, Shutters, Duplicate multiplier wall (R27), watermark overlays |

## Architecture lessons

1. **Geometry from tricks, not path drawing.** Pie wedges are edge-on planes (R24),
   rings are ellipse-mask pairs (R21), rays are thin rectangles scaled along one axis.
2. **Name every layer by role and side** (`Line - LTOP`, `CB - RIGHT`, `D3`): with 70
   tracks, names are the only map. Use the same convention when building big projects.
3. **Echo by duplication** (R25) gives motion-design "trail" energy without effects.
4. **Effect groups per beat role** on the top tracks (FLASH, DROP, Sync, END): toggle
   or retime a whole hit by its group.
5. **Key colour as the first track** so the template composites over footage, and the
   end transition returns to it.

## Editing this template

- **Text:** v59 composite `TEXT [[EDIT THIS]]`.
- **Palette:** mint/white come from Color Overlays on shape layers and the four
  `MAIN BG COLORS` shutters (v30); change those plus the echo stack shades together.
- **Key colour:** v0 Shutter `color` (and the magenta in v69's end shutters).

## Building a radial-shape intro from scratch (plan)

1. Key-colour solid on track 0 (R19).
2. Opening burst: line rays + ring reveal (R21) + 2–5 radial wedge rings (R24) at
   different radii, staggered a few frames, sweeping −2π with two-step expo.
3. Drop on the big hit: directional blur pulse, flash shutters, switch to the main bg.
4. Main section: drifting bg shapes in a CONT MOV group, diamond/starburst accents
   every ~8–13 f, echo-stack transition (R25), text composite.
5. Outro: splitscreen scroll (R26) then Duplicate-wall zoom-out + radial close (R27).
