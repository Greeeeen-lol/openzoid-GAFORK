# Template A — clean burst intro ("TEXT", green screen, purple grid)

Source: user's intro template studied via MCP (1920x1080, 30 fps, 374 f sequence,
~281 f of content). Recipes referenced as R# live in `openzoid-mograph-recipes`.
Conventions/gotchas in `openzoid-mcp`.

## What it looks like

| Frames | Beat | What happens |
|---|---|---|
| 0–55 | intro | Flat green (green-screen, meant to be keyed over footage) |
| 55–84 | build | White radial shutter circle covers centre, text appears inside a dashed ring |
| 81 | HIT 1 | Text elastic-pops (R4), spike + ring bursts (R1/R2), shake + Twitch strobe (R7) |
| 84–119 | reveal | Shutter punches open (R5) → purple wireframe grid / mountains fly-over (R10) |
| 98 | HIT 2 | Zig-zag spline shards sweep in, rounded "crazy shape" accent layer starts |
| 116–187 | transition | Whole frame whip-spins (R6) while text shrinks to 0 at 152 and re-pops by 203 |
| 152 | HIT | Particle group scales up slowly behind |
| 169/187/204/223 | HITs | Bursts every hit; Cartoon-shape stickers pop for 12 f each, 5 f apart (187–217) |
| 223–281 | hold/outro | Large rings + rays, then everything ends; shutters close |

Beat grid: **81, 98, 116, 134, 152, 169, 187, 203, 223** (≈17.5 f ≈ 103 BPM @30fps).
Everything — clip starts, shake keys, Twitch keys, keyframes — snaps to this grid.

## Track stack (bottom → top) and why

| Tracks | Role | Notes |
|---|---|---|
| v0 "Mir Grid" | background | Scene: recursive group tree of a mountains mesh (R10), Bloom, ellipse Mask inverted, Color Overlay |
| v1–v4 | first burst set @81 | **pairs**: shadow copy (opacity .5, y −30, black overlay) under white copy (R3) |
| v5 | zig-zag splines @98 | image-textured shapes in a Group drifting y 0→−150 over 70 f, two Chroma Keys, Drop Shadow shader (R9) |
| v6 | "Crazy Shape" @96 | 18 sub-groups, roundifier (R8) + Drop Shadow |
| v7 | particles @152 | Group scale 0.5→2.73 linear over 221 f |
| v8–v17 | burst pairs @169,187,204,223 | same burst scenes reused at later hits (duplicate_layer + edit_clip) |
| v18–v24 | cartoon stickers | 12 f clips staggered by 5 f, effect group "Cartoon Shape" (10 Image Overlays) + Mask |
| v32–v36 | the TEXT | 5 copies of one 3D-text scene stacked = faux extrusion/shadow (R3); each has Transform(tilt −0.349 x) → Transform(pop) → Transform(re-pop), Radial Blur, roundifier, Color Overlay |
| v37 | master adjustment | Bloom, 2× Color Adjustment, Exposure, 3× Duplicate (whip spin R6), 2× Shake (beat impacts R7), Twitch (strobe on hits), 2× Shutter |
| v38 | shutter adjustment | 4× Shutter (radial reveal/close R5) |

Design rules it follows:
1. **Two-tone + shadow.** Content is white; depth comes from dark offset duplicates,
   not lighting. Colour comes from the background (purple grid) and the grade.
2. **One global FX layer** owns camera-feel (shake, spin, strobe, grade). Elements stay dumb.
3. **Short accent clips** (12–35 f) dropped on beats; reuse by duplicating whole layers.
4. **Elastic for text, circular-out for shapes, exponential-in→circular-out for transitions.**
5. Text is a "TEXT" placeholder → it's a template; user swaps `objects/1.text` in each
   of the 5 text layers (v32–v36) — remember all copies.

## Editing this template (common asks)

- **Change the name:** set `text` on `objects/1` of every text layer (v32–v36 here — find
  them as scene layers whose objects include "Text"). Keep all copies identical.
- **Change colour scheme:** grid colour = v0 material/Color Overlay; accents = Color
  Overlay effects on white copies; leave shadow copies dark.
- **Retime to a new song:** compute new beat grid, then `edit_clip start=` for every
  accent layer and re-key Shake/Twitch on v37 (or replace with the expression in R7).
- **Remove green screen:** add a full-frame background (shape/scene) on the lowest track,
  or change whatever renders green at frame 0 (inspect with render_frame + describe_layer).

## Building a new intro from scratch (plan)

1. `get_project`; set resolution/rate (`set_sequence_property`). Decide BPM → beat grid.
2. Background scene (grid / gradient / mesh tree) on track 0, slow camera or root-group drift.
3. Text scene: 3D `Text` object, bold font; add Transform effects for tilt + elastic pop
   on HIT 1. Duplicate 2–4× below as dark offset shadows.
4. Build ONE ring burst and ONE spike burst scene (R1, R2) with its shadow pair; then
   `duplicate_layer` + `edit_clip start=<hit>` onto each beat, alternating sizes.
5. Top adjustment layer: Antialiasing per scene, then Bloom + grade, Shake impacts,
   Twitch strobe, Shutter reveal, Duplicate whip-spin at the mid transition.
6. `render_frames` at hit−1, hit, hit+3, hit+10 for 2–3 hits + the transition midpoint.
   Fix timing/size, then report what to tweak (text, colours, BPM).
