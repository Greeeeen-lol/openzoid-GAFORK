# Template E — cinematic 3D logo intro (Panzoid "P" + "panzoid", monochrome, 4K60)

Source: fifth user template studied via MCP (**3840x2160, 60 fps**, 559 f ≈ 9.3 s,
22 tracks). Style: restrained, filmic, black-and-white: lit 3D striped wall, 3D logo,
thin spline lines, breathing letterbox, tilt-shift blur, one hidden camera cut,
text resolving out of displacement streaks. Recipes R# are in
`openzoid-mograph-recipes` (R29–R33 come from this template).

Frame numbers here are at 60 fps; halve them for a 30 fps project.

## What it looks like

| Frames (60fps) | What happens |
|---|---|
| 0–~60 | Fade up from black (fade pass, Box Blur) |
| 0–189 | Slow push on the 3D "P" logo against a striped lit wall; "just" text detail |
| 189–230 | Whip: rig tilts x 0→π/2 ("exponential in"), cam group z 0→200 ("exponential in"), letterbox tightens 0.2→0.25 |
| 230 | **Hidden cut** — rig jumps (z rot −π, pos z +175) with `"none"` keys (R30) |
| 230–451 | Second "shot": rig settles −π→−π/2, z 175→−25, "circular out"; spline lines sweep; letterbox opens to 0.05 (f341, "circular out") |
| 341–437 | "panzoid" text resolves: Displacement Map amount 0.1→0, offset scrolling (R32); letterbox closes back to 0.2 |
| ~437–500 | Fade/blur out to black |

## Track stack (bottom → top)

| Tracks | Role |
|---|---|
| v0 bg | scene pass: lights + cam rig + All(bg shape) + Color Overlay |
| v1 wall | **same rig**, All = 3 × 21 stripe shapes; Wavy |
| v2 fade | same rig, fade elements; Box Blur |
| v5 splines | same rig, spline lines; 2× Antialiasing |
| v7 blur | adjustment Gaussian Blur over the background passes (depth of field) |
| v8 dropshadow | same rig, logo only; "Dropshadow" group = Color Overlay + Gaussian Blur + Transform offset (R31) |
| v9 text | same rig, logo; B+C, Edge Detection, Negative (inked outline look) |
| v10 blur | blur between logo and wordmark |
| v11 / v12 | "panzoid" wordmark: shadow copy (Color Overlay + blur) under main; both Displacement Map + Pixelated (R32) |
| v13 sync | Sync group: Shake, Twitch (Duplicate, Directional Blur, Gaussian Blur, Color Shift ×2, RGB Shift, B+C), Transform |
| v14 fx | Negative, Transform, Sharpen, 2× Pixel Sort, Radial Blur |
| v15 idk | Mask + 2× Mirror |
| v16 cc | Fisheye + Sharpen (lens feel) |
| v17 / v18 | Swing-Tilt top / bottom (R33) |
| v19 | Gaussian Blur + Mask (edge softening) |
| v20 cc | Shutter |
| v21 shutter | breathing letterbox (R29) + Color Overlay |

## Architecture lessons

1. **Render passes from duplicated scenes** (R31): every pass layer has the same rig
   (lights, `cam`, `All > moive > moivem > movement…`) but holds only its own content
   (bg: 1 shape; wall: 3 × 21 stripes; logo/splines in theirs). Identical camera + movement rigs keep the passes aligned,
   and each pass gets its own effects and blur layers in between (depth of field,
   shadows, outline looks). The cost is that every edit to motion must be copied to every pass.
2. **Camera rig = nested groups**: `cam` group (scale 0.5) holds the Camera;
   `All > moive > moivem > movement > movement > texts` holds content. Each level holds
   one move (tilt, roll, push, cut), same idea as R14.
3. **Restraint**: monochrome, one cut, letterbox and blur do the drama. Effects layers
   (sync/fx) are subtle.
4. **Work in 4K60 for crispness**; mask positions/sizes double (top edge y ≈ 999–1080).

## Editing this template

- **Wordmark:** v11 and v12 `objects/1` Text `text` (keep both identical).
- **Logo:** the logo shapes live in the `texts` groups of the logo pass layers (v8, v9);
  replacing it means editing every pass that contains it.
- **Timing:** the cut is at 229/230; the rig keys in `moive`/`moivem` and the `cam`
  group must move together across ALL pass layers.

## Building a cinematic logo intro (plan)

1. Build one scene: lights, `cam` group > Camera, `All` > nested move groups > content.
2. Animate the rig: slow push (shot 1), whip into a `"none"` cut, settle (shot 2).
3. Duplicate the layer per pass; disable everything but that pass's content in each copy.
4. Insert blur adjustment layers between passes for depth; shadow pass under the logo.
5. Top: breathing letterbox (R29), tilt-shift (R33), lens Fisheye + Sharpen, a subtle
   Sync shake. Wordmark resolves via displacement (R32). Fade to black.
