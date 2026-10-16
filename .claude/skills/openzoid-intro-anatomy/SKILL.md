---
name: openzoid-intro-anatomy
description: Blueprints of professional beat-synced Panzoid / openzoid intros studied from real templates — (A) clean white-burst intro with elastic text, purple grid and whip spin, (B) glitch/distortion intro with letterbox, beveled 3D text rig, box-window cascades, TV static and hue flashes, (C) soft pastel minimal intro with particles, radial reveal, focus-pull text and circle-wipe end card, (D) flat geometric radial-wipe shape intro with pie wedges, echo trails, splitscreen and tile-wall ending, (E) cinematic monochrome 3D logo intro with render passes, hidden camera cut, breathing letterbox and tilt-shift, (F) classic 3D chrome-text intro with stacked neon edge passes, per-letter animation and colour sections. Track layouts, timing maps, beat grids, architecture lessons and step-by-step build plans for the openzoid MCP tools. Use whenever the user asks for a YouTube/channel intro, outro, logo or title sting, glitch intro, soft/aesthetic/pastel intro, cinematic/3D logo reveal, Panzoid-style template, anything "beat-synced", or wants to understand, clone, retime or re-text an existing intro project.
---

# Panzoid intro anatomy

Two dissected templates. Pick the one closest to the requested style and read its
reference file before building or editing:

| Style | Read | Signature |
|---|---|---|
| Clean / bright / bursts | `references/clean-burst-intro.md` | white shapes + dark offset shadows, ring & spike bursts, elastic text pop, whip spin, green screen |
| Glitch / distortion / cinematic | `references/glitch-3d-intro.md` | letterbox, beveled faux-3D text in a composite with a group-per-motion rig, adjustment-layer FX clips (box windows, TV static, pixel sort, invert), hue flashes |
| Flat geometric / radial shapes / motion design | `references/radial-shapes-intro.md` | radial pie-wedge wipes, line rays, diamonds/starbursts, 1-frame echo trails, splitscreen scroll, Duplicate-wall end, key-colour bg, 70 named tracks |
| Cinematic / 3D logo / monochrome / filmic | `references/cinematic-3d-logo-intro.md` | 4K60, one 3D scene split into render passes, lit striped wall, hidden camera cut, breathing letterbox, tilt-shift, displacement text reveal |
| Classic 3D text / chrome letters / neon glow (older Panzoid style) | `references/classic-3d-text-intro.md` | 60 fps, six stacked text passes (beauty, neon edge, rays, halo, glow), per-letter assemble/explode, camera punch-ins with hard cuts, red/blue HUE sections |
| Soft / pastel / minimal / calm | `references/soft-pastel-intro.md` | shutter-made solid colours, particle triangles with camera dolly, radial reveal with soft shadow, focus-pull text, one shared two-step expo timing, circle-wipe end card |

Recipes (R#) are in `openzoid-mograph-recipes`; units/connection/easing gotchas in
`openzoid-mcp`.

## Shared principles (all templates do this)

1. **Rhythm grid first.** Every clip start and key snaps to a grid: A uses ~17.5 f
   beats, B uses a 7 f grid (hits every 28 f), C uses shared keyframe triplets
   (55/73/128, 182/217/254). Pick BPM or phrase points → frames before building.
2. **Two-step expo ease is the house style** in all three: start → mid "exponential in",
   mid → end "exponential out" (R23). Default to it for any big move.
3. **Content is simple, FX layers do the work.** One or two content layers (text,
   background); the look comes from stacked adjustment layers and short one-shot clips.
4. **Duplicate and stagger** instead of hand-animating many things: copy a finished
   accent layer, `edit_clip start=` onto the next hit.
5. **Fake depth cheaply:** offset dark duplicates (A), stepped text copies (B), blurred
   dark shadow copies (C) — not lights.
6. **One master adjustment** owns camera feel (shake, spin, strobe, grade, letterbox).
7. **Name edit points** (`[EDIT HERE]`, `TEXT [EDIT THIS]`, `MOVE BG HERE`) so the user can
   find what to change; when re-texting, update every copy.

## When asked to "study" a new template

1. `get_project` + `render_frames` (12 frames across content range) for the visual story.
2. `describe_layer` composites, rig groups and the master adjustment layers; read
   keyframes to get the timing grid.
3. Prove any new trick on a `ZZ_TEST` layer, render, delete.
4. Add a new `references/<style>.md` here and new recipes to `openzoid-mograph-recipes`.
