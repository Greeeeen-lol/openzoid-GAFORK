// openzoid AI agent — single-file build.
//
// Load this after ui-*.js and before clipmaker-*.js:
//   <script src="./agent.js"></script>
//
// Four parts, each self-contained:
//   1. PZ.agent.tools   — typed tool surface over the editor's undoable commands
//   2. PZ.agent.client  — the agent loop, one adapter per model provider
//   3. PZ.agent.bridge  — serves the same tools to MCP clients via mcp/server.js
//   4. PZ.ui.agent      — the chat panel
//
// See the README for setup. Sources are kept concatenated here rather than in
// separate files so the whole feature is one drop-in file with no new folder.


// ============================================================================
// agent/tools.js
// ============================================================================

// PZ.agent.tools — a typed tool surface over the editor's undoable command layer.
//
// Nothing here touches the scene graph directly. Every mutation goes through
// PZ.ui.properties / PZ.ui.edit / PZ.ui.timeline.tracks so it lands in the undo
// history, and the whole of one agent turn is wrapped in a single
// undo step by PZ.agent.tools.beginTurn()/endTurn().
// That is what makes an agent action revertible with one ctrl+Z.
//
// The same definitions are served to MCP clients by mcp/server.js, which loads
// this file in a sandbox to read them. Keep everything that runs at load time
// free of DOM and editor references; reach for those only inside tool bodies.

var PZ = PZ || {};
PZ.agent = PZ.agent || {};

(function () {
    "use strict";

    let editor = null;
    let viewport = null;
    let propertyOps = null;
    let trackOps = null;
    let objectOps = null;

    // The tracks command functions (createClip/deleteClip) are written against a
    // PZ.ui.timeline.tracks instance and read this.timeline.sequence,
    // this.timeline.editor and this.sequence. This shim supplies those lazily so
    // it stays correct across project loads, and lets the real timeline update
    // itself through the sequence's onClipCreated/onClipDeleted observables.
    function makeTrackOps() {
        return {
            get sequence() {
                return editor.sequence;
            },
            get timeline() {
                return {
                    get sequence() {
                        return editor.sequence;
                    },
                    editor: editor,
                };
            },
            updateSequenceLength: PZ.ui.timeline.tracks.prototype.updateSequenceLength,
            createClip: PZ.ui.timeline.tracks.prototype.createClip,
            deleteClip: PZ.ui.timeline.tracks.prototype.deleteClip,
            moveClip: PZ.ui.timeline.tracks.prototype.moveClip,
            createTrack: PZ.ui.timeline.tracks.prototype.createTrack,
        };
    }

    // PZ.ui.edit's object commands (effects, 3D objects, materials, shape
    // operations) only read this.editor, so the same trick works for them.
    function makeObjectOps() {
        return {
            editor: editor,
            createObject: PZ.ui.edit.prototype.createObject,
            deleteObject: PZ.ui.edit.prototype.deleteObject,
            moveObject: PZ.ui.edit.prototype.moveObject,
        };
    }

    PZ.agent.attach = function (ed, refs) {
        editor = ed;
        viewport = refs && refs.viewport;
        propertyOps = new PZ.ui.properties(ed);
        trackOps = makeTrackOps();
        objectOps = makeObjectOps();
        if (PZ.agent.bridge && PZ.agent.bridge.autoStart) PZ.agent.bridge.autoStart();
    };

    PZ.agent.isAttached = function () {
        return !!editor;
    };

    // ---------------------------------------------------------------- layers

    // PZ.layer.create() indexes this list, so the numbers are the on-disk layer
    // type. Templates mirror CM.defaultProject, which is the authoritative shape.
    const LAYER_KINDS = {
        scene: { type: 4, name: "Scene", object: { type: 4, effects: [], objects: [{ type: 6, objectType: 1 }] } },
        text: { type: 7, name: "Text", object: { type: 7, objects: [], effects: [] } },
        shape: { type: 8, name: "Shape", object: { type: 8, objects: [], effects: [] } },
        path: { type: 6, name: "Shape", object: { type: 6, objects: [], effects: [] } },
        image: { type: 3, name: "Image", object: { type: 3, effects: [] } },
        adjustment: { type: 1, name: "Adjustment", object: { type: 1, effects: [] } },
        composite: { type: 2, name: "Composite", object: { type: 2, objects: [], effects: [] } },
    };

    function layerId(trackIdx, clipIdx) {
        return "v" + trackIdx + ":" + clipIdx;
    }

    function parseLayerId(id) {
        let m = /^v(\d+):(\d+)$/.exec(String(id || "").trim());
        if (!m) throw new Error("Bad layer id '" + id + "'. Expected the form v0:1 (video track : clip index).");
        return { track: +m[1], index: +m[2] };
    }

    function resolveClip(id) {
        let ref = parseLayerId(id);
        let track = editor.sequence.videoTracks[ref.track];
        if (!track) throw new Error("No video track " + ref.track + ".");
        let clip = track.clips[ref.index];
        if (!clip) throw new Error("No clip " + ref.index + " on video track " + ref.track + ".");
        return clip;
    }

    function resolveLayer(id) {
        return resolveClip(id).object;
    }

    function kindOfLayer(layer) {
        for (let key of Object.keys(LAYER_KINDS)) {
            if (LAYER_KINDS[key].type === layer.type) return key;
        }
        return "layer";
    }

    // Clips on a track are kept sorted by start frame.
    function insertionIndex(track, start, skip) {
        let idx = 0;
        for (let i = 0; i < track.clips.length; i++) {
            if (track.clips[i] === skip) continue;
            if (track.clips[i].start > start) break;
            idx++;
        }
        return idx;
    }

    function ensureTrack(trackIdx) {
        let seq = editor.sequence;
        while (seq.videoTracks.length <= trackIdx) {
            trackOps.createTrack({ type: 0, newTrackIdx: seq.videoTracks.length, data: null });
        }
        return seq.videoTracks[trackIdx];
    }

    // The timeline shows the clip's name and the properties panel the layer's;
    // keep them in step.
    function rename(clip, name) {
        for (let target of [clip, clip.object]) {
            if (target && target.properties && target.properties.name) {
                propertyOps.setValue({ property: target.properties.name.getAddress(), frame: 0, value: name });
            }
        }
    }

    // Objects load asynchronously (effects fetch their shader source, fonts
    // download), so wait before describing or rendering what was just made.
    async function settle(obj) {
        if (obj && obj.loading && typeof obj.loading.then === "function") {
            try {
                await obj.loading;
            } catch (e) {
                /* surfaced elsewhere by the editor */
            }
        }
    }

    // ------------------------------------------------------------- sub-nodes

    // Inside a layer live lists of child objects: effects, 3D scene objects,
    // a 3D object's material, shape groups and their fill/stroke operations.
    // A node path walks those lists from the layer, e.g. "effects/0",
    // "objects/2", "objects/2/material". An empty path is the layer itself.

    function isList(v) {
        return v instanceof PZ.objectList || v instanceof PZ.objectSingleton;
    }

    function childLists(obj) {
        let out = [];
        if (!obj || typeof obj !== "object") return out;
        for (let key of Object.keys(obj)) {
            if (key[0] === "_" || key === "parent") continue;
            let v = obj[key];
            if (isList(v)) out.push({ key: key, list: v });
        }
        return out;
    }

    // Material lists are singletons; "material" reads better than "materials/0".
    function listKey(obj, seg) {
        if (isList(obj[seg])) return seg;
        if (isList(obj[seg + "s"])) return seg + "s";
        return null;
    }

    function resolveNode(layer, path) {
        let node = layer;
        let segs = String(path || "")
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean);
        for (let i = 0; i < segs.length; i++) {
            let seg = segs[i];
            if (isList(node)) {
                if (!/^\d+$/.test(seg)) throw new Error("Expected an index after '" + segs.slice(0, i).join("/") + "'.");
                let item = node[+seg];
                if (!item) throw new Error("No item " + seg + " in '" + segs.slice(0, i).join("/") + "' (it has " + node.length + ").");
                node = item;
                continue;
            }
            let key = listKey(node, seg);
            if (!key) {
                let have = childLists(node).map((c) => c.key);
                throw new Error(
                    "No list '" + seg + "' at '" + (segs.slice(0, i).join("/") || "layer") + "'." + (have.length ? " It has: " + have.join(", ") + "." : " It has no child lists.")
                );
            }
            node = node[key];
            // Singletons hold exactly one item, so step into it unless an index follows.
            if (node instanceof PZ.objectSingleton && !(i + 1 < segs.length && /^\d+$/.test(segs[i + 1]))) {
                if (!node[0]) throw new Error("'" + segs.slice(0, i + 1).join("/") + "' is empty.");
                node = node[0];
            }
        }
        if (isList(node)) throw new Error("'" + path + "' names a list. Add an index, e.g. '" + path + "/0'.");
        return node;
    }

    // For adding: the path names a list (or a node, whose obvious list is used).
    function resolveList(layer, path, preferKey) {
        let segs = String(path || "")
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean);
        let last = segs.length ? segs[segs.length - 1] : null;
        let owner = last && !/^\d+$/.test(last) ? resolveNode(layer, segs.slice(0, -1).join("/")) : resolveNode(layer, segs.join("/"));
        let key = last && !/^\d+$/.test(last) ? listKey(owner, last) : null;
        if (!key && preferKey) key = listKey(owner, preferKey);
        if (!key) {
            let have = childLists(owner).map((c) => c.key);
            throw new Error("'" + (path || "layer") + "' has no list to add to." + (have.length ? " Lists here: " + have.join(", ") + "." : ""));
        }
        let ownerPath = last && !/^\d+$/.test(last) ? segs.slice(0, -1).join("/") : segs.join("/");
        return { owner: owner, key: key, list: owner[key], path: (ownerPath ? ownerPath + "/" : "") + key };
    }

    function baseTypeName(t) {
        if (t === PZ.effect) return "effect";
        if (t === PZ.object3d) return "object3d";
        if (t === PZ.material) return "material";
        if (t === PZ.shape) return "shape";
        if (t === PZ.draw) return "draw";
        if (t === PZ.layer) return "layer";
        return "object";
    }

    function nodeName(obj) {
        try {
            if (obj.properties && obj.properties.name) return obj.properties.name.get();
        } catch (e) {
            /* fall through */
        }
        return obj.defaultName || null;
    }

    // ------------------------------------------------------------ properties

    // Property paths are dot-separated keys into an object's properties, e.g.
    // "opacity", "transform.position", "fill.color". Layer-type specific
    // properties live under childProperties (text, shapes) and 3D primitive
    // sizes under geometryProperties; those prefixes may be left off, so the
    // agent does not have to know the nesting.
    const TRANSPARENT_GROUPS = /^(childProperties|geometryProperties)\./;

    function collectProps(list, prefix, out) {
        for (let key of Object.keys(list)) {
            let p = list[key];
            let full = prefix ? prefix + "." + key : key;
            if (p instanceof PZ.propertyList) collectProps(p, full, out);
            else if (p instanceof PZ.property) out.push({ full: full, prop: p });
        }
        return out;
    }

    // Each entry gets the shortest path that is still unambiguous.
    function propertyEntries(obj) {
        if (!obj || !obj.properties) return [];
        let entries = collectProps(obj.properties, "", []);
        let counts = {};
        for (let e of entries) {
            e.short = e.full.replace(TRANSPARENT_GROUPS, "");
            counts[e.short] = (counts[e.short] || 0) + 1;
        }
        for (let e of entries) e.path = counts[e.short] > 1 ? e.full : e.short;
        return entries;
    }

    function resolveProperty(obj, path) {
        path = String(path || "").trim();
        let entries = propertyEntries(obj);
        let hit = entries.find((e) => e.full === path) || entries.find((e) => e.path === path);
        if (!hit) {
            let matches = entries.filter((e) => e.short === path);
            if (matches.length === 1) hit = matches[0];
        }
        if (!hit) {
            // Accept the display name too ("Opacity", "Fill color").
            let lower = path.toLowerCase();
            let matches = entries.filter((e) => e.prop.definition && String(e.prop.definition.name || "").toLowerCase() === lower);
            if (matches.length === 1) hit = matches[0];
        }
        if (!hit) {
            let isGroup = entries.some((e) => e.full.indexOf(path + ".") === 0 || e.short.indexOf(path + ".") === 0);
            if (isGroup) throw new Error("'" + path + "' is a group of properties, not a value. Name one of its children.");
            throw new Error(
                "No property '" + path + "' here. Available: " + entries.map((e) => e.path).slice(0, 60).join(", ") + "."
            );
        }
        return hit.prop;
    }

    const TYPE_NAMES = {
        0: "number",
        1: "vector2",
        2: "vector3",
        3: "vector4",
        4: "color",
        5: "gradient",
        6: "option",
        7: "text",
        8: "asset",
        9: "list",
        10: "curve",
        11: "shader",
    };

    function round(v) {
        if (typeof v === "number") return Math.round(v * 10000) / 10000;
        if (Array.isArray(v)) return v.map(round);
        return v;
    }

    function easingName(tween) {
        let list = PZ.tween && PZ.tween.easingList;
        return list && list[tween] ? list[tween].name : tween;
    }

    function describeEntry(entry, brief) {
        let prop = entry.prop;
        let def = prop.definition || {};
        let out = {
            path: entry.path,
            name: def.name || entry.path,
            type: TYPE_NAMES[def.type] !== undefined ? TYPE_NAMES[def.type] : def.type,
        };
        try {
            let v = prop.get(0);
            out.value = Array.isArray(v) || (v && v.length !== undefined && typeof v !== "string") ? round(Array.prototype.slice.call(v)) : round(v);
        } catch (e) {
            out.value = null;
        }
        if (prop instanceof PZ.property.dynamic) {
            out.animatable = true;
            if (prop.animated) out.animated = true;
        }
        if (prop.expression) out.expression = prop.expression.source;
        if (def.items) out.options = Array.isArray(def.items) ? def.items.map((i) => (i && i.value !== undefined ? i.value : i)) : def.items;
        if (def.min !== undefined) out.min = def.min;
        if (def.max !== undefined) out.max = def.max;
        if (!brief && prop.animated) {
            let targets = keyframeTargets(prop);
            if (targets.length === 1) {
                out.keyframes = Array.prototype.map.call(targets[0].keyframes || [], (k) => ({
                    frame: k.frame,
                    value: round(k.value),
                    easing: easingName(k.tween),
                }));
            } else {
                out.keyframes = targets.map((t) =>
                    Array.prototype.map.call(t.keyframes || [], (k) => ({ frame: k.frame, value: round(k.value), easing: easingName(k.tween) }))
                );
            }
        }
        return out;
    }

    function describeTree(obj, path, depth) {
        let out = [];
        if (depth > 5) return out;
        for (let c of childLists(obj)) {
            let listPath = (path ? path + "/" : "") + c.key;
            let singleton = c.list instanceof PZ.objectSingleton;
            // Text glyph outlines and the like: summarise rather than list.
            if (c.list.length > 8) {
                out.push({ list: listPath, kind: baseTypeName(c.list.type), count: c.list.length, name: nodeName(c.list[0]) });
                continue;
            }
            for (let i = 0; i < c.list.length; i++) {
                let child = c.list[i];
                let p = singleton ? (path ? path + "/" : "") + c.key.replace(/s$/, "") : listPath + "/" + i;
                out.push({ node: p, kind: baseTypeName(c.list.type), type: child.type, name: nodeName(child) });
                out.push.apply(out, describeTree(child, p, depth + 1));
            }
        }
        return out;
    }

    // Providers differ in how faithfully they preserve value types: Gemini's
    // schema dialect has no "any" type, so numbers and arrays arrive as
    // strings. Coerce using the property's own declared type rather than
    // guessing from the value, so the text "123" stays text on a text property.
    function coerceValue(prop, value) {
        let type = prop.definition ? prop.definition.type : undefined;
        let T = PZ.property.type;
        if (typeof value === "string") {
            if (type === T.LIST) return optionValue(prop, value);
            if (type === T.TEXT || type === T.SHADER) return value;
            if (type === T.ASSET) return fontShortcut(value);
            if (type === T.COLOR && /^#?[0-9a-f]{6}$/i.test(value.trim())) return hexToRgb(value.trim());
            try {
                let parsed = JSON.parse(value);
                if (typeof parsed === "object" || typeof parsed === "number" || typeof parsed === "boolean") value = parsed;
            } catch (e) {
                return value;
            }
        }
        // A bare number on a vector property means "all components".
        if (typeof value === "number" && prop instanceof PZ.property.dynamic.group) {
            return Array.prototype.map.call(prop.objects, () => value);
        }
        // Colours given in 0-255 are an easy slip; the editor wants 0-1.
        if (type === T.COLOR && Array.isArray(value) && value.some((c) => c > 1)) {
            return value.map((c) => c / 255);
        }
        return value;
    }

    // Option lists may be given by display name ("multiply") or by value.
    function optionValue(prop, value) {
        let items = prop.definition && prop.definition.items;
        if (!Array.isArray(items)) return value;
        let lower = value.trim().toLowerCase();
        let hit = items.find((i) => i && (String(i.value).toLowerCase() === lower || String(i.name).toLowerCase() === lower));
        return hit ? hit.value : value;
    }

    function hexToRgb(hex) {
        hex = hex.replace("#", "");
        return [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16) / 255);
    }

    // Fonts can be named rather than given as a path: "lobster" -> the bundled file.
    function fontShortcut(value) {
        let presets = (PZ.asset && PZ.asset.font && PZ.asset.font.preset) || [];
        let lower = value.trim().toLowerCase().replace(/\.ttf$/, "");
        if (value.indexOf("/") === -1 && presets.indexOf(lower) !== -1) return "/assets/fonts/2d/" + lower + ".ttf";
        return value;
    }

    // A group property (position, scale, colour) holds one scalar child per
    // component, and keyframes live on the children rather than the group.
    function keyframeTargets(prop) {
        if (prop instanceof PZ.property.dynamic.group) return Array.prototype.slice.call(prop.objects);
        return [prop];
    }

    function componentValue(value, prop, index, isGroup) {
        if (!isGroup) return value;
        if (!Array.isArray(value)) {
            throw new Error("'" + (prop.definition && prop.definition.name) + "' needs an array value, one per component.");
        }
        return value[index];
    }

    function resolveTween(kf, fallback) {
        if (kf.easing !== undefined && kf.easing !== null && kf.easing !== "") {
            let list = PZ.tween.easingList;
            let wanted = String(kf.easing).toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
            // Allow "in-out" / "inout" / "ease out cubic" style spellings.
            let norm = (s) => s.replace(/\s+/g, "").replace("inout", "in out");
            let idx = list.findIndex((e) => e.name === wanted);
            if (idx === -1) idx = list.findIndex((e) => norm(e.name) === norm(wanted));
            if (idx === -1 && /^\d+$/.test(wanted)) idx = +wanted;
            if (idx === -1 || !list[idx]) {
                throw new Error("Unknown easing '" + kf.easing + "'. Call list_catalog with category easings to see the names.");
            }
            return idx;
        }
        if (kf.tween !== undefined && kf.tween !== null) return +kf.tween;
        return fallback;
    }

    // ---------------------------------------------------------------- catalog

    // PZ.ui.objectTypes is what the editor's own "+ add" menus are built from,
    // so anything listed here is exactly what a user could add by hand.
    const CATALOG_BASES = {
        effects: () => PZ.effect,
        objects3d: () => PZ.object3d,
        materials: () => PZ.material,
        shapes: () => PZ.shape,
        operations: () => PZ.draw,
    };

    function catalogFor(baseType) {
        let items = (PZ.ui.objectTypes && PZ.ui.objectTypes.get(baseType)) || [];
        let out = [];
        let category = null;
        for (let item of items) {
            if (item.category) {
                category = item.name.toLowerCase();
                continue;
            }
            // Entries that open a file picker cannot be driven from here.
            if (typeof item.data === "function") continue;
            if (item.list) {
                for (let sub of item.list) {
                    if (typeof sub.data === "function") continue;
                    out.push({ name: sub.name, group: item.name, category: category, desc: item.desc, type: sub.type, data: sub.data });
                }
                continue;
            }
            out.push({ name: item.name, category: category, desc: item.desc, type: item.type, data: item.data });
        }
        return out;
    }

    function findCatalogItem(baseType, wanted) {
        let items = catalogFor(baseType);
        let w = String(wanted || "").trim().toLowerCase();
        let hit =
            items.find((i) => i.name.toLowerCase() === w) ||
            items.find((i) => typeof i.type === "string" && i.type.toLowerCase() === w) ||
            items.find((i) => i.group && (i.group + " " + i.name).toLowerCase() === w);
        if (!hit) {
            let partial = items.filter((i) => i.name.toLowerCase().indexOf(w) !== -1);
            if (partial.length === 1) hit = partial[0];
        }
        if (!hit) {
            throw new Error("Nothing called '" + wanted + "' can be added here. Choose one of: " + items.map((i) => i.name).join(", ") + ".");
        }
        return hit;
    }

    // ----------------------------------------------------------- tool bodies

    function setOne(args) {
        let layer = resolveLayer(args.layer);
        let node = resolveNode(layer, args.node);
        let prop = resolveProperty(node, args.path);
        let frame = args.frame === undefined || args.frame === null ? 0 : +args.frame;
        let value = coerceValue(prop, args.value);
        if (prop instanceof PZ.property.dynamic && prop.animated) {
            // On an animated property a plain set would only move the keyframe
            // under the playhead; make the value land where it was asked for.
            for (let target of keyframeTargets(prop)) {
                if (!target.getKeyframe(frame)) {
                    let idx = keyframeTargets(prop).indexOf(target);
                    let v = componentValue(value, prop, idx, prop instanceof PZ.property.dynamic.group);
                    propertyOps.createKeyframe({ property: target.getAddress(), data: new PZ.keyframe(v, frame, target.defaultTween) });
                }
            }
        }
        propertyOps.setValue({ property: prop.getAddress(), frame: frame, value: value });
        return { layer: args.layer, node: args.node || undefined, path: args.path, value: round(value) };
    }

    const impl = {
        get_project() {
            let seq = editor.sequence;
            let res = seq.properties.resolution.get();
            let tracks = [];
            for (let t = 0; t < seq.videoTracks.length; t++) {
                let clips = seq.videoTracks[t].clips.map((clip, i) => {
                    let entry = {
                        layer: layerId(t, i),
                        kind: kindOfLayer(clip.object),
                        name: clip.properties.name ? clip.properties.name.get() : nodeName(clip.object),
                        start: clip.start,
                        length: clip.length,
                    };
                    if (clip.object.effects && clip.object.effects.length) {
                        entry.effects = Array.prototype.map.call(clip.object.effects, (e) => nodeName(e));
                    }
                    if (clip.object.type === 4 && clip.object.objects) {
                        entry.objects = Array.prototype.map.call(clip.object.objects, (o) => nodeName(o));
                    }
                    return entry;
                });
                tracks.push({ track: t, clips: clips });
            }
            return {
                resolution: [res[0], res[1]],
                frame_rate: seq.properties.rate.get(),
                sequence_length: seq.length,
                current_frame: editor.playback.currentFrame,
                video_tracks: tracks,
                audio_track_count: seq.audioTracks.length,
                sequence_properties: propertyEntries(seq).map((e) => e.path),
            };
        },

        async describe_layer(args) {
            let clip = resolveClip(args.layer);
            let layer = clip.object;
            let node = resolveNode(layer, args.node);
            await settle(node);
            let result = {
                layer: args.layer,
                node: args.node || "",
                kind: args.node ? baseTypeName(node._parent ? node._parent.type : null) : kindOfLayer(layer),
                name: nodeName(node),
                note: "Keyframe frames are relative to the clip start (" + clip.start + "). Pass a node path from 'children' as node to read or edit that child.",
                properties: propertyEntries(node).map((e) => describeEntry(e, false)),
            };
            if (!args.node) {
                result.start = clip.start;
                result.length = clip.length;
            }
            result.children = describeTree(node, args.node || "", 0);
            result.lists = childLists(node).map((c) => ({
                list: (args.node ? args.node + "/" : "") + c.key,
                holds: baseTypeName(c.list.type),
                count: c.list.length,
            }));
            return result;
        },

        list_catalog(args) {
            let category = String(args.category || "").toLowerCase();
            if (category === "layers") {
                return Object.keys(LAYER_KINDS).map((k) => ({ kind: k }));
            }
            if (category === "fonts") {
                return { fonts: (PZ.asset && PZ.asset.font && PZ.asset.font.preset) || [], note: "Set a text layer's font property to one of these names." };
            }
            if (category === "easings") {
                return { easings: PZ.tween.easingList.map((e) => e.name), note: "Pass as keyframe easing. 'none' holds the value until the next keyframe." };
            }
            let base = CATALOG_BASES[category];
            if (!base) throw new Error("Unknown category '" + args.category + "'. Choose one of: layers, effects, objects3d, materials, shapes, operations, fonts, easings.");
            return catalogFor(base()).map((i) => {
                let entry = { name: i.name };
                if (i.group) entry.group = i.group;
                if (i.category) entry.category = i.category;
                if (i.desc) entry.desc = i.desc;
                return entry;
            });
        },

        async add_layer(args) {
            let kind = LAYER_KINDS[args.kind];
            if (!kind) {
                throw new Error("Unknown layer kind '" + args.kind + "'. Choose one of: " + Object.keys(LAYER_KINDS).join(", ") + ".");
            }
            let seq = editor.sequence;
            let trackIdx = args.track === undefined || args.track === null ? seq.videoTracks.length : +args.track;
            let track = ensureTrack(trackIdx);
            let start = args.start === undefined || args.start === null ? 0 : +args.start;
            // By default run to the end of the sequence rather than extending it.
            let length = args.length === undefined || args.length === null ? Math.max(1, (seq.length || 180) - start) : +args.length;
            let idx = insertionIndex(track, start);

            let object = JSON.parse(JSON.stringify(kind.object));
            let data = {
                type: 0,
                start: start,
                length: length,
                offset: 0,
                relativeRate: 1,
                media: null,
                link: null,
                properties: { name: args.name || kind.name },
                object: object,
            };

            trackOps.createClip({ type: 0, newTrackIdx: trackIdx, newIdx: idx, start: start, length: length, data: data });
            let clip = track.clips[idx];
            await settle(clip);
            await settle(clip.object);

            let id = layerId(trackIdx, idx);
            if (args.name) rename(clip, args.name);
            if (args.text !== undefined && kind.type === 7) {
                setOne({ layer: id, path: "text", value: args.text });
            }
            let errors = [];
            for (let p of args.properties || []) {
                try {
                    setOne({ layer: id, path: p.path, value: p.value, frame: p.frame });
                } catch (e) {
                    errors.push(p.path + ": " + e.message);
                }
            }
            let result = { layer: id, kind: args.kind, track: trackIdx, start: start, length: length };
            if (errors.length) result.property_errors = errors;
            return result;
        },

        async duplicate_layer(args) {
            let ref = parseLayerId(args.layer);
            let clip = resolveClip(args.layer);
            let data = JSON.parse(JSON.stringify(clip));
            let trackIdx = args.track === undefined || args.track === null ? ref.track + 1 : +args.track;
            // Duplicating onto a new track above keeps the copy on top, which is
            // what "duplicate" means in a compositing editor.
            if (args.track === undefined || args.track === null) {
                trackOps.createTrack({ type: 0, newTrackIdx: trackIdx, data: null });
            }
            let track = ensureTrack(trackIdx);
            let start = args.start === undefined || args.start === null ? clip.start : +args.start;
            let idx = insertionIndex(track, start);
            data.start = start;
            trackOps.createClip({ type: 0, newTrackIdx: trackIdx, newIdx: idx, start: start, length: clip.length, data: data });
            await settle(track.clips[idx]);
            let id = layerId(trackIdx, idx);
            if (args.name) rename(track.clips[idx], args.name);
            return { layer: id, from: args.layer, note: "Track and clip ids above the copy may have shifted; call get_project before using old ids." };
        },

        delete_layer(args) {
            let ref = parseLayerId(args.layer);
            resolveClip(args.layer);
            trackOps.deleteClip({ type: 0, oldTrackIdx: ref.track, oldIdx: ref.index });
            return { deleted: args.layer };
        },

        edit_clip(args) {
            let ref = parseLayerId(args.layer);
            let clip = resolveClip(args.layer);
            let newTrack = args.track === undefined || args.track === null ? ref.track : +args.track;
            let start = args.start === undefined || args.start === null ? clip.start : +args.start;
            let length = args.length === undefined || args.length === null ? clip.length : Math.max(1, +args.length);
            let target = ensureTrack(newTrack);
            let newIdx = insertionIndex(target, start, clip);
            trackOps.moveClip({
                type: 0,
                oldTrackIdx: ref.track,
                oldIdx: ref.index,
                newTrackIdx: newTrack,
                newIdx: newIdx,
                start: start !== clip.start ? start : undefined,
                length: length !== clip.length ? length : undefined,
            });
            return { layer: layerId(newTrack, newIdx), start: start, length: length };
        },

        async add_node(args) {
            let layer = resolveLayer(args.layer);
            let target = resolveList(layer, args.parent || "effects", args.parent ? null : "effects");
            let item = findCatalogItem(target.list.type, args.item);
            let singleton = target.list instanceof PZ.objectSingleton;
            if (singleton && target.list.length > 0) {
                objectOps.deleteObject({ oldParentAddress: target.list.getAddress(), oldIdx: 0 });
            }
            let idx = singleton || args.index === undefined || args.index === null ? target.list.length : Math.max(0, Math.min(+args.index, target.list.length));
            let data = item.data === undefined ? undefined : JSON.parse(JSON.stringify(item.data));
            objectOps.createObject({
                newParentAddress: target.list.getAddress(),
                newIdx: idx,
                baseType: target.list.type,
                subType: item.type,
                data: data,
            });
            let created = target.list[idx];
            await settle(created);
            let path = singleton ? target.path.replace(/s$/, "") : target.path + "/" + idx;
            if (args.name && created.properties && created.properties.name) {
                propertyOps.setValue({ property: created.properties.name.getAddress(), frame: 0, value: args.name });
            }
            let errors = [];
            for (let p of args.properties || []) {
                try {
                    setOne({ layer: args.layer, node: path, path: p.path, value: p.value, frame: p.frame });
                } catch (e) {
                    errors.push(p.path + ": " + e.message);
                }
            }
            let result = {
                layer: args.layer,
                node: path,
                added: item.name,
                properties: propertyEntries(created).map((e) => describeEntry(e, true)),
            };
            if (errors.length) result.property_errors = errors;
            return result;
        },

        delete_node(args) {
            let layer = resolveLayer(args.layer);
            let node = resolveNode(layer, args.node);
            let list = node._parent;
            if (!isList(list)) throw new Error("'" + args.node + "' cannot be deleted.");
            let idx = Array.prototype.indexOf.call(list, node);
            objectOps.deleteObject({ oldParentAddress: list.getAddress(), oldIdx: idx });
            return { layer: args.layer, deleted: args.node, note: "Indexes after it in the same list shift down by one." };
        },

        move_node(args) {
            let layer = resolveLayer(args.layer);
            let node = resolveNode(layer, args.node);
            let list = node._parent;
            if (!isList(list) || list instanceof PZ.objectSingleton) throw new Error("'" + args.node + "' cannot be reordered.");
            let oldIdx = Array.prototype.indexOf.call(list, node);
            let newIdx = Math.max(0, Math.min(+args.index, list.length - 1));
            if (newIdx !== oldIdx) {
                objectOps.moveObject({ oldParentAddress: list.getAddress(), oldIdx: oldIdx, newParentAddress: list.getAddress(), newIdx: newIdx });
            }
            return { layer: args.layer, node: args.node.replace(/\d+$/, String(newIdx)) };
        },

        set_property(args) {
            if (!args.node && args.path === "name") {
                rename(resolveClip(args.layer), String(args.value));
                return { layer: args.layer, path: "name", value: String(args.value) };
            }
            return setOne(args);
        },

        set_properties(args) {
            let results = [];
            for (let edit of args.edits || []) {
                let merged = Object.assign({ layer: args.layer, node: args.node }, edit);
                try {
                    results.push(Object.assign({ ok: true }, setOne(merged)));
                } catch (e) {
                    results.push({ ok: false, layer: merged.layer, node: merged.node, path: merged.path, error: e.message });
                }
            }
            return { results: results };
        },

        animate_property(args) {
            let layer = resolveLayer(args.layer);
            let node = resolveNode(layer, args.node);
            let prop = resolveProperty(node, args.path);
            let kfs = (args.keyframes || []).slice().sort((a, b) => a.frame - b.frame);
            if (!kfs.length) throw new Error("animate_property needs at least one keyframe.");
            if (!(prop instanceof PZ.property.dynamic)) {
                throw new Error("'" + args.path + "' is a static property and cannot be animated.");
            }

            // Turn animation on through the UI path so the property's static
            // behaviour (constant vs linear) is normalised the same way the
            // animate toggle would do it.
            propertyOps.toggleAnimation(prop, +kfs[0].frame || 0, false, true);

            let isGroup = prop instanceof PZ.property.dynamic.group;
            let targets = keyframeTargets(prop);

            for (let i = 0; i < targets.length; i++) {
                let target = targets[i];
                let addr = target.getAddress();
                let wanted = new Set();

                for (let kf of kfs) {
                    let frame = +kf.frame;
                    wanted.add(frame);
                    let value = componentValue(coerceValue(prop, kf.value), prop, i, isGroup);
                    let tween = resolveTween(kf, args.easing !== undefined ? resolveTween({ easing: args.easing }, target.defaultTween) : target.defaultTween);
                    if (target.getKeyframe(frame)) {
                        propertyOps.deleteKeyframe({ property: addr, frame: frame });
                    }
                    propertyOps.createKeyframe({ property: addr, data: new PZ.keyframe(value, frame, tween) });
                }

                // Drop leftovers from whatever the property held before, so the
                // resulting animation is exactly what was asked for.
                for (let existing of Array.prototype.slice.call(target.keyframes)) {
                    if (!wanted.has(existing.frame)) {
                        propertyOps.deleteKeyframe({ property: addr, frame: existing.frame });
                    }
                }
            }
            return { layer: args.layer, node: args.node || undefined, path: args.path, keyframes: kfs.length };
        },

        clear_animation(args) {
            let layer = resolveLayer(args.layer);
            let node = resolveNode(layer, args.node);
            let prop = resolveProperty(node, args.path);
            if (!(prop instanceof PZ.property.dynamic)) throw new Error("'" + args.path + "' is not animatable.");
            if (prop.expression) propertyOps.setExpression({ property: prop.getAddress(), expression: null });
            if (prop.animated) {
                let frame = args.frame === undefined || args.frame === null ? 0 : +args.frame;
                propertyOps.toggleAnimation(prop, frame, false, false);
            }
            return { layer: args.layer, path: args.path, animated: !!prop.animated };
        },

        set_expression(args) {
            let layer = resolveLayer(args.layer);
            let node = resolveNode(layer, args.node);
            let prop = resolveProperty(node, args.path);
            if (!(prop instanceof PZ.property.dynamic)) {
                throw new Error("'" + args.path + "' is a static property and cannot take an expression.");
            }
            let expression = args.expression === "null" ? null : args.expression;
            if (expression) {
                // Constructing it here surfaces a syntax error as a tool error
                // rather than a silently dead expression on the property.
                let test = new PZ.expression(expression);
                if (test.error) throw new Error("Expression rejected: " + test.error);
            }
            propertyOps.setExpression({ property: prop.getAddress(), expression: expression || null });
            return { layer: args.layer, node: args.node || undefined, path: args.path, expression: expression || null };
        },

        set_sequence_property(args) {
            let prop = resolveProperty(editor.sequence, args.name);
            let value = coerceValue(prop, args.value);
            propertyOps.setValue({ property: prop.getAddress(), frame: 0, value: value });
            return { name: args.name, value: value };
        },

        async render_frame(args) {
            let canvas = await renderAt(args.frame === undefined || args.frame === null ? editor.playback.currentFrame : +args.frame);
            let scale = Math.min(1, 768 / Math.max(canvas.width, canvas.height));
            let out = document.createElement("canvas");
            out.width = Math.max(1, Math.round(canvas.width * scale));
            out.height = Math.max(1, Math.round(canvas.height * scale));
            out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
            return {
                _image: out.toDataURL("image/png").split(",")[1],
                frame: editor.playback.currentFrame,
            };
        },

        async render_frames(args) {
            let frames = (args.frames || []).map(Number).filter((f) => !isNaN(f));
            if (!frames.length) {
                // Default: evenly across the sequence, so motion can be judged at a glance.
                let len = editor.sequence.length || 180;
                let n = Math.max(2, Math.min(+args.count || 6, 12));
                for (let i = 0; i < n; i++) frames.push(Math.round((i * (len - 1)) / (n - 1)));
            }
            frames = frames.slice(0, 12);
            let cols = Math.min(frames.length, frames.length <= 4 ? 2 : 3);
            let rows = Math.ceil(frames.length / cols);
            let first = await renderAt(frames[0]);
            let cellW = Math.round(Math.min(400, first.width));
            let cellH = Math.round((cellW * first.height) / first.width);
            let sheet = document.createElement("canvas");
            sheet.width = cols * cellW;
            sheet.height = rows * cellH;
            let ctx = sheet.getContext("2d");
            ctx.fillStyle = "#111";
            ctx.fillRect(0, 0, sheet.width, sheet.height);
            for (let i = 0; i < frames.length; i++) {
                let src = i === 0 ? first : await renderAt(frames[i]);
                let x = (i % cols) * cellW;
                let y = Math.floor(i / cols) * cellH;
                ctx.drawImage(src, x, y, cellW, cellH);
                ctx.fillStyle = "rgba(0,0,0,0.6)";
                ctx.fillRect(x, y, 70, 20);
                ctx.fillStyle = "#fff";
                ctx.font = "12px monospace";
                ctx.fillText("f " + frames[i], x + 6, y + 14);
                ctx.strokeStyle = "#444";
                ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
            }
            return { _image: sheet.toDataURL("image/png").split(",")[1], frames: frames, layout: cols + "x" + rows + ", left to right then top to bottom" };
        },
    };

    // Renders one frame and returns a 2D canvas holding a copy of it.
    async function renderAt(frame) {
        if (!viewport || !viewport.canvas) throw new Error("The viewport is not available to render from.");
        editor.playback.currentFrame = frame;

        // Let the normal viewport loop settle on the new frame first.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        // The viewport renderer has no preserveDrawingBuffer, so the read
        // has to happen in the same task as the draw.
        viewport._render();
        let src = viewport.canvas;
        let copy = document.createElement("canvas");
        copy.width = Math.max(1, src.width);
        copy.height = Math.max(1, src.height);
        copy.getContext("2d").drawImage(src, 0, 0);
        return copy;
    }

    // ------------------------------------------------------------- schemas

    const LAYER_ARG = { type: "string", description: "Layer id from get_project, e.g. \"v0:1\"." };
    const NODE_ARG = {
        type: "string",
        description:
            "Optional child inside the layer, as a path from describe_layer's children: \"effects/0\", \"objects/2\", \"objects/2/material\". Omit for the layer itself.",
    };
    const VALUE_ARG = {
        description:
            "Numbers for scalars, arrays for vectors ([x, y] or [x, y, z]), colours as [r, g, b] in 0-1 or \"#ff8800\", strings for text, option names for option properties, font names for fonts.",
    };
    const PROPERTY_LIST_ARG = {
        type: "array",
        description: "Optional initial property values to apply right away, saving separate set_property calls.",
        items: {
            type: "object",
            properties: {
                path: { type: "string", description: "Property path." },
                value: VALUE_ARG,
            },
            required: ["path", "value"],
        },
    };
    const KEYFRAME_ITEMS = {
        type: "object",
        properties: {
            frame: { type: "integer", description: "Clip-relative frame." },
            value: { description: "Value at this frame; array for vector and colour properties." },
            easing: {
                type: "string",
                description:
                    "Easing out of this keyframe toward the next, by name: e.g. \"linear\", \"cubic out\", \"quintic in-out\", \"back out\", \"elastic out\", \"bounce out\", or \"none\" to hold. See list_catalog easings.",
            },
        },
        required: ["frame", "value"],
    };

    PZ.agent.tools = {
        definitions: [
            {
                name: "get_project",
                description:
                    "List the whole project: resolution, frame rate, sequence length, and every video track with its clips. Each clip is one layer and carries the id you pass to the other tools. Call this first, and again after adding, moving or deleting layers, because ids are track/index pairs and shift when clips move.",
                input_schema: { type: "object", properties: {}, required: [] },
            },
            {
                name: "describe_layer",
                description:
                    "Read one layer (or one child of it, via node) in full: every property with its path, type, current value, range, options and keyframes, plus its children (effects, 3D objects, materials, shape parts) with the node paths used to edit them. Call this before editing something you have not inspected.",
                input_schema: {
                    type: "object",
                    properties: { layer: LAYER_ARG, node: NODE_ARG },
                    required: ["layer"],
                },
            },
            {
                name: "list_catalog",
                description:
                    "List what can be added or chosen: effects (blur, glow, colour, distortion...), objects3d (boxes, spheres, text, lights, cameras, particles for scene layers), materials (for 3D objects), shapes and operations (for path layers), fonts, easings, layers.",
                input_schema: {
                    type: "object",
                    properties: {
                        category: {
                            type: "string",
                            enum: ["layers", "effects", "objects3d", "materials", "shapes", "operations", "fonts", "easings"],
                        },
                    },
                    required: ["category"],
                },
            },
            {
                name: "add_layer",
                description:
                    "Add a new layer as a clip on a video track. Higher track numbers composite on top of lower ones; by default the layer goes on a new track above everything. Returns the new layer's id. Pass properties to style it in the same call.",
                input_schema: {
                    type: "object",
                    properties: {
                        kind: {
                            type: "string",
                            enum: Object.keys(LAYER_KINDS),
                            description:
                                "scene = 3D scene (holds 3D objects, lights, a camera), text = 2D text, shape = preset ellipse/rectangle/polygon, path = custom vector shape, image = still image, adjustment = effects applied to all layers below, composite = group.",
                        },
                        track: { type: "integer", description: "Video track index. Defaults to a new track on top. Created if it does not exist yet." },
                        start: { type: "integer", description: "First frame of the clip on the sequence timeline. Defaults to 0." },
                        length: { type: "integer", description: "Clip length in frames. Defaults to running until the end of the sequence." },
                        name: { type: "string", description: "Display name for the layer." },
                        text: { type: "string", description: "For kind=text only: the string to display." },
                        properties: PROPERTY_LIST_ARG,
                    },
                    required: ["kind"],
                },
            },
            {
                name: "duplicate_layer",
                description: "Copy a layer with everything on it (properties, animation, effects, children). By default the copy goes on a new track directly above the original.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        track: { type: "integer", description: "Put the copy on this existing track instead." },
                        start: { type: "integer", description: "Start frame for the copy. Defaults to the original's." },
                        name: { type: "string", description: "Name for the copy." },
                    },
                    required: ["layer"],
                },
            },
            {
                name: "delete_layer",
                description: "Delete a layer and its clip. Ids of later clips on the same track shift down by one.",
                input_schema: {
                    type: "object",
                    properties: { layer: LAYER_ARG },
                    required: ["layer"],
                },
            },
            {
                name: "edit_clip",
                description:
                    "Move or retime a layer's clip on the timeline: change its start frame, its length, or the track it sits on. Use this to stagger elements so they enter one after another. Returns the clip's new id.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        start: { type: "integer", description: "New start frame on the sequence timeline." },
                        length: { type: "integer", description: "New length in frames." },
                        track: { type: "integer", description: "Move to this video track (created if needed)." },
                    },
                    required: ["layer"],
                },
            },
            {
                name: "add_node",
                description:
                    "Add a child to a layer: an effect (to any layer's effects), a 3D object, light or camera (to a scene layer's objects), a material (to a 3D object, replacing its current one), or a shape part. Use list_catalog to see the names. Returns the new node path and its properties; pass properties to set them in the same call.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        parent: {
                            type: "string",
                            description:
                                "The list to add to: \"effects\" (default), \"objects\" for a scene's 3D objects, \"objects/1/material\" for a 3D object's material, \"objects/0/objects\" inside a 3D group.",
                        },
                        item: { type: "string", description: "Catalog name, e.g. \"Gaussian Blur\", \"Glow\", \"Sphere\", \"Point light\", \"Single Color\"." },
                        index: { type: "integer", description: "Position in the list. Defaults to the end (effects apply in list order)." },
                        name: { type: "string", description: "Display name for the new child." },
                        properties: PROPERTY_LIST_ARG,
                    },
                    required: ["layer", "item"],
                },
            },
            {
                name: "delete_node",
                description: "Remove a child (effect, 3D object, shape part) from a layer.",
                input_schema: {
                    type: "object",
                    properties: { layer: LAYER_ARG, node: { type: "string", description: "Node path, e.g. \"effects/1\"." } },
                    required: ["layer", "node"],
                },
            },
            {
                name: "move_node",
                description: "Reorder a child within its list, e.g. to change the order effects are applied in.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        node: { type: "string", description: "Node path, e.g. \"effects/2\"." },
                        index: { type: "integer", description: "New position in the same list." },
                    },
                    required: ["layer", "node", "index"],
                },
            },
            {
                name: "set_property",
                description:
                    "Set a single property value on a layer or one of its children. On an animated property this sets (or adds) the keyframe at the given frame.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        node: NODE_ARG,
                        path: {
                            type: "string",
                            description: "Property path from describe_layer, e.g. \"opacity\", \"position\", \"text\", \"fill.color\".",
                        },
                        value: VALUE_ARG,
                        frame: {
                            type: "integer",
                            description: "Clip-relative frame to set the value at. Defaults to 0. Only meaningful on animated properties.",
                        },
                    },
                    required: ["layer", "path", "value"],
                },
            },
            {
                name: "set_properties",
                description:
                    "Set many property values in one call, across any layers and children. Each edit is applied independently and reports its own success, so one bad path does not stop the rest. Prefer this for styling several things at once.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: { type: "string", description: "Default layer id for edits that do not name one." },
                        node: { type: "string", description: "Default node path for edits that do not name one." },
                        edits: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    layer: LAYER_ARG,
                                    node: NODE_ARG,
                                    path: { type: "string", description: "Property path." },
                                    value: VALUE_ARG,
                                    frame: { type: "integer", description: "Clip-relative frame, for animated properties." },
                                },
                                required: ["path", "value"],
                            },
                        },
                    },
                    required: ["edits"],
                },
            },
            {
                name: "animate_property",
                description:
                    "Replace a property's animation with the given keyframes, turning animation on if it is off. Works on layers and on children (node), e.g. an effect's strength or a 3D object's rotation. Frames are relative to the clip start, not the sequence. Any keyframes the property already had at other frames are removed, so pass the complete animation. Use easings for polished motion: \"cubic out\" or \"quintic out\" for entrances, \"cubic in\" for exits, \"back out\" for a slight overshoot, \"elastic out\" or \"bounce out\" for playful motion.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        node: NODE_ARG,
                        path: { type: "string", description: "Property path from describe_layer." },
                        easing: { type: "string", description: "Default easing for keyframes that do not set their own." },
                        keyframes: {
                            type: "array",
                            description: "The complete set of keyframes.",
                            items: KEYFRAME_ITEMS,
                        },
                    },
                    required: ["layer", "path", "keyframes"],
                },
            },
            {
                name: "clear_animation",
                description: "Remove a property's keyframes and expression, leaving it static at its value at the given frame.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        node: NODE_ARG,
                        path: { type: "string", description: "Property path." },
                        frame: { type: "integer", description: "Clip-relative frame whose value is kept. Defaults to 0." },
                    },
                    required: ["layer", "path"],
                },
            },
            {
                name: "set_expression",
                description:
                    "Drive a property from an expression evaluated every frame, instead of keyframes. Good for continuous motion (bobbing, spinning, pulsing, flicker, wiggle) that would otherwise need many keyframes. The last statement is the returned value. Available: the variables frame and time, Math functions unqualified (sin, cos, abs, pow, random, PI...), and the helpers add, sub, mul, div for vectors. Nothing else resolves — an unknown name is a syntax error. Pass expression: null to clear.",
                input_schema: {
                    type: "object",
                    properties: {
                        layer: LAYER_ARG,
                        node: NODE_ARG,
                        path: { type: "string", description: "Property path from describe_layer." },
                        expression: {
                            type: ["string", "null"],
                            description: "e.g. \"sin(time * 2) * 50\" for a scalar, or \"[0, sin(time) * 100]\" for a vector2.",
                        },
                    },
                    required: ["layer", "path", "expression"],
                },
            },
            {
                name: "set_sequence_property",
                description: "Set a sequence-wide property: resolution ([w,h]), rate (frames per second), background colour or motion blur settings. get_project lists them as sequence_properties.",
                input_schema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Property name, e.g. \"resolution\" or \"rate\"." },
                        value: { description: "The new value." },
                    },
                    required: ["name", "value"],
                },
            },
            {
                name: "render_frame",
                description:
                    "Render one frame of the project and look at it. Use this to check your work: after building or changing something visual, render a representative frame and judge whether it actually looks right, then fix what does not. Also moves the editor playhead to that frame so the user sees the same thing.",
                input_schema: {
                    type: "object",
                    properties: {
                        frame: { type: "integer", description: "Sequence frame to render. Defaults to the current playhead position." },
                    },
                    required: [],
                },
            },
            {
                name: "render_frames",
                description:
                    "Render several frames into one labelled contact sheet, to judge motion and timing at a glance: entrances, exits, easing, staggering. With no frames given it samples evenly across the sequence.",
                input_schema: {
                    type: "object",
                    properties: {
                        frames: { type: "array", items: { type: "integer" }, description: "Sequence frames to render, up to 12." },
                        count: { type: "integer", description: "When frames is omitted: how many evenly spaced frames (2-12, default 6)." },
                    },
                    required: [],
                },
            },
        ],

        // Undo commands accumulated across the current agent turn.
        _buffer: null,

        async call(name, args) {
            if (!editor) throw new Error("The editor is not ready yet.");
            let fn = impl[name];
            if (!fn) throw new Error("Unknown tool '" + name + "'.");

            // history.operation is a single slot rather than a stack, so an
            // operation left open across the agent's network waits would be
            // clobbered by any edit the user makes in the meantime — and the
            // next pushCommand would then throw on null. Hold it open only for
            // the duration of one tool call and bank the commands ourselves.
            // If the user is mid-drag their operation is set aside and put back
            // afterwards, so neither side's commands end up in the other's step.
            let history = editor.history;
            let userOperation = history.operation;
            history.operation = [];
            try {
                return await fn(args || {});
            } finally {
                let commands = history.operation || [];
                history.operation = null;
                if (this._buffer) this._buffer.push.apply(this._buffer, commands);
                else commit(history, commands);
                history.operation = userOperation;
            }
        },

        // One undo group per agent turn: whatever the agent did during the turn
        // comes back out on a single ctrl+Z.
        beginTurn() {
            this._buffer = [];
        },

        endTurn() {
            let commands = this._buffer;
            this._buffer = null;
            if (!commands || !commands.length) return;
            // Don't merge into an operation the user has open mid-drag.
            let history = editor.history;
            let userOperation = history.operation;
            commit(history, commands);
            history.operation = userOperation;
        },
    };

    // Push a finished list of commands as one undo step.
    function commit(history, commands) {
        if (!commands.length) return;
        history.operation = commands;
        history.finishOperation();
    }
})();

// ============================================================================
// agent/client.js
// ============================================================================

// PZ.agent.client — the agent loop, plus one adapter per model provider.
//
// openzoid is a no-build static site with no package manager, so this talks to
// each provider's REST API over fetch rather than through an SDK. Keys live in
// localStorage and requests go straight from the page. Point the endpoint at
// your own proxy if you would rather a key not live in the browser.
//
// Adding a provider means implementing the small interface at the bottom of
// this file: own your native conversation history, and translate the shared
// tool definitions to and from your wire format. The loop itself is shared.

var PZ = PZ || {};
PZ.agent = PZ.agent || {};

(function () {
    "use strict";

    // Shared with MCP clients: mcp/server.js sends this as its instructions.
    PZ.agent.guide = [
        "You are an agent embedded in Panzoid Clipmaker 3 (openzoid), a browser-based motion graphics and video editor. You build and edit the user's project directly through the tools you have been given.",
        "",
        "How a project is put together:",
        "- A sequence has a resolution, a frame rate, and a length in frames.",
        "- It holds video tracks. Each track holds clips laid out along the timeline, and each clip contains exactly one layer. Higher-numbered tracks composite on top of lower-numbered ones.",
        "- A layer is a scene (3D), text, a preset shape, a path shape, an image, an adjustment, or a composite. Layers carry properties, and most properties can be static, keyframed, or driven by an expression.",
        "- Layers also hold children, addressed by node paths: effects (\"effects/0\") on any layer, 3D objects, lights and the camera (\"objects/1\") in a scene, and each 3D object's material (\"objects/1/material\"). describe_layer lists them; add_node adds them from list_catalog.",
        "",
        "Conventions that are easy to get wrong:",
        "- Layer position is in pixels with the origin at the centre of the frame, x to the right and y upward. At 1920x1080 the top-left corner is [-960, 540].",
        "- Rotation is in radians. Opacity runs 0 to 1. Colours are [r, g, b] arrays in 0 to 1 (a \"#rrggbb\" string also works).",
        "- Keyframe frames on a layer's properties are relative to that clip's start, not to the sequence timeline. A clip starting at frame 60 animates from its own frame 0.",
        "- A new scene layer shows nothing until it has objects and light: add shapes with a material colour, and at least one light (an ambient light plus a directional or point light reads well). The camera looks down -z, so place objects at negative z.",
        "- Layer and clip ids shift when clips are added, moved or deleted. Re-read get_project rather than reusing old ids.",
        "",
        "Making it look finished rather than a placeholder:",
        "- Build in layers: a background (a full-frame shape or gradient), the main subject, supporting accents, then finishing effects. A lone white text on black is rarely what anyone wants.",
        "- Pick a deliberate palette of two or three colours and a font that suits the mood (list_catalog fonts). Set size, stroke and colour instead of leaving defaults.",
        "- Give motion intent: eased entrances (\"cubic out\", \"back out\"), staggered timing between elements (edit_clip or offset keyframes), a hold, and an exit. Add secondary motion with expressions, such as a slow drift, a gentle pulse, or a camera move.",
        "- Use effects for polish where they help: Bloom or glow-like light, Vignette, Gaussian Blur for depth or blur-in transitions, Chromatic Aberration or Glitch for energy, Color Grading to unify the look.",
        "- Use set_properties and the properties argument on add_layer/add_node to style many things in one call.",
        "",
        "How to work:",
        "- Start by calling get_project so you know what is actually there, and call describe_layer before setting a property on something you have not inspected.",
        "- Prefer set_expression over long keyframe lists for continuous motion, and animate_property with easings for deliberate, timed movement.",
        "- Look at your work. Render a frame after you build something visual, and use render_frames to check motion across time. Judge what you see rather than assuming the numbers were right, and fix what does not look good. This matters most for position, scale, colour and timing.",
        "- Everything you do in one turn is a single undo step for the user, so you are free to iterate.",
        "",
        "Deliver what the user asked for, at the scope they intended. Make routine judgement calls yourself and check in only when different readings would lead to materially different work. When you are done, say briefly what you made and what the user might want to adjust — no recap of every tool call, since they can see the result on the canvas.",
    ].join("\n");
    const SYSTEM_PROMPT = PZ.agent.guide;

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key) || "";
            if (value) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
        } catch (e) {
            return "";
        }
        return value;
    }

    async function postJSON(url, headers, body, label) {
        let response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers: Object.assign({ "content-type": "application/json" }, headers),
                body: JSON.stringify(body),
            });
        } catch (e) {
            throw new Error(
                "Could not reach " + label + ". Check that you are online and that the endpoint in settings is correct. (" + e.message + ")"
            );
        }
        if (!response.ok) {
            let detail = "";
            try {
                let json = await response.json();
                detail = (json.error && (json.error.message || json.error.status)) || JSON.stringify(json);
            } catch (e) {
                detail = await response.text();
            }
            throw new Error("API error " + response.status + ": " + detail);
        }
        return await response.json();
    }

    // ------------------------------------------------------------- Anthropic

    const anthropic = {
        id: "anthropic",
        label: "Anthropic",
        defaultModel: "claude-opus-5-5",
        defaultBaseUrl: "https://api.anthropic.com",
        keyPlaceholder: "sk-ant-…",
        keyHint: "Create one at console.anthropic.com.",
        matchesKey: (key) => /^sk-ant-/.test(key),

        history: [],
        reset() {
            this.history = [];
        },
        pushUser(text) {
            this.history.push({ role: "user", content: text });
        },

        async send(ctx) {
            let data = await postJSON(
                ctx.baseUrl + "/v1/messages",
                {
                    "x-api-key": ctx.apiKey,
                    "anthropic-version": "2023-06-01",
                    "anthropic-dangerous-direct-browser-access": "true",
                },
                {
                    model: ctx.model,
                    max_tokens: 16000,
                    system: SYSTEM_PROMPT,
                    tools: ctx.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        input_schema: t.input_schema,
                    })),
                    messages: this.history,
                },
                ctx.baseUrl
            );

            if (data.stop_reason === "refusal") throw new Error("The model declined this request.");

            // Echoed back verbatim: thinking blocks must return unmodified.
            this.history.push({ role: "assistant", content: data.content });

            let texts = [];
            let calls = [];
            for (let block of data.content || []) {
                if (block.type === "text" && block.text) texts.push(block.text);
                else if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, args: block.input });
            }
            return { texts: texts, calls: calls };
        },

        pushToolResults(results) {
            let content = results.map((r) => {
                if (r.isError) {
                    return { type: "tool_result", tool_use_id: r.id, content: String(r.error), is_error: true };
                }
                if (r.value && r.value._image) {
                    return {
                        type: "tool_result",
                        tool_use_id: r.id,
                        content: [
                            { type: "image", source: { type: "base64", media_type: "image/png", data: r.value._image } },
                            { type: "text", text: "Rendered frame " + r.value.frame + "." },
                        ],
                    };
                }
                return { type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.value) };
            });
            this.history.push({ role: "user", content: content });
        },
    };

    // ---------------------------------------------------------------- Google

    // Gemini's function declarations use an OpenAPI subset that is stricter
    // than JSON Schema: every property needs a concrete type, union types are
    // not allowed, and unknown keywords are rejected. The shared tool
    // definitions use untyped "value" parameters (they legitimately accept a
    // number, an array or a string), so those become strings here and the tool
    // layer coerces them back using the target property's declared type.
    function toGeminiSchema(schema) {
        if (!schema || typeof schema !== "object") return undefined;

        let type = schema.type;
        let nullable = false;
        if (Array.isArray(type)) {
            nullable = type.indexOf("null") !== -1;
            type = type.filter((t) => t !== "null")[0];
        }

        let out = {};
        let description = schema.description || "";

        if (!type) {
            // Untyped: accept it as text and let the tool layer parse it.
            type = "string";
            description = (description ? description + " " : "") + "Give a number as digits, a list as a JSON array such as [0, 100], and text as-is.";
        }
        out.type = type;
        if (description) out.description = description;
        if (nullable) out.nullable = true;
        if (schema.enum) out.enum = schema.enum.map(String);

        if (type === "object" && schema.properties) {
            out.properties = {};
            for (let key of Object.keys(schema.properties)) {
                out.properties[key] = toGeminiSchema(schema.properties[key]);
            }
            if (schema.required && schema.required.length) out.required = schema.required.slice();
        }
        if (type === "array") {
            out.items = toGeminiSchema(schema.items) || { type: "string" };
        }
        return out;
    }

    const google = {
        id: "google",
        label: "Google (Gemini)",
        defaultModel: "gemini-2.5-pro",
        defaultBaseUrl: "https://generativelanguage.googleapis.com",
        keyPlaceholder: "AIza…",
        keyHint: "Create one at aistudio.google.com/apikey.",
        matchesKey: (key) => /^AIza/.test(key),

        history: [],
        reset() {
            this.history = [];
        },
        pushUser(text) {
            this.history.push({ role: "user", parts: [{ text: text }] });
        },

        async send(ctx) {
            let declarations = ctx.tools.map((t) => {
                let decl = { name: t.name, description: t.description };
                let params = toGeminiSchema(t.input_schema);
                // Gemini rejects an object schema with no properties.
                if (params && params.properties && Object.keys(params.properties).length) {
                    decl.parameters = params;
                }
                return decl;
            });

            let data = await postJSON(
                ctx.baseUrl + "/v1beta/models/" + encodeURIComponent(ctx.model) + ":generateContent",
                { "x-goog-api-key": ctx.apiKey },
                {
                    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                    contents: this.history,
                    tools: [{ functionDeclarations: declarations }],
                    generationConfig: { maxOutputTokens: 16384 },
                },
                ctx.baseUrl
            );

            if (data.promptFeedback && data.promptFeedback.blockReason) {
                throw new Error("The request was blocked: " + data.promptFeedback.blockReason + ".");
            }
            let candidate = (data.candidates || [])[0];
            if (!candidate) throw new Error("The model returned no response.");
            if (candidate.finishReason && ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"].indexOf(candidate.finishReason) !== -1) {
                throw new Error("The model stopped: " + candidate.finishReason + ".");
            }

            let parts = (candidate.content && candidate.content.parts) || [];
            // Echoed back verbatim so thought signatures survive the round trip.
            this.history.push({ role: "model", parts: parts });

            let texts = [];
            let calls = [];
            for (let i = 0; i < parts.length; i++) {
                let part = parts[i];
                if (part.functionCall) {
                    calls.push({
                        // Gemini identifies calls by name, not id; keep the index
                        // so repeated calls to one tool stay distinguishable.
                        id: part.functionCall.name + ":" + i,
                        name: part.functionCall.name,
                        args: part.functionCall.args || {},
                    });
                } else if (part.text && !part.thought) {
                    texts.push(part.text);
                }
            }
            if (candidate.finishReason === "MAX_TOKENS" && !calls.length) {
                texts.push("(response cut off at the token limit)");
            }
            return { texts: texts, calls: calls };
        },

        pushToolResults(results) {
            let parts = [];
            for (let r of results) {
                let payload;
                if (r.isError) payload = { error: String(r.error) };
                else if (r.value && r.value._image) payload = { result: "Rendered frame " + r.value.frame + "; the image follows." };
                else payload = { result: r.value === undefined ? null : r.value };

                // functionResponse.response must be a JSON object, never a bare
                // value, so scalars are wrapped above.
                parts.push({ functionResponse: { name: r.name, response: payload } });

                // Images cannot ride inside a functionResponse, so they follow
                // as an ordinary inline part in the same user turn.
                if (!r.isError && r.value && r.value._image) {
                    parts.push({ inlineData: { mimeType: "image/png", data: r.value._image } });
                }
            }
            this.history.push({ role: "user", parts: parts });
        },
    };

    PZ.agent.providers = { anthropic: anthropic, google: google };

    // ------------------------------------------------------------ the client

    PZ.agent.client = {
        running: false,
        aborted: false,

        get providerId() {
            return store("pz.agent.provider") || "anthropic";
        },
        set providerId(v) {
            if (v !== this.providerId) {
                store("pz.agent.provider", v === "anthropic" ? "" : v);
                this.reset();
            }
        },
        get provider() {
            return PZ.agent.providers[this.providerId] || anthropic;
        },

        // Keys, models and endpoints are kept per provider so switching back
        // and forth does not lose the other one's settings.
        get apiKey() {
            return store("pz.agent.apiKey." + this.providerId);
        },
        set apiKey(v) {
            store("pz.agent.apiKey." + this.providerId, v);
        },
        get model() {
            return store("pz.agent.model." + this.providerId) || this.provider.defaultModel;
        },
        set model(v) {
            store("pz.agent.model." + this.providerId, v === this.provider.defaultModel ? "" : v);
        },
        get baseUrl() {
            return store("pz.agent.baseUrl." + this.providerId) || this.provider.defaultBaseUrl;
        },
        set baseUrl(v) {
            store("pz.agent.baseUrl." + this.providerId, v === this.provider.defaultBaseUrl ? "" : v);
        },

        // Which provider does this key look like it belongs to?
        detectProvider(key) {
            for (let id of Object.keys(PZ.agent.providers)) {
                if (PZ.agent.providers[id].matchesKey(key)) return id;
            }
            return null;
        },

        reset() {
            for (let id of Object.keys(PZ.agent.providers)) PZ.agent.providers[id].reset();
        },

        stop() {
            this.aborted = true;
        },

        // events: { onText, onToolUse, onToolResult, onError, onDone }
        async send(userText, events) {
            events = events || {};
            let provider = this.provider;
            if (!this.apiKey) throw new Error("No API key set for " + provider.label + ". Open the agent settings and paste one in.");
            if (this.running) throw new Error("The agent is already working.");

            this.running = true;
            this.aborted = false;
            provider.pushUser(userText);

            PZ.agent.tools.beginTurn();
            try {
                while (true) {
                    if (this.aborted) {
                        if (events.onText) events.onText("(stopped)");
                        break;
                    }

                    let turn = await provider.send({
                        apiKey: this.apiKey,
                        baseUrl: this.baseUrl,
                        model: this.model,
                        tools: PZ.agent.tools.definitions,
                    });

                    for (let text of turn.texts) if (events.onText) events.onText(text);
                    if (!turn.calls.length) break;

                    let results = [];
                    for (let call of turn.calls) {
                        if (events.onToolUse) events.onToolUse(call.name, call.args);
                        try {
                            let value = await PZ.agent.tools.call(call.name, call.args);
                            results.push({ id: call.id, name: call.name, value: value });
                            if (events.onToolResult) events.onToolResult(call.name, value, null);
                        } catch (err) {
                            results.push({ id: call.id, name: call.name, isError: true, error: err && err.message ? err.message : err });
                            if (events.onToolResult) events.onToolResult(call.name, null, err);
                        }
                    }

                    // All results for one assistant turn go back together, or the
                    // model learns to stop issuing parallel calls.
                    provider.pushToolResults(results);
                }
            } catch (err) {
                if (events.onError) events.onError(err);
                else throw err;
            } finally {
                PZ.agent.tools.endTurn();
                this.running = false;
                if (events.onDone) events.onDone();
            }
        },
    };
})();

// ============================================================================
// agent/bridge.js
// ============================================================================

// PZ.agent.bridge — exposes the same tools to an external MCP client (Claude
// Desktop, Claude Code, any MCP host) through mcp/server.js.
//
// The page cannot accept connections, so it dials out instead: it registers
// its tool list with the local server, then long-polls it for calls, runs
// each one through PZ.agent.tools.call (so each lands as one undo step) and
// posts the result back. If the server goes away the bridge keeps retrying
// with backoff until it comes back or the user turns it off.

var PZ = PZ || {};
PZ.agent = PZ.agent || {};

(function () {
    "use strict";

    const DEFAULT_URL = "http://127.0.0.1:7823";

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key) || "";
            if (value) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
        } catch (e) {
            return "";
        }
        return value;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    PZ.agent.bridge = {
        status: "off",
        detail: "",
        calls: 0,
        _generation: 0,
        _listeners: [],

        get enabled() {
            return store("pz.agent.bridge") === "1";
        },
        set enabled(v) {
            store("pz.agent.bridge", v ? "1" : "");
            if (v) this.start();
            else this.stop();
        },

        // When the editor is served by mcp/server.js itself (which marks the
        // page with PZ_MCP_SAME_ORIGIN), the bridge lives at the same origin;
        // otherwise it is the default local port.
        get defaultUrl() {
            try {
                if (window.PZ_MCP_SAME_ORIGIN) return location.origin;
            } catch (e) {
                /* no window in this environment */
            }
            return DEFAULT_URL;
        },
        get url() {
            return (store("pz.agent.bridgeUrl") || this.defaultUrl).replace(/\/+$/, "");
        },
        set url(v) {
            v = String(v || "").trim();
            store("pz.agent.bridgeUrl", v && v !== this.defaultUrl ? v : "");
            if (this.enabled) this.start();
        },

        onStatus(fn) {
            this._listeners.push(fn);
            return () => {
                this._listeners = this._listeners.filter((f) => f !== fn);
            };
        },

        _set(status, detail) {
            this.status = status;
            this.detail = detail || "";
            for (let fn of this._listeners) {
                try {
                    fn(status, this.detail);
                } catch (e) {
                    /* a closed panel's listener */
                }
            }
        },

        // Called once the editor is attached.
        autoStart() {
            if (this.enabled) this.start();
        },

        start() {
            let generation = ++this._generation;
            this._loop(generation);
        },

        stop() {
            this._generation++;
            this._set("off");
        },

        async _request(method, path, body, timeoutMs) {
            let controller = new AbortController();
            let timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
            try {
                let response = await fetch(this.url + path, {
                    method: method,
                    headers: body ? { "content-type": "application/json" } : undefined,
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                    cache: "no-store",
                });
                let json = null;
                if (response.status !== 204) {
                    try {
                        json = await response.json();
                    } catch (e) {
                        json = null;
                    }
                }
                return { status: response.status, json: json };
            } finally {
                clearTimeout(timer);
            }
        },

        async _loop(generation) {
            let backoff = 1000;
            let alive = () => generation === this._generation;

            while (alive()) {
                // Register (or re-register after the server restarted).
                this._set("connecting", this.url);
                let session;
                try {
                    let res = await this._request("POST", "/editor/connect", {
                        tools: PZ.agent.tools.definitions,
                        guide: PZ.agent.guide || "",
                        title: document.title || "openzoid",
                    });
                    if (res.status !== 200 || !res.json || !res.json.session) throw new Error("unexpected reply " + res.status);
                    session = res.json.session;
                } catch (e) {
                    if (!alive()) return;
                    this._set("waiting", "No MCP server at " + this.url + ". Start it with: node mcp/server.js");
                    await sleep(backoff);
                    backoff = Math.min(backoff * 2, 15000);
                    continue;
                }

                backoff = 1000;
                this._set("connected", this.url);

                // Long-poll for calls until the session ends.
                while (alive()) {
                    let res;
                    try {
                        res = await this._request("GET", "/editor/next?session=" + encodeURIComponent(session), null, 35000);
                    } catch (e) {
                        if (e && e.name === "AbortError") continue; // poll timed out client-side; just poll again
                        break; // server gone; go back to connecting
                    }
                    if (!alive()) return;
                    if (res.status === 204) continue;
                    if (res.status !== 200 || !res.json) break; // session replaced or server restarted

                    let call = res.json;
                    this.calls++;
                    this._set("connected", "Running " + call.name);
                    let reply = { session: session, id: call.id };
                    try {
                        reply.value = await PZ.agent.tools.call(call.name, call.args || {});
                        reply.ok = true;
                    } catch (err) {
                        reply.ok = false;
                        reply.error = err && err.message ? err.message : String(err);
                    }
                    try {
                        await this._request("POST", "/editor/result", reply, 30000);
                    } catch (e) {
                        /* the server will time the call out */
                    }
                    if (alive()) this._set("connected", this.url);
                }
            }
        },
    };

    // ?mcp in the page URL turns the bridge on (and remembers it), so a link
    // can set everything up; ?mcp=http://host:port also picks the server.
    // Read at load time so the settings panel, built before the editor
    // attaches, already shows it.
    try {
        let params = new URLSearchParams(location.search);
        if (params.has("mcp") || /(^|[#&])mcp\b/.test(location.hash)) {
            let custom = params.get("mcp");
            if (custom && /^https?:\/\//.test(custom)) store("pz.agent.bridgeUrl", custom);
            store("pz.agent.bridge", "1");
        }
    } catch (e) {
        /* no location outside a browser */
    }
})();

// ============================================================================
// agent/panel.js
// ============================================================================

// PZ.agent.panel — the chat panel, sitting in the menu bar next to Export.

var PZ = PZ || {};
PZ.agent = PZ.agent || {};

(function () {
    "use strict";

    // Outside the editor (e.g. mcp/server.js reading the tool definitions)
    // there is no UI to build.
    if (!(PZ.ui && PZ.ui.panel && PZ.ui.panel.nav)) return;

    const COLORS = {
        text: "#ccc",
        dim: "#888",
        panel: "#2a2a2a",
        field: "#1d1d1d",
        border: "#444",
        accent: "#8a2828",
        error: "#c86464",
    };

    function el(tag, style, text) {
        let node = document.createElement(tag);
        if (style) node.style.cssText = style;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    PZ.ui.agent = class extends PZ.ui.panel.nav {
        constructor(editor) {
            super(editor);
            this.title = "AI";
            this.icon = "inspired";
            this.minWidth = 220;
            this.log = null;
            this.create();
        }

        create() {
            this.navigate(PZ.agent.client.apiKey ? this.createChatPage() : this.createSettingsPage(true));
        }

        // ------------------------------------------------------------ chat

        createChatPage() {
            let page = this.createPage("AI agent");
            page.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;";

            let bar = el("div", "display:flex;gap:6px;padding:0 8px 6px 8px;flex:0 0 auto;");
            bar.appendChild(this.smallButton("New chat", () => {
                PZ.agent.client.reset();
                this.log.textContent = "";
                this.note("Started a new conversation. The project itself is untouched.");
            }));
            bar.appendChild(this.smallButton("Settings", () => this.navigate(this.createSettingsPage(false), true)));
            page.appendChild(bar);

            this.log = el(
                "div",
                "flex:1 1 auto;overflow-y:auto;padding:8px;font-size:12px;line-height:1.5;color:" +
                    COLORS.text +
                    ";background-color:" +
                    COLORS.field +
                    ";margin:0 8px;border-radius:3px;"
            );
            page.appendChild(this.log);

            let inputRow = el("div", "display:flex;flex-direction:column;gap:6px;padding:8px;flex:0 0 auto;");
            let input = el(
                "textarea",
                "resize:none;height:64px;background-color:" +
                    COLORS.field +
                    ";color:" +
                    COLORS.text +
                    ";border:1px solid " +
                    COLORS.border +
                    ";border-radius:3px;padding:6px;font-family:inherit;font-size:12px;"
            );
            input.placeholder = "Describe what you want to make or change…";
            this.input = input;

            let send = this.smallButton("Send", () => this.submit());
            send.style.width = "100%";
            this.sendButton = send;

            input.addEventListener("keydown", (e) => {
                // Enter sends, shift+Enter is a newline. Stop the editor's global
                // shortcut handler from also seeing these keys.
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.submit();
                }
            });

            inputRow.appendChild(input);
            inputRow.appendChild(send);
            page.appendChild(inputRow);

            if (!this.greeted) {
                this.greeted = true;
                setTimeout(() => this.note("Ask for something and I'll build it in the project. Everything I do in one reply is a single undo step."), 0);
            }
            return page;
        }

        smallButton(label, onClick) {
            let button = el(
                "button",
                "background-color:" +
                    COLORS.panel +
                    ";color:" +
                    COLORS.text +
                    ";border:1px solid " +
                    COLORS.border +
                    ";border-radius:3px;padding:5px 10px;cursor:pointer;font-size:12px;",
                label
            );
            button.onclick = onClick;
            return button;
        }

        append(text, color, italic) {
            if (!this.log) return;
            let atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
            let line = el(
                "div",
                "margin-bottom:8px;white-space:pre-wrap;word-break:break-word;color:" +
                    (color || COLORS.text) +
                    ";" +
                    (italic ? "font-style:italic;" : ""),
                text
            );
            this.log.appendChild(line);
            if (atBottom) this.log.scrollTop = this.log.scrollHeight;
            return line;
        }

        note(text) {
            this.append(text, COLORS.dim, true);
        }

        submit() {
            let text = this.input.value.trim();
            if (!text) return;
            if (PZ.agent.client.running) return;

            this.input.value = "";
            this.append("› " + text, "#e0e0e0");

            this.sendButton.textContent = "Working…";
            this.sendButton.onclick = () => PZ.agent.client.stop();

            let thinking = this.append("thinking…", COLORS.dim, true);

            PZ.agent.client.send(text, {
                onText: (t) => {
                    if (thinking) {
                        thinking.remove();
                        thinking = null;
                    }
                    this.append(t);
                },
                onToolUse: (name) => {
                    if (thinking) {
                        thinking.remove();
                        thinking = null;
                    }
                    this.note("· " + name.replace(/_/g, " "));
                },
                onToolResult: (name, value, err) => {
                    if (err) this.append("· " + name + " failed: " + err.message, COLORS.error, true);
                },
                onError: (err) => {
                    if (thinking) {
                        thinking.remove();
                        thinking = null;
                    }
                    this.append(String(err.message || err), COLORS.error);
                },
                onDone: () => {
                    if (thinking) thinking.remove();
                    this.sendButton.textContent = "Send";
                    this.sendButton.onclick = () => this.submit();
                },
            });
        }

        // -------------------------------------------------------- settings

        createSettingsPage(isFirstRun) {
            let client = PZ.agent.client;
            let page = this.createPage("AI agent settings", !isFirstRun, () => true);
            page.style.cssText = "padding:0 8px 8px 8px;overflow-y:auto;height:100%;";

            let intro = el(
                "div",
                "font-size:12px;color:" + COLORS.dim + ";line-height:1.5;margin-bottom:12px;",
                isFirstRun
                    ? "Paste an API key to enable the agent. openzoid runs as static files with no server, so the key is stored in this browser's localStorage and sent directly to the provider from this page. Use a key you are willing to keep here, or point the endpoint below at your own proxy instead."
                    : "Keys are stored in this browser's localStorage and sent directly to the provider from this page. Each provider keeps its own key, model and endpoint."
            );
            page.appendChild(intro);

            // Declared up front: the provider select rewrites them on change.
            let key, model, url, hint, status;

            let select = this.select(
                page,
                "Provider",
                Object.keys(PZ.agent.providers).map((id) => ({ value: id, label: PZ.agent.providers[id].label })),
                client.providerId,
                (value) => {
                    client.providerId = value;
                    let provider = client.provider;
                    key.value = client.apiKey;
                    key.placeholder = provider.keyPlaceholder;
                    model.value = client.model;
                    model.placeholder = provider.defaultModel;
                    url.value = client.baseUrl;
                    url.placeholder = provider.defaultBaseUrl;
                    hint.textContent = provider.keyHint;
                }
            );

            key = this.field(page, "API key", client.apiKey, client.provider.keyPlaceholder, "password");
            hint = el("div", "font-size:11px;color:" + COLORS.dim + ";margin:-6px 0 10px 0;", client.provider.keyHint);
            page.appendChild(hint);

            // Pasting a key that clearly belongs to the other provider is much
            // more likely a provider mix-up than a deliberate choice.
            key.addEventListener("input", () => {
                let detected = client.detectProvider(key.value.trim());
                if (detected && detected !== client.providerId) {
                    select.value = detected;
                    let pending = key.value.trim();
                    select.onchange();
                    key.value = pending;
                }
            });

            model = this.field(page, "Model", client.model, client.provider.defaultModel);
            url = this.field(page, "Endpoint", client.baseUrl, client.provider.defaultBaseUrl);

            let save = this.smallButton("Save", () => {
                let provider = client.provider;
                client.apiKey = key.value.trim();
                client.model = model.value.trim() || provider.defaultModel;
                client.baseUrl = url.value.trim() || provider.defaultBaseUrl;
                if (!client.apiKey) {
                    status.textContent = "A key is required.";
                    status.style.color = COLORS.error;
                    return;
                }
                this.navigate(this.createChatPage());
            });
            save.style.cssText += "margin-top:6px;width:100%;";
            page.appendChild(save);

            status = el("div", "font-size:12px;margin-top:8px;color:" + COLORS.dim + ";");
            page.appendChild(status);

            if (!isFirstRun) {
                let clear = this.smallButton("Forget key", () => {
                    client.apiKey = "";
                    key.value = "";
                    status.textContent = client.provider.label + " key removed from this browser.";
                    status.style.color = COLORS.dim;
                });
                clear.style.cssText += "margin-top:8px;width:100%;";
                page.appendChild(clear);
            }

            this.createBridgeSettings(page);
            return page;
        }

        // The MCP bridge needs no API key: the external MCP client brings its
        // own model, so this section works on the first-run page too.
        createBridgeSettings(page) {
            let bridge = PZ.agent.bridge;
            if (!bridge) return;

            page.appendChild(el("div", "border-top:1px solid " + COLORS.border + ";margin:16px 0 12px 0;"));
            page.appendChild(el("div", "font-size:13px;color:" + COLORS.text + ";margin-bottom:6px;", "MCP bridge"));
            page.appendChild(
                el(
                    "div",
                    "font-size:12px;color:" + COLORS.dim + ";line-height:1.5;margin-bottom:10px;",
                    "Let an MCP client such as Claude Desktop or Claude Code drive this editor with the same tools. Run node mcp/server.js and register it with your client (see mcp/README.md), then turn this on. No API key is needed here."
                )
            );

            let row = el("label", "display:flex;align-items:center;gap:8px;font-size:12px;color:" + COLORS.text + ";margin-bottom:10px;cursor:pointer;");
            let toggle = el("input");
            toggle.type = "checkbox";
            toggle.checked = bridge.enabled;
            row.appendChild(toggle);
            row.appendChild(document.createTextNode("Connect to a local MCP server"));
            page.appendChild(row);

            let url = this.field(page, "Server address", bridge.url, "http://127.0.0.1:7823");
            url.addEventListener("change", () => {
                bridge.url = url.value;
                url.value = bridge.url;
            });

            let state = el("div", "font-size:12px;line-height:1.5;word-break:break-word;");
            page.appendChild(state);
            let show = (status, detail) => {
                let labels = { off: "Off", connecting: "Connecting…", waiting: "Waiting for server", connected: "Connected" };
                state.textContent = (labels[status] || status) + (detail ? " — " + detail : "");
                state.style.color = status === "connected" ? "#7fbf7f" : status === "waiting" ? COLORS.error : COLORS.dim;
            };
            show(bridge.status, bridge.detail);
            // Settings pages are rebuilt each time they open; only the newest
            // one needs to follow the status.
            if (this.unwatchBridge) this.unwatchBridge();
            this.unwatchBridge = bridge.onStatus(show);

            toggle.onchange = () => {
                bridge.url = url.value;
                bridge.enabled = toggle.checked;
            };
        }

        select(parent, label, options, value, onChange) {
            parent.appendChild(el("div", "font-size:12px;color:" + COLORS.text + ";margin-bottom:4px;", label));
            let node = el(
                "select",
                "width:100%;box-sizing:border-box;background-color:" +
                    COLORS.field +
                    ";color:" +
                    COLORS.text +
                    ";border:1px solid " +
                    COLORS.border +
                    ";border-radius:3px;padding:6px;margin-bottom:10px;font-size:12px;"
            );
            for (let option of options) {
                let node2 = el("option", "", option.label);
                node2.value = option.value;
                node.appendChild(node2);
            }
            node.value = value;
            node.onchange = () => onChange(node.value);
            node.addEventListener("keydown", (e) => e.stopPropagation());
            parent.appendChild(node);
            return node;
        }

        field(parent, label, value, placeholder, type) {
            parent.appendChild(el("div", "font-size:12px;color:" + COLORS.text + ";margin-bottom:4px;", label));
            let input = el(
                "input",
                "width:100%;box-sizing:border-box;background-color:" +
                    COLORS.field +
                    ";color:" +
                    COLORS.text +
                    ";border:1px solid " +
                    COLORS.border +
                    ";border-radius:3px;padding:6px;margin-bottom:10px;font-size:12px;"
            );
            input.type = type || "text";
            input.value = value || "";
            input.placeholder = placeholder || "";
            input.addEventListener("keydown", (e) => e.stopPropagation());
            parent.appendChild(input);
            return input;
        }
    };
})();
