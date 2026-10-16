# Template B — glitch / distortion 3D-text intro ("template", letterboxed)

Source: second user template studied via MCP (1920x1080, 30 fps, 450 f sequence, content
f41–365). Style: heavy distortion, static, pixel sort, hue flashes, chunky beveled text,
cinematic letterbox. Recipes R# are in `openzoid-mograph-recipes` (R12–R17 come from
this template).

## What it looks like

| Frames | What happens |
|---|---|
| 41–56 | Black, letterbox already on |
| 56–70 | "boom": edge-detected glitch flash (GLITCH clip 14 f), pixel-sort + bloom |
| 70–100 | Text in, radial-blur zoom, hue flash steps red→orange→blue every 7 f (R13) |
| 71–176 | BOX cascade: 4 hollow squares open at 71/78/85/92, each inverting/pixelating what's under it (R12) |
| 85–239 | TV Damage static layers staggered ~7 f, each fading out over 99 f (R15) |
| 140–183 | Big glitch hit: Color Shift + radial blur + pixelate + pixel sort + Static; invert section 140–212 |
| 158–323 | Text rig steps: L, R, FIN each add a z-rotation step (expo in → expo out), offset ~27 f (R14) |
| 169–253 | Duplicate + Mask adjustment = tiled/mirrored wall of the frame (screen-in-screen) |
| 184–282 | Second BOX cascade (184/191/198) |
| 226–319 | Radial-blur light burst, white-out, then INVERT (253–319) |
| 261–343 | Rect "bar" in each text scene scales y 0→8 (expo in-out) = shape wipe closing the text |
| 365 | End |

Rhythm: everything sits on a **7-frame grid** (~16th notes); hits every 28 f (bar),
big sections every ~84 f (3 bars). Stagger copies by 7 f.

## Track stack (bottom → top)

| Tracks | Role |
|---|---|
| v0 "3D BG Composite" | composite holding 11 scene layers (3D background) |
| v1–v8 BOX | adjustment layers, mask-ring windows; v1–v4 also Flip (mirrored variant) |
| v9 boom | Edge Detection + 2 masks + group — the opening flash |
| v10 TEXT COMPOSITE `[EDIT HERE]` | composite with 6 scene layers: text copies 1/2/3, SABER, SHINE (+ a plain bg scene). Group(Duplicate, Fisheye, Wavy) + Fisheye on the composite |
| v11 | Pixelated on everything ("I'm lazy to put the effects on a composite") |
| v12 Holographic | custom "Holomatrix Expression" effect group |
| v13–v26 | stacked one-shot FX clips: GLITCH, STATIC (TV Damage), EDGE DETECT, INVERT |
| v27 | master distort: CC Radial Blur, Improved Duplicate Expression, Pixelated, hue Color Overlay, Swirl/Wavy, Static, Duplicate |
| v28 SYNC | beat engine: Brightness+Contrast, 2× S_Shake (SmokeArtz group), Directional Blur, RGB Shift, Bloom, Duplicates, Optics Compensation |
| v29 CC | grade: Color Adjustment + Radial Blur/B+C pairs |
| v30 | finishing: Fisheye group, 2× Shutter (letterbox R16), Image Overlay (watermark) |

## Architecture lessons

1. **Effects live on adjustment layers, not on content.** Content (text, bg) sits in
   two composites; ~25 adjustment layers above do all the look. Each FX clip is a
   one-shot event placed on the grid — editing timing = moving clips.
2. **Composite = editable package.** The text composite bundles every text variant
   (plain, saber outline, shine rays) so the user edits text in one place and all
   looks stay in sync. Name it `[EDIT HERE]`.
3. **Group-per-motion rig** (R14): `Group > BEAT > CONT MOV > L > R > FIN > ROTAT1 >
   ROTAT2 > ROTAT3 > ADJ > TEXT > TEXT [EDIT THIS] > text copies`. Each group owns one
   job (beat bump, continuous drift, rotation step 1/2/3, final move), so keyframes
   never fight and any job can be retimed alone.
4. **Faux-3D text**: 6 copies of the same Text object (bevel on, `size [6,1]`, object
   scale z 0, group scale z 0.1) stepped back (y −1.47, z −1 on the last) with darker
   materials, the front copy using an Image (texture) material. Plus a "slogan" text.
5. **Stagger duplicates by the grid**: BOX ×4 at +7 f, TV Damage ×N at +7 f, colour
   steps every 7 f. Reads as rhythmic without needing many keyframes.
6. **Letterbox from day one** keeps glitches feeling cinematic and hides edge artefacts
   from Duplicate/Fisheye.

## Editing this template

- **Change text:** v10 composite → each scene `objects/N` (1, 2, 3, SABER, SHINE) → the
  rig down to `TEXT [EDIT THIS]` → every `template` Text object's `text` (6 per scene +
  `slogan`). Use describe_layer on `objects/N/objects/1/objects/0/...` to walk down;
  set all copies identically (set_properties in one call).
- **Change colour flashes:** v27 `effects/3` Color Overlay `color` keyframes (HUE blend).
- **Retime:** shift FX clips with edit_clip on the 7 f grid; text rig keys are inside
  the composite (clip start 41 → frames are relative to 41).

## Building a glitch intro from scratch (plan)

1. Black bg + letterbox adjustment (R16) on top.
2. Text: composite with a scene; Text object with bevel, 4–6 stepped copies (faux depth);
   rig groups BEAT / CONT MOV / ROT steps (R14).
3. Pick a grid (e.g. 7 f). Drop one-shot FX adjustment clips on hits: glitch hit (R17),
   TV static fades (R15), box-ring windows (R12), invert sections.
4. Master adjustment: hue flash overlay (R13), Pixelated, Radial Blur, RGB Shift, Bloom.
5. render_frames at each hit ±2 f; glitch looks must be judged by eye.
