---
name: openzoid-mcp
description: Working conventions, units and gotchas for driving the openzoid (Panzoid Clipmaker 3) editor through the openzoid MCP tools (get_project, describe_layer, add_layer, add_node, animate_property, set_expression, render_frames...). Use this whenever you are about to build, edit, inspect or debug anything in an openzoid / Panzoid / Clipmaker project via MCP, including when tools say "no editor connected" or time out, even if the user just says "make an intro" or "add a glow".
---

# openzoid MCP: how to work

The MCP server (`mcp/server.js`) relays tool calls to an editor tab that long-polls it
at `http://127.0.0.1:7823/clipmaker.html?mcp`. Every tool call = one undo step.

## Connection troubleshooting (learned the hard way)

- `editor_status` → check both `http_listening` and `connected`.
- `http_listening: false` = another `node mcp/server.js` (often another Claude session)
  owns port 7823. server.js does **not** retry the bind. Fix: find the owner
  (`Get-NetTCPConnection -LocalPort 7823` → PID → command line / parent), ask the user
  before killing it (it breaks that other session's tools), then kill this session's
  non-listening server too so Claude Code respawns it — it then binds.
- Only open ONE editor tab. If you open the editor in the built-in browser pane while the
  user has their project open in their own browser, your blank tab can grab the bridge
  and you'll see an empty default project (one "Scene" layer with just a Camera). Close
  your tab; the user's tab reconnects.
- Calls in flight when a tab closes fail after 120 s ("editor did not answer"). Just re-call.
- If the user says they reopened/reloaded the project, re-run `get_project`.

## Before editing a user's project

- Never mutate a project you were only asked to study. If you must prove a recipe live,
  add a clearly named temp layer (e.g. `ZZ_TEST …`) on a new top track, render, then
  `delete_layer` it, and tell the user.
- Layer ids are `v<track>:<index>` and shift whenever clips move/are added/deleted —
  re-read `get_project` after structural changes.

## Units & coordinates

| Thing | Convention |
|---|---|
| Layer position | pixels, origin centre, +y up. 1920x1080 top-left = [-960, 540] |
| Rotation | radians (π = 3.1416, 90° = 1.5708) |
| Colour | [r,g,b] 0–1 or "#rrggbb" |
| Opacity | 0–1 |
| Keyframe frames | **clip-relative** (describe_layer note says the clip start) |
| Scene camera default | position [0,0,80], looks down -z |
| Scene scale | at z=0 with default camera, 1 world unit ≈ 11.5 px at 1080p (Circle radius 10 ≈ 230 px wide) |

## Scene layers (they're the workhorse — even for "2D" motion graphics)

- Panzoid users build almost everything as scene layers of flat shapes: Circle /
  Rectangle primitives with `Single Color` material, under Groups.
- `Single Color` material renders flat/unlit: flat white shapes show **without any light**.
  Lights matter for shaded 3D (Box, Sphere, 3D text bevels).
- `circle_detail` = polygon sides: 3 triangle, 4 diamond, 50 smooth circle. Stretch with
  object `scale` (e.g. [5.66, 0.66, 1] on a triangle = a spike/shard).
- Groups nest: `add_node` with `parent: "objects/1/objects"` adds inside group objects/1.
  Animate a Group's transform to move everything inside it.
- Material path is `<object>/material`, property `color`.

## Building 3D models (three.js-style, e.g. low-poly rooms)

Learned building a low-poly cozy bedroom diorama (~96 objects, 2026-10-15):

- **Materials:** `Single Color` is **unlit** (flat, ignores lights). For shaded 3D use
  `add_node item:"Custom Material" parent:"objects/N/material"` with `color`,
  `metalness: 0` (default 0.5 looks greasy), `roughness 0.7–1`. `emissive` makes lamp
  shades, screens, moons and fairy-light bulbs glow. Every object needs its own material
  call. No flat-shading toggle, so low detail is what gives the low-poly look.
- **Primitive params:** Box `box_size [w,h,d]` (centred). Cylinder `cylinder_size
  [radiusTop, radiusBottom, height]`, `cylinder_detail` = sides (6–8 low poly; top radius
  0 = cone, used for trees and cat ears), `cylinder_openEnded` **0 = open, 1 = closed**
  (default open!). Sphere `sphere_size` = radius, `sphere_detail [w,h]` ([6,4] low poly).
  Rectangle `rect_size`; lay flat with rotation x = −π/2.
- **Lights:** **Point lights are broken**: the engine sets `shadow.camera.fov = 60`
  (core-1.0.102.js ~18793), so a point light only lights 30° cones around ±x/±y/±z and
  shadows everything else (dark squares on floors). Use Spot (`angle` in **degrees**,
  `target`), Directional, Hemisphere (`color` + `groundColor`) and Ambient instead.
  A warm spot + hemisphere 0.85 + weak directional key + ambient 0.25 reads cozy.
- **Camera:** has no FOV prop. Aim with `eulerOrder: "YXZ"`, rotation `[pitch, yaw, 0]`:
  yaw = atan2(−dx, −dz), pitch = atan2(dy, √(dx²+dz²)) for d = target − camera.
  For a 40-unit room, camera at [34,25,34] looking at about (−3,5,−3) frames it.
- **Speed:** put everything in one Group (`objects/5/objects/...`). Parallel add_node
  calls come back with sequential indices in call order, so you can predict paths
  and fire all the material calls in the next parallel batch. Animate the group
  (e.g. `[0, sin(time*0.6)*0.12, 0]` sway) for a turntable feel.
- **Background:** a scene renders opaque black. `BLEND_DST_OVER` on a layer above
  does **not** go behind it. Move the scene up a track (`edit_clip track:2`) and put a
  full-frame shape (preset rectangle, `transform.scale [30,30]`, radial Gradient
  Overlay) on the track below.
- **Bloom on a lit scene:** keep `threshold`/`blendThreshold` ≈ 0.9 and `amount` ≈ 0.35.
  The defaults (0.4) blow out every lit surface.
- **Walking character rig (✅ verified):** `guy` Group (eulerOrder YXZ) → torso box, head
  sphere, hair sphere scaled y 0.7, eye boxes, plus **pivot Groups** `hip l/r` at hip
  height and `shoulder l/r` at shoulder height. Each pivot holds its limb box offset
  down by half its length (leg y −1.85 for 3.7 long), so rotating the pivot swings
  the limb from the joint. Drive everything with expressions (`time` in seconds):
  legs `[±sin(time*w)*0.6,0,0]`, arms opposite `[∓sin(time*w)*0.55,0,±0.08]`, body bob
  `abs(sin(time*w))*0.35`, path `var a=time*k; [cx+rx*cos(a), bob, cz+rz*sin(a)]`,
  facing `[0.06, atan2(-rx*sin(a), rz*cos(a)), 0]` (`atan2` works). Pick k and w so
  they complete whole cycles in the clip (6 s: k=2π/6, w=2π·1.5) for a seamless loop.
- Avoid z-fighting by offsetting stacked flat parts (rug inner 0.36 tall vs outer 0.3,
  art inner 0.2 in front of frame).

## Composite & adjustment layers

- A composite's `objects/N` are whole child **layers** (scenes etc.). Walk into them with
  the same node paths: `objects/3/objects/1/...` is object 1 of child layer 3, and
  `objects/3/effects/0` its effects. Child-layer keyframes are relative to the
  composite clip's start.
- Adjustment layers apply their effects to everything below. Effects run in list order;
  `Mask` effects on an adjustment layer limit where the whole stack shows (window effects).
- Mask `size` ≈ half-width in px (400 → ~770 px wide at 1080p); `position` is px from centre.
- describe_layer on deep rigs returns every descendant — expensive. Describe one level,
  then go deeper only where you need keyframes.

## Asset properties & random defaults

- `asset`-type props (font, particle `texture`, image materials) hold an **asset key**.
  Keys already in the project appear as 32-hex hashes — reuse them freely.
  Fonts accept names ("lobster"). Particle preset names ("star1", "ring",
  "circle_soft"…) work via agent.js `presetAsset` (✅ verified live 2026-10-15: value
  becomes `/assets/textures/particles/star1.png` and renders). An editor tab loaded
  before that fix accepts the name but renders nothing — ask the user to reload.
- `add_node Particles` randomizes speed (`ivel`, `vspread`, `irvel`, `rvspread`),
  rotation (`iang`, `aspread`, `angvel`, `avspread`), gravity, colour, size, blending
  and texture. Set every one you care about in the same call.
- Never open a second editor tab (e.g. in the browser pane) while the user's tab is
  open: the server keeps one session and the two tabs keep stealing it, so calls time
  out or land in the wrong project. To get new agent.js code, the user reloads their tab.
- Gradient props (particle `color`, `size`) take `[{position:0..1, color:"rgba(...)"}]`.

## Reading properties

- Vector keyframes come back per component: `keyframes: [[x kfs],[y kfs],[z kfs]]`.
  `animate_property` takes whole-vector values: `{"frame":0,"value":[0,0,0]}`.
- Blending lists as `BLEND_SRC_OVER`, `BLEND_SCREEN`, …
- Option props (`mode`, `invert`, `enabled`) are ints (index into "off;on" etc.).
  `enabled` is animatable → strobe effects on/off with `"easing": "none"` keyframes.
- Effects named oddly (`roundifier 1.0`, `Drop Shadow`, `Cartoon Shape`) with
  `customProperties` are **user-made effect groups / custom shaders** — read their
  children before touching. See openzoid-mograph-recipes.

## Expressions (`set_expression`)

Verified working: `var` statements, `;` separated, `%`, `max/min/sin/abs/pow`,
`frame`, `time`, array return. Last statement is the value.

```
var p = max(0, 1 - (frame % 10) / 6); [1 + 0.5 * p, 1 + 0.5 * p]   // beat pulse every 10f
sin(time * 2) * 50                                                     // bob
```
Inside effect groups, existing expressions read the group's custom property:
`properties["roundness"]`.

## Easings (list_catalog easings)

none, linear, {quadratic,cubic,quartic,quintic,sinusoidal,exponential,circular,elastic,back,bounce} {in,out,in-out}, cubic out-in.

**Easing goes on the DESTINATION keyframe.** (Older agent.js tool schemas said "easing
out of this keyframe toward the next" — wrong; fixed 2026-10-15, editor tab must reload
to pick it up.) Engine (`core-1.0.102.js` ~line 5813) eases
segment A→B with **B's** tween. So:

```
[{"frame":0,"value":0},{"frame":27,"value":1,"easing":"elastic out"}]   // elastic INTO 27 ✅
[{"frame":0,"value":0,"easing":"elastic out"},{"frame":27,"value":1}]   // ignored, 0→27 uses frame 27's (default) ❌
```
`"none"` on B = hold A's value until B, then jump (use for strobes/cuts).
**"… in-out" names were rejected** by agent.js `resolveTween` ("Unknown easing") until the
2026-10-15 fix; an editor tab loaded before then still rejects them. Workaround: pass
the catalog index as a string (`"4"` = quadratic in-out, `"7"` cubic in-out, `"16"`
sinusoidal in-out).
**Cuts:** a key with `"easing": "none"` one frame after the last shot-A key = hard
camera cut (used for broadcast cam → field-level celebration cam).
**Blended pose expressions:** to mix a run cycle with timed poses on one property, use
window weights `W(a,b)=min(max((frame-a)/(b-a),0),1)` and sum
`run*sin(frame*0.6)*0.8 + reach*(-2.7) + …` (football scene, verified).
A numeric easing in describe output (e.g. `277`) is a custom bezier curve drawn in
the UI; it can't be set by name, so pick the closest named ease when rebuilding.
The template's keyframes read the same way: `81 linear → 123 elastic out`.

## Checking work

- `render_frames` with explicit frames around each beat/transition (≤12) beats
  evenly spaced sampling.
- Render a frame both before and after a hit to confirm timing.

## Related skills

- `openzoid-mograph-recipes` — copy-paste recipes (ring burst, spike burst, shadow pairs, shutter reveal, whip spin, beat shake…).
- `openzoid-intro-anatomy` — how a full beat-synced Panzoid intro is structured.
