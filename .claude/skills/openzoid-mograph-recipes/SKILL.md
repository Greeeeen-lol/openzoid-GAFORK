---
name: openzoid-mograph-recipes
description: Proven, copy-paste motion-graphics recipes for openzoid / Panzoid Clipmaker 3 via the openzoid MCP tools — expanding ring bursts, spike/shard bursts, hollow-out cutouts with Chroma Key, stacked shadow pairs, elastic text pop, radial shutter reveals, whip-spin transitions, beat-synced shake and Twitch strobes, roundifier and custom drop-shadow effect groups, recursive-group duplication, adjustment-layer box windows, hue-flash colour steps, group-per-motion rigs, TV static fades, letterbox and glitch-hit stacks, soft radial reveals, shutter solid colours, ambient particles, ellipse ring reveals, the two-step expo ease, radial pie-wedge wipes, 1-frame echo trails, splitscreen tile scrolls, tile-wall endings, drop-hit groups, breathing letterbox, hidden camera cuts, render passes, displacement text reveals, tilt-shift blur, letter-spacing explode, neon edge passes, reflection env objects, HUE section colours and axis rigs. Use whenever building or polishing an intro, title, logo sting, transition, burst, "Panzoid-style" animation or any 2D/3D motion graphic in openzoid, even if the user only describes the look ("make it pop", "add some bursts on the beat").
---

# openzoid motion-graphics recipes

Learned by dissecting a pro Panzoid intro template (see `openzoid-intro-anatomy`) and
re-verified live through MCP. Read `openzoid-mcp` first for units/gotchas.

**Index** (✅ = verified live through MCP)
- Shapes & bursts: 1 ring burst ✅ · 2 spike burst · 11 cutouts · 21 ellipse ring · 24 radial wedge ✅ · 10 recursive groups
- Depth & looks: 3 shadow pair · 8 roundifier · 9 drop-shadow shader · 22 ghost glow · 31 render passes · 35 neon edge pass · 36 reflections (unverified)
- Text: 4 elastic pop · 14 group-per-motion rig · 32 displacement reveal · 34 letter-spacing explode · 38 axis rig
- Reveals & transitions: 5 radial shutter · 6 whip spin · 12 box window ✅ · 18 radial reveal + shadow · 25 echo trail · 26 splitscreen · 27 tile-wall end · 30 hidden cut
- Rhythm & energy: 7 beat shake/strobe · 13 hue flash · 15 TV static · 17 glitch hit · 28 drop group · 37 HUE sections
- Frame & finish: 16 letterbox · 29 breathing letterbox · 19 shutter solids · 20 particles ✅ · 23 two-step expo ease · 33 tilt-shift ✅

Notation: `L` = layer id from `get_project`. Frames are clip-relative.
Keyframes written `{frame, value, easing}`; **easing belongs on the keyframe being
eased INTO** (engine uses the destination keyframe's tween — despite the tool schema
text). All recipes below follow that.

---

## 1. Expanding ring burst  ✅ verified live

Two identical circles in a scene. Outer = white, inner "cutter" = black, inner starts
growing a few frames later. Chroma Key on black deletes the cutter → a ring that
expands and thins out to nothing.

```
add_layer   kind=scene name="Circle Burst" start=<hit> length=35
add_node    L objects  Group  name=Ring
add_node    L objects/1/objects Circle  name=Outer  props circle_size=10 circle_detail=50
add_node    L objects/1/objects Circle  name=Cutter props circle_size=10 circle_detail=50 position=[0,0,0.1]
add_node    L effects  "Chroma Key"  props backgroundColor=[0,0,0]
set_properties  objects/1/objects/0/material color=[1,1,1]
                objects/1/objects/1/material color=[0,0,0]
animate_property objects/1/objects/0 scale  [{0,[0,0,0]},{27,[1,1,1],"circular out"}]
animate_property objects/1/objects/1 scale  [{7,[0,0,0]},{34,[1,1,1],"circular out"}]
```
Knobs: delay between outer/inner = ring thickness; circle_size = final radius
(10 ≈ 230 px wide); stack several at staggered starts / different sizes for a cascade.

## 2. Spike / shard burst (radial)

- Spike = Circle with `circle_detail: 3` (triangle), `circle_size ~28`, scale
  `[5.66, 0.66, 1]`, rotated π so the point faces out, positioned at x≈119.
- Put 2 spikes (opposite sides) in a Group, then copy that Group 4× rotated 0, π/2, π,
  3π/2 (z) inside a parent group, and duplicate the parent rotated π/4 → 16 spikes.
  Vary each sub-group's z position slightly so they don't z-fight.
- Hollow it from the centre: add a black Circle (radius ~98, detail 50) at the centre,
  scale 0→1 frames 6→40 "circular out", + Chroma Key black. Spikes appear to retract
  outward.
- Optional radial reveal: `Shutter` mode=radial (2), color black, `covered` 0.5→0
  frames 3→15 "circular out" (then keyed out by the same Chroma Key).

## 3. Shadow pair (the Panzoid "depth" look)

Every element exists twice on adjacent tracks:
- **Shadow copy (lower track):** same layer, layer position y −30 to −40, opacity 0.5,
  `Color Overlay` dark (black or [0.165,0.165,0.165]).
- **Main copy (upper track):** Color Overlay white (or palette colour).

Fast way: build main → `duplicate_layer` → `edit_clip track=<below>` → set position,
opacity, overlay colour on the copy. For 3D-ish text, stack 4–5 copies at small y steps
with darker overlays toward the bottom = faux extrusion.

## 4. Elastic text pop (via Transform effect, not layer scale)

Text lives as a 3D `Text` object (font asset, `size [25,3]`) in a scene. Animate the
**Transform effect** `imageScale` so all layer effects stay coherent:

```
add_node L effects Transform
animate_property node=effects/N path=imageScale
  [{81,[0,0],"linear"},{123,[1,1],"elastic out"}]
```
Re-pop mid-intro (used for a transition): `[{116,[1,1]},{152,[0,0],"circular in"},{203,[1,1],"elastic out"}]`
— shrinks away accelerating into 152, then springs back by 203.

A second Transform with static `imageRotation [-0.349,0,0]` tilts the text back (~20°)
for perspective.

## 5. Radial shutter reveal / wipe (adjustment layer)

`Shutter` on an adjustment layer covering the whole intro:
- mode 2 (radial), color white, `covered` 0.5 (fully covered) → 0.4 "circular in" →
  0 "circular out". Template: frames 55 → 84 → 119. Reads as a white circle that
  punches open to reveal the scene.
- `fade` 0.001 keeps a hard edge. Stack several Shutters with offset timing for
  layered wipes.

## 6. Whip-spin transition

`Duplicate` effect on a top adjustment layer, animate `rotation`:
`[{116,0},{152,π,"exponential in"},{187,2π,"circular out"}]`, `repeat: reflect`.
The whole frame spins faster into the midpoint and settles out. Pair with the
text scale-out at the midpoint (recipe 4) so the content swap is hidden.

## 7. Beat-synced shake & strobe

Pick a beat interval (template: ~17.5 f @30 fps ≈ 103 BPM; hits at 81, 98, 116, 134,
152, 169, 187, 203, 223).

- **Impact shake:** adjustment-layer `Shake`, `amplitude` keys: hit−1 → 0, hit → 0.007,
  next hit−1 → 0 (linear decay). Shake settings: mode rotate, amplitude [8.7,3,0,0],
  freq [0.62,1,0,0], speed 5, wrap reflect.
- **Twitch strobe:** `enabled` keys: hit−1 off, hit on, hit+2 on, hit+3 off — put
  `"none"` on each keyframe so values hard-cut. 3-frame glitch on every hit.
- **Expression alternative** (one call instead of 20 keyframes):
  `var b = 17.5; var p = max(0, 1 - ((frame - 81) % b) / b); frame < 81 ? 0 : 0.007 * p`
- Also spawn a ring/spike burst (recipes 1–2) on each hit, alternating sizes.

## 8. Roundifier (rounded corners on anything)

User-made effect group `roundifier 1.0` = Box Blur (`delta` driven by expression
`properties["roundness"]`) → Brightness+Contrast (brightness 1, contrast 1, i.e. thresholds
the blurred alpha back to hard edges) → two Radial Blurs. Blur + threshold rounds every
corner. To reuse it, `duplicate_layer` a layer that already has it, or rebuild:
Box Blur delta 0.5–1 + Brightness/Contrast with high contrast.

## 9. Custom Drop Shadow shader

Shader effect "Drop Shadow" with custom props color / opacity / offset. Fragment shader:

```glsl
precision highp float;
uniform sampler2D tDiffuse; varying vec2 vUvScaled;
uniform vec3 color; uniform float opacity; uniform vec2 offset;
void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  gl_FragColor = texel;
  vec4 src = texture2D(tDiffuse, vec2(vUvScaled[0]-offset[0]/100.0, vUvScaled[1]-offset[1]/100.0));
  if ((src[3] != 0.0) && (src != vec4(color,src[3])) && (texel[3] == 0.0))
    gl_FragColor = vec4(color, opacity);
}
```
Hard-edged flat shadow only where the frame is empty. Catalog `Shader` effect takes a
`fragShader`; custom uniforms come from the effect's customProperties.

## 10. Recursive duplication (cheap big backgrounds)

Background grid: Group → 2 Groups → 2 Groups → … (binary tree, 4–5 levels) each child
offset along z, leaf = one imported mesh ("3dmountains.obj"). 2⁵ = 32 tiles from one
mesh. Name the root something like `MOVE BG HERE` and animate only it:
position z −5583 → −5100 linear over the whole clip = endless slow fly-over.
Add Bloom + Antialiasing on the layer, and an inverted ellipse `Mask` (feather 1) for
a soft vignette edge.

## 11. Cutouts in general

Black (or any key colour) geometry + `Chroma Key backgroundColor` = holes / mattes
inside a scene layer. Faster and more flexible than masks for animated shapes.

---

Recipes 12–17 come from the glitch template (`openzoid-intro-anatomy` → glitch-3d-intro).

## 12. Box-window ring on an adjustment layer  ✅ verified live

Same idea as R1 but with masks, so it processes whatever is underneath (footage, text,
anything) instead of drawing a shape.

```
add_layer kind=adjustment name=BOX start=<hit> length=84
add_node  L "Negative"   (or a Group of Negative + Pixelated + Edge Detection)
add_node  L Mask  props mode=0 position=[x,y] feather=0.02           # outer
add_node  L Mask  props mode=0 position=[x,y] feather=0.02 invert=1  # inner cutter
animate_property effects/1 size [{0,[0,0]},{25,[400,400],"exponential out"}]
animate_property effects/2 size [{5,[0,0]},{30,[400,400],"exponential out"}]
```
Mask `size` ≈ half-width in px (400 → ~770 px box at 1080p). Template version: sizes
0→100 ("exponential in") →200 ("exponential out") over 84 f, inner lagging 5–13 f,
plus a Transform `imagePosition [0,158,0]` so the window shows an offset copy, opacity
1→0, and a `Flip` variant. Cascade 4 copies at different positions, +7 f apart.

## 13. Hue-flash colour steps

Adjustment layer `Color Overlay`, `blending: BLEND_HUE`, opacity 0.7. Key `color` every
7 f with `"easing":"none"` (hard steps): red [1,0,0] → orange [1,0.667,0] → blue [0,0,1]
→ purple [1,0,0.667]… Key `enabled` on/off (also "none") to limit flashes to sections.
Recolours the whole frame without touching any content.

## 14. Group-per-motion rig (stackable keyframes)

Nest empty Groups, one per motion job, content at the bottom:
`Group > BEAT > CONT MOV > L > R > FIN > ROT1 > ROT2 > ROT3 > ADJ > TEXT > content`.
- BEAT: short bumps on hits. CONT MOV: slow continuous drift (or z offset, here 75).
- L / R / FIN: each holds ONE rotation step, e.g. L z: 158 → 186 (+0.26, "exponential in")
  → 242 (+0.52, "exponential out"); R same shape 27 f later; FIN a big −5.76 rad spin.
  Rotations add up through the hierarchy, so overlapping steps never conflict.
- Retime one job by editing one group; add a new move by inserting a group.
Use this whenever an object needs 2+ independent animations on the same property.

## 15. TV-damage static fade (one-shot)

Adjustment clip 99 f with a static/glitch effect (template: custom "TV Damage" group =
5 Gradient Overlays + RGB Shift + Glitch + Static). Layer `opacity` 1 → 0
"exponential out" over the clip. Stack 6+ copies on different tracks starting +7 f
apart → texture that keeps re-hitting then decays. Built-ins to approximate:
`Static`, `Glitch`, `RGB Shift`, `Scan Lines`.

## 16. Letterbox

Top adjustment layer, `Shutter` mode 1 (linear doublesided), color black, `covered`
0.125, `angle` π/2 (1.5708), `fade` 0.001 → 2.35:1 bars that sit above all FX.

## 17. Glitch hit stack

Short adjustment clip (14–43 f) on a hit: `Color Shift` → `Radial Blur` → `Pixelated`
→ `Pixel Sort` → `Static` (+ `Bloom` for the opening one). Follow with an INVERT clip
(`Negative` + `Brightness + Contrast`) or an EDGE DETECT clip (`Pixelated` +
`Edge Detection` + `Static`) for the next section. Variety comes from swapping which
clip follows the hit, not from tweaking parameters.

---

Recipes 18–23 come from the soft pastel template (`openzoid-intro-anatomy` → soft-pastel-intro).

## 18. Radial reveal with soft shadow

Adjustment layer with two `Shutter`s, mode 2 (radial), both `covered` keyed
`[{55,0.5},{73,0.25,"exponential in"},{128,0,"exponential out"}]`:
- top: brand/green colour, opacity 1, fade 0.001 (hard edge) — the cover that opens;
- under it: black, opacity 0.5, fade 0.1 — a soft shadow ring hugging the opening edge.
`covered 0.5` = fully closed, 0 = fully open.

## 19. Solid colour / gradient without shapes

Scene (or adjustment) layer + `Shutter` mode 1 (doublesided), `covered 0.5`, any colour
= full-frame solid. **It covers the layer's own content**, so use it on an empty
scene as a background card, not on a layer that holds objects. Partial cover (0.15) with
`fade 0.1` gives soft bands; add Image Overlay + Color Shift for a moving gradient.

## 20. Ambient particles (slow drift)  ✅ verified live

```
add_node L objects Particles  props number=500 rate=166 lifetime=50
   pspread=[1000,1500,1000] accel=[0,12,0] (gravity per direction: ±12 on x or y)
   irvel=0 rvspread=0 aspread=0 blending=1(add)
   color=[{position:0.5,color:"rgba(255,201,201,0.28)"}]   # gradient stops over lifetime
   size=[{position:0.3,color:"rgba(102,102,102,1)"}]        # grey level = size
animate_property objects/1 time [{0,5},{<len>,10,"linear"}]
```
- New Particles nodes come with **random** speed/rotation/colour/texture — always reset
  `ivel`, `vspread`, `irvel`, `rvspread`, `iang`, `aspread`, `angvel`, `avspread`,
  `accel`, colour and size.
- `time` is the sim clock in seconds; advancing only a few seconds over the whole clip
  = slow-motion drift. Observed via MCP: the field still fills in over the first ~5
  frames even when `time` starts at 5 (the template's double key at frame 0 can't be
  reproduced — animate_property reorders same-frame keys). If the screen must be full
  from the first visible frame, start the particle clip ~10 frames earlier, under a
  cover (shutter/reveal), or before the sequence content starts.
- `texture`: built-in names (`star1`, `ring`, `circle_soft`, `plume`, … see
  describe_layer options) ✅ verified live; existing project textures are 32-hex
  hashes and can be reused as-is.
- Camera dolly through them: camera z −250 → 80 "exponential out" + roll 0.087 → 0.

## 21. Ellipse ring reveal (scene version of R12)

Scene with a full-frame Rectangle (`rect_size [123,123]` at z0 fills the view) +
Image Overlay/Color Shift for colour, then two `Mask`s mode 1 (ellipse):
outer `size [{0,[0,0]},{38,[300,300],"exponential in"},{94,[500,500],"exponential out"}]`,
inner `invert=1` `[{0,[0,0]},{38,[200,200],"exponential in"},{94,[500,500],"exponential out"}]`.
Ring thickens then both meet at 500 and it vanishes. Feather 0 for crisp edges.

## 22. Ghost additive glow layer

Full-frame scene/effect layer at `opacity 0.02`, `blending BLEND_PLUS`, with Wavy +
Scan Lines + hue-cycling Image Overlay. Adds shimmer you feel more than see; mirror a
copy (`Flip`) for the other side.

## 23. Two-step expo ease (house style)

Any big move: `[{t0, A}, {t1, mid, "exponential in"}, {t2, B, "exponential out"}]` with
`mid = (A+B)/2` and `t1 - t0 ≈ (t2 - t0)/3`. Fast snap in, long silky settle. Put the
SAME t0/t1/t2 on every property that moves together (scale, blur, rotation, hue,
shutter cover, camera) so the frame moves as one. Example text exit:
scale 1→0.5→0, rotation z 0→0.087→0.175, blur 0→1→2, Color Shift 0→0.5→1 at 182/217/254.

---

Recipes 24–28 come from the radial-shapes template (`openzoid-intro-anatomy` → radial-shapes-intro).

## 24. Radial pie-wedge wipe (edge-on plane trick)  ✅ verified live

A plane pointed straight at the camera projects as a wedge radiating from screen
centre. Widen it and spin it = pie wipe, no path drawing.

```
add_layer kind=scene
add_node L objects Group name=Spin
add_node L objects/1/objects Rectangle name=Wedge
   props rect_size=[1,10000] rotation=[-1.5682,0,3.1416]
set_property objects/1/objects/0/material color "#b8f0a0"
animate_property objects/1/objects/0 scale
   [{0,[0.001,1,1]},{27,[1,1,1],"exponential in"},{78,[100,1,1],"exponential out"}]
animate_property objects/1 rotation
   [{0,[0,0,0]},{27,[0,0,-3.1416],"exponential in"},{78,[0,0,-6.2832],"exponential out"}]
add_node L Mask mode=1 size=[500,500]                 # outer edge of ring
add_node L Mask mode=1 size=[150,150] invert=1        # hole
```
- One wedge opens to at most a **half disc**; for a full sweep use two groups
  ("TOP Circle" + "BOTTOM Circle", second rotated π).
- Template animates the masks too: outer 600→500→400, inner 200→100→0, with
  `"elastic out"` on the settle, so the ring wobbles as it lands.
- Stack 3–5 at different radii/colours, start 0–5 f apart.

## 25. Echo trail by 1-frame duplicates

Finish one transition layer, then `duplicate_layer` it 6–9 times, `edit_clip
start=+1` per copy, each copy on a lower track with a darker Color Overlay shade
(template: lightest [0.92,1,0.87] leads on top at f148 … darkest [0.45,0.58,0.36] at
f156 at the bottom). The darker copies trail behind the leader → stepped gradient
smear. Cheap, crisp alternative to motion blur.

## 26. Splitscreen tile scroll

Adjustment layer with a Group: `Duplicate` (repeat tile) + `Mask` (the panel).
Animate Duplicate `offset` y `[{19,[0,0]},{36,[0,-0.5],"exponential in"},{77,[0,-1],"exponential out"}]`
— the panel content scrolls exactly one tile and lands back on the same image.
Use 2+ panels (left/right strips) offset in time or direction.

## 27. Tile-wall zoom-out ending

Top adjustment: `Duplicate` repeat=reflect, `multiplier`
`[{298,[1,1]},{321,[2,2],"exponential in"},{362,[3,3],"exponential out"}]` — the frame
shrinks into a mirrored 3×3 wall. Close with a radial black `Shutter` (fade 0.25 for a
soft vignette edge) covered 0→0.25→0.5 on the same two-step timing.

## 28. Drop hit group

One effect Group named for its role (DROP) on a top adjustment layer holding RGB Shift,
Duplicate, Fisheye, Wavy, Brightness+Contrast, Shake and Directional Blur; key the
big ones on the drop with the two-step expo (e.g. Directional Blur delta 0 → 2 at
the hit "exponential in" → 0 over ~75 f "exponential out"). Toggling the group's
`enabled` mutes the whole hit.

---

Recipes 29–33 come from the cinematic 3D logo template (`openzoid-intro-anatomy` → cinematic-3d-logo-intro).

## 29. Breathing letterbox

Top adjustment `Shutter` mode 1 (doublesided), black, fade 0.001, and **key**
`covered` with the edit instead of leaving it static (R16):
`0→0.1, 189→0.2, 207→0.25 "cubic out", 230→0.125 "quartic in", 341→0.05 "circular out", 437→0.2 "quadratic in-out"`.
Tighten before a big move or cut, open wide for the reveal, close for the ending.

## 30. Hidden camera cut inside one scene

On the rig group(s), hold the pre-cut value on frame N−1 and jump on frame N with
`"none"` easing, then settle with a long ease:
```
rotation z: [{229,0},{230,-3.1416,"none"},{451,-1.5708,"circular out"}]
position z: [{229,0},{230,175,"none"},{451,-25,"circular out"}]
```
Hide the cut by whipping into it: e.g. tilt x 0→π/2 "exponential in" over the 40 f
before, plus a camera-group push z 0→200 "exponential in". The fastest frame of the
whip is where the cut lands, so the eye reads one continuous move.

## 31. Render passes (duplicated scene layers)

Build one scene (lights, `cam` group > Camera, `All` > move groups > content), finish
the motion, then `duplicate_layer` it once per pass: bg, wall, splines, logo shadow,
logo. In each copy keep only that pass's content (the template's passes hold different
content under identical rigs; `delete_node` the rest, or set its `enabled` 0).
Then you can:
- put Gaussian Blur adjustment layers between passes (depth of field);
- give the logo its own shadow pass: Group(Color Overlay black, Gaussian Blur,
  Transform offset) at ~0.5 opacity under the logo pass;
- give only the logo an outline look (Brightness+Contrast → Edge Detection → Negative).
Do motion edits BEFORE splitting, or repeat them on every pass (they must match).

## 32. Displacement text reveal

On the wordmark layer: `Displacement Map` (any noise/stripe texture asset), `amount`
0.1 → 0 (`"quadratic in-out"`, ~96 f @60fps), `displacementOffset` y −0.1 → 0
(`"cubic in-out"`), and `offset` y 0 → 0.2 linear (keeps the streaks moving). `Pixelated`
after it adds grit. The text crawls out of smeared streaks and locks in place.
Shadow copy of the wordmark under it with the same effects + Color Overlay + blur.

## 33. Tilt-shift (swing-tilt) band blur  ✅ verified live

Adjustment layer → effect `Group` → inside it a `Mask` (rectangle, wide, positioned on
the top edge, e.g. 4K: position [0,999] size [7500,999]; 1080p: [0,500] [3800,500];
feather 0.85) then `Gaussian Blur` (delta 4–8). **A Mask inside a Group limits only
that group's effects**, so the blur fades in from the edge while the centre stays sharp.
Duplicate for the bottom edge (position y negative). Big feather = gentle falloff.

---

Recipes 34–38 come from the classic 3D text template (`openzoid-intro-anatomy` → classic-3d-text-intro).

## 34. Letter-spacing assemble / explode

Put each letter (separate Text object) in its own group whose base x is the letter's
slot (name it `[i] x`, e.g. `[0] -5.96`), with a child `X_Pos` group carrying the
animation. Key every `X_Pos` position x the same way:
`[{130,[-10,0,0],"none"},{282,[0,0,0],"cubic out"},{347,[-10,0,0],"elastic out"}]`.
The letters fly together, then spring apart with a wobble. Offset starts per letter by
1–3 frames for a ripple. (Single Text object = no per-letter motion; use this only
when the letter rhythm matters.)

## 35. Neon edge pass from a 3D render

Duplicate the text scene layer; on the copy add, in order:
`Edge Detection` (amount 25) → `Chroma Key` (backgroundColor black) → `Gradient Overlay`
(angular, white→black; animate `rotation` 0 → 4π over the outro for a shimmer sweep) →
`Bloom` → `Exposure`. Only the glowing outlines remain, laid over the beauty pass.
Variants: + `Wavy` = wobbly outline; Edge + `Radial Blur` = light rays from the edges;
Edge + Chroma + 2× Bloom + Box Blur = soft outer glow; `Negative` + Box Blur = dark halo.

## 36. Reflections-only environment objects (unverified via MCP)

Group with `reflectionVisibility: 1` ("reflections only"): its children don't render
on screen but are meant to appear in reflective materials. Template: a radius-100
Sphere with an Image material (an environment photo) plus a back-side, additive,
emissive Custom Material sphere, around shiny text (Custom Material, `reflection` on).
⚠ A quick MCP test (metal Box + reflection on, coloured spheres in a reflections-only
group, render_frame) showed NO reflections. The cube reflection may only update
during playback, or need settings not found. Check in the editor's playback before
relying on it. A fallback that always works is Image material + `Colorize`/`Exposure`
for the chrome look.

## 37. Section colour switching (HUE overlay)

Top `Color Overlay`, `blending BLEND_HUE`. Key `opacity` 0/1 with `"none"` to switch
sections on/off (e.g. 0→1 at 173, 0 at 195, 1 at 477, 0 at 738) and key `color` with
`"none"` for fast steps on a build-up (every ~11 f). Under it, a Color Grading split
tone (warm highlights, cool mids) keeps the neutral sections from looking flat.

## 38. Axis rig for 3D objects

Nest `Z > Z2 > Y > Y2 > X > X2 > content`, one axis per group (the "2" groups hold a
second layered move on the same axis). Euler order problems disappear because each
group rotates on one axis only. Same principle as R14, applied to 3D rotation.

## Polish checklist (what the template always does)

- `Antialiasing` first on every scene layer.
- Bloom / Exposure / Color Adjustment on one top adjustment layer = unified grade.
- `Shutter`s and `Shake` on adjustment layers, not per element.
- Short clips (12–35 f) for one-shot accents; place them by clip start = beat frame.
- Use groups so one keyframe moves a whole cluster.
