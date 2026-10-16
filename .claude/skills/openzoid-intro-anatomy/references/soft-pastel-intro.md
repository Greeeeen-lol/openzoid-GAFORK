# Template C — soft pastel minimal intro ("your text here", green-screen circle reveal)

Source: third user template studied via MCP (1920x1080, 30 fps, 299 f). Style: calm,
airy, white/pastel, slow hue cycling, soft blur, gentle drift — no hard beat hits.
Recipes R# are in `openzoid-mograph-recipes` (R18–R23 come from this template).

## What it looks like

| Frames | What happens |
|---|---|
| 0–55 | Full green (the reveal shutter is closed) |
| 35–129 | Ring reveal: ellipse-masked circle grows from centre (0→300 at +38 f, →500 at +94 f) |
| 55–128 | Green radial Shutter opens 0.5→0.25 (f73, "exponential in") →0 (f128, "exponential out"), with a soft black 50 % shutter on the same timing as its shadow (R18) |
| 55–110 | Text focus-pull: blur 2→1→0 on the same two-step timing |
| 73–236 | Background particle triangles: camera dollies z −250→80, roll 5°→0, "exponential out" |
| 55–254 | Everything slowly hue-cycles (Color Shift 0→1) |
| 91–222 | c1/c2 mirrored masked accents; small hue-cycling arcs in the corners |
| 182–254 | Text exits: scale 1→0.5→0, rotate 0→5°→10°, blur 0→1→2, Color Shift 0→0.5→1 |
| 162–254 | Red end circle (with blurred shadow copy) scales 0→0.5 (f217)→1 (f254) and covers the frame |
| 254–299 | Solid red end card |

## Track stack (bottom → top)

| Tracks | Role |
|---|---|
| v0 BG - White | scene with no objects + Shutter (doublesided, cover 0.5) = solid white (R19) |
| v1 BG - Scan Lines | Scan Lines texture overlay |
| v2 BG - Colorful Wavy | solid shutter (cover 0.15, fade 0.1) + Image Overlay (gradient) + Color Shift + Wavy |
| v3 BG - Dark Sides | shutter-based side vignette |
| v4–v8 Triangles UP/DOWN/LEFT/RIGHT/Donut | particle scenes, custom triangle texture, gravity per direction, `time` keyed 0→5 at f0 then 5→10 over the clip for slow drift (R20) |
| v9 Circle (×2) | ellipse-mask ring reveal at f35 and f162 (R21) |
| v10/v11 RIGHT/LEFT | full-frame scenes at opacity 0.02, BLEND_PLUS — barely-there additive glow with Wavy + Scan Lines (R22) |
| v12 BG - Transition | green radial reveal shutter + shadow shutter (R18) |
| v15/v16 c1/c2 | masked, mirrored accent scenes |
| v17 Rays, v18 Particles | light rays + swirling particles |
| v19 | Color Shift on everything at the outro |
| v20/v21 End Shadow / End | red circle wipe + blurred dark copy underneath |
| v22 TEXT - [EDIT HERE] | text composite; B+C, Gaussian Blur, Transform, Color Shift on the composite |
| v23 | FURRY SYNC (Shake 0.001, speed 0.2 = handheld drift), Duplicate, Shutter, Image Overlay (watermark) |

## Architecture lessons

1. **One easing signature everywhere** (R23): every move is two segments,
   start → midpoint ("exponential in") → end ("exponential out"), and the midpoint sits
   ~1/3 of the way through. Shutter, scale, blur, colour shift and camera all share the
   same keyframe frames (55/73/128 for the intro, 182/217/254 for the outro), so the
   whole frame breathes as one.
2. **Solid colours without shapes:** an empty scene + Shutter fully covered is a
   colour card. Stack several with partial cover/fade for gradients and vignettes.
3. **Calm ≠ static:** constant micro handheld shake, slow hue cycle, slow particle drift
   and a camera dolly keep it alive with zero hard hits.
4. **Exit as a mirror of the entrance** (scale/blur/hue reversed) then cover with a big
   circle wipe in the brand colour for a clean end card.

## Editing this template

- **Text:** inside v22 composite (`TEXT - [EDIT HERE]`).
- **End colour:** v21 `objects/1/material color` (and v20 shadow stays dark).
- **Green-screen colour:** v12 `effects/1` color (set to the background you want, or
  disable both v12 shutters to start on the pastel scene).
- **Pacing:** shift the shared keyframe triplets (55/73/128, 182/217/254) together.

## Building a soft intro from scratch (plan)

1. Solid bg (R19), gradient Image Overlay or tinted shutters, slow Color Shift 0→1.
2. Particles scene (R20) with soft texture, low opacity, camera dolly.
3. Text composite: focus-pull in (blur 2→0), exit by scale/blur/hue (R23 timing).
4. Reveal with radial shutter + shadow (R18) or ellipse ring (R21); end with circle wipe.
5. Master: tiny Shake (0.001, speed 0.2) for life. No strobes.
