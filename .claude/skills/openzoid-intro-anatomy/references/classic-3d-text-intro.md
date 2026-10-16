# Template F — classic 3D text intro (shiny letters, neon edge glow, "by selciohd")

Source: sixth user template, an older-generation Panzoid 3D intro (1920x1080, **60 fps**,
901 f ≈ 15 s). Style: chrome/metallic 3D letters with neon edge glow, red ↔ blue
section colours, flying particles, abstract tunnel "Form", hard camera cuts, letter-
by-letter spacing animation. Older workflow (camera keyed directly, very deep rigs),
but the look-building ideas still hold. Recipes R34–R38 come from this template.

## What it looks like (60 fps frames)

| Frames | What happens |
|---|---|
| 0–129 | Shot 1: camera travels through a glowing tunnel/Form (z −33.5 → 67.8, roll 0.13 → −0.79) |
| 130 | **Cut** (`"none"` keys on camera position/rotation) |
| 130–390 | Shot 2: letters assemble (X_Pos −10 → 0 "cubic out" at 282) then spring apart ("elastic out" at 347); camera z punches in/out each beat (100 → 127.6 "circular in" → 173 "circular out" → 115 → 59 …); red section (HUE overlay on 173–195, 477–738) |
| 391 | **Cut** again |
| 391–716 | Shot 3: blue section, rig spins (Z rot → 6.58, → 9.83 at 824), particles stream past |
| 694–716 | Colour stepped fast (HUE overlay red/blue/yellow every ~11 f) |
| 716–824 | Outro: blur adjustment on, edge-glow gradient rotates 2 turns (shimmer), white-out |
| 824–900 | Fade to black |

## Track stack (bottom → top)

| Tracks | Role |
|---|---|
| v0 BG | Perspective Camera + SCALE rig; Box Blur, Sharpen, Wavy |
| v1 Form | tunnel/abstract form pass |
| v2 Particles | particle pass |
| v3 Blur | Gaussian Blur adjustment for the outro (716+) |
| v5 Text | Negative + Box Blur (dark soft halo pass) |
| v6 Text | Gradient Overlay + Edge Detection + Radial Blur (light rays from the edges) |
| v7 Text | Edge Detection + Chroma Key + Gradient Overlay + Wavy (wobbly outline) |
| v8 Text | Edge Detection (25) + Chroma Key black + angular Gradient Overlay (rotating) + Bloom + Exposure (neon edge, R35) |
| v9 Text | **main beauty pass**: shiny letters + "Reflections kid" env objects (R36) + Exposure |
| v10 Text | Edge + Chroma Key + 2× Bloom + Box Blur (soft outer glow) |
| v12 Sync/Other | Basic Sync group: Duplicate, 2× Twitch (Transform, RGB Shift, Directional Blur, 21 keyed "Amount" hits), Bloom, 2× Shake |
| v13 CC | Technicolor, Color Grading (red highlights, blue mids), B+C, 2× Color Correction, Exposure, Radial Blur, Bloom, Fisheye |
| v14 Post | HUE Color Overlay sections (R37), 2× Shutter, Saturation, Gaussian Blur |
| v69 | Image Overlay (watermark "by selciohd") |

All scene layers carry the **same camera keys and SCALE rig**, so they're render passes
of one scene (like template E, R31), and six text passes stack into the final look.

## Architecture lessons

1. **Text look = stacked passes of the same 3D text**: beauty (reflective), dark
   halo, edge rays, wobbly outline, neon edge, soft glow. Each pass is one simple
   effect chain; together they read as rich lighting.
2. **Edge Detection → Chroma Key black** isolates outlines of a 3D render as a
   separate glowing layer (R35).
3. **Hard cuts by `"none"` keys on the camera itself** (older style; R30 uses a rig).
4. **Axis rig** (R38): `Z > Z2 > Y > Y2 > X > X2` then per-letter `[i] x > X_Pos >
   X2_Pos > Y_Pos > Y2_Pos > Z_Pos > Z2_Pos > Z > … > Rot > letter`. Every axis and
   every letter can move independently. Powerful but very deep: describe_layer paths
   get long, so walk it level by level.
5. Some keyframes report a numeric easing (e.g. `277`): a custom bezier curve made in
   the UI. MCP can read it but can't recreate it by name; use the nearest named ease.

## Editing this template

- **Text:** each letter is its own Text object deep in the per-letter rig, repeated in
  every text pass (v5–v10). Re-texting means editing every letter in every pass,
  which is laborious. For a new word it's usually faster to rebuild with the plan below.
- **Section colours:** v14 `effects/0` Color Overlay (HUE): `opacity` on/off ranges and
  `color` steps.
- **Grade:** v13 Color Grading highlights/midtones.

## Building a classic 3D text intro (plan)

1. One scene: camera, axis rig group(s), 3D Text (bevel on) per letter in its own group
   (or one Text object if no per-letter motion is needed). Shiny Custom Material.
2. Animate: camera dolly punches on beats ("circular in" → "circular out"), letter
   spacing assemble/explode (R34), rig spin on the drop, `"none"` cuts between shots.
3. Duplicate into text passes: neon edge (R35), dark halo (Negative + Box Blur), rays
   (Edge + Radial Blur), soft glow (Edge + Chroma + Bloom×2 + Box Blur).
4. Particle pass + background Form pass with the same camera.
5. Top: Sync group (Twitch/Shake/RGB Shift on hits), CC (Color Grading split tones,
   Technicolor, Bloom, Fisheye), HUE colour sections (R37), blur/fade outro.
