// openzoid mobile — a touch editor over the Clipmaker 3 engine.
//
// Load after core-*.js, ui-*.js and (optionally) agent.js:
//   <script src="./mobile/mobile.js"></script>
//   <script>PZM.start();</script>
//
// The desktop page builds its UI from PZ.ui split panels sized for a mouse.
// This page keeps the same engine, playback, undo history and command layer,
// and replaces only the layout: preview on top, a timeline you scrub by
// dragging with a fixed centre playhead, a tool strip along the bottom, and
// panels that slide up over the timeline while the preview stays visible.
//
// Every edit goes through the same undoable commands the desktop timeline
// uses (PZ.ui.timeline.tracks / PZ.ui.edit / PZ.ui.properties), so projects
// are interchangeable between the two editors and ctrl+Z semantics match.
// The desktop property editor, export and AI panels are embedded as they are
// inside sheets rather than re-implemented.

var PZM = window.PZM || {};
window.PZM = PZM;

(function () {
    "use strict";

    // ---------------------------------------------------------------- dom

    function el(tag, cls, parent, text) {
        let e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        if (parent) parent.appendChild(e);
        return e;
    }

    function icon(name) {
        let s = PZ.ui.generateIcon(name);
        s.setAttribute("class", "pzm-ico");
        return s;
    }

    // A diamond drawn here rather than the sprite's, so it can be outlined
    // when off and filled when there is a keyframe under the playhead.
    function diamondIcon() {
        let s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        s.setAttribute("viewBox", "0 0 24 24");
        s.setAttribute("class", "pzm-ico pzm-diamond");
        let path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M12 3 L21 12 L12 21 L3 12 Z");
        s.appendChild(path);
        return s;
    }

    function iconButton(name, title, fn, cls) {
        let b = el("button", "pzm-iconbtn" + (cls ? " " + cls : ""));
        b.type = "button";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.appendChild(icon(name));
        b.addEventListener("click", fn);
        return b;
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function vibrate(ms) {
        try {
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch (e) {}
    }

    let toastEl = null;
    let toastTimer = 0;
    function toast(msg) {
        if (!toastEl) toastEl = el("div", "pzm-toast", document.body);
        toastEl.textContent = msg;
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
    }

    let busyEl = null;
    function busy(on, text) {
        if (!busyEl) busyEl = el("div", "pzm-busy", document.body);
        busyEl.textContent = text || "Working…";
        busyEl.classList.toggle("show", !!on);
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function formatTime(frame, rate) {
        frame = Math.max(0, Math.round(frame));
        let secs = Math.floor(frame / rate);
        return pad2(Math.floor(secs / 60)) + ":" + pad2(secs % 60) + ":" + pad2(frame % rate);
    }

    // ------------------------------------------------------- editor state

    let editor = null;
    let viewport = null;
    let propOps = null;
    let trackOps = null;
    let objectOps = null;
    let mediaOps = null;

    // The clips the user has selected. Viewport, transform box and property
    // panels all watch this list, exactly as they watch the desktop
    // timeline's selection.
    const selection = new PZ.objectList();

    // Asset key -> object URL of a thumbnail, for clip filmstrips.
    const thumbs = new Map();

    PZM.defaultProject = {
        sequence: {
            properties: { resolution: [1920, 1080], rate: 30 },
            length: 150,
            videoTracks: [{ type: 0, clips: [{ type: 0, start: 0, length: 150, offset: 0, relativeRate: 1, media: null, link: null, properties: { name: "Scene" }, object: { type: 4, effects: [], objects: [{ type: 6, objectType: 1 }] } }] }],
            audioTracks: [{ type: 1, clips: [] }],
        },
        assets: [],
        media: [],
    };

    // Layer templates, keyed by what the user picks. The numbers are the
    // on-disk layer types PZ.layer.create() indexes.
    const LAYERS = {
        text: { name: "Text", object: { type: 7, objects: [], effects: [] } },
        shape: { name: "Shape", object: { type: 8, objects: [], effects: [] } },
        path: { name: "Drawing", object: { type: 6, objects: [], effects: [] } },
        scene: { name: "Scene", object: { type: 4, effects: [], objects: [{ type: 6, objectType: 1 }] } },
        adjustment: { name: "Adjustment", object: { type: 1, effects: [] } },
        composite: { name: "Composite", object: { type: 2, objects: [], effects: [] } },
    };

    function layerKind(clip) {
        if (!clip) return "";
        if (clip instanceof PZ.clip.audio) return "audio";
        let o = clip.object;
        if (o instanceof PZ.layer.shape.text) return "text";
        if (o instanceof PZ.layer.shape.preset) return "shape";
        if (o instanceof PZ.layer.shape) return "path";
        if (o instanceof PZ.layer.scene) return "scene";
        if (o instanceof PZ.layer.adjustment) return "adjustment";
        if (o instanceof PZ.layer.composite) return "composite";
        if (o instanceof PZ.layer.image) return "image";
        return "video";
    }

    const KIND_ICONS = {
        audio: "music",
        text: "text",
        shape: "shape",
        path: "shape",
        scene: "objects",
        adjustment: "fx",
        composite: "layers",
        image: "image",
        video: "camera",
    };

    // ------------------------------------------------------ command layer

    // The tracks command functions are written against a timeline-tracks
    // instance and read this.timeline.sequence / this.timeline.editor /
    // this.sequence. This supplies those so the commands (and the undo
    // entries they push, which are bound to this object) work without the
    // desktop timeline existing. Listeners update through the sequence's
    // onClip*/onTrack* observables.
    function makeTrackOps() {
        let ops = {
            get sequence() {
                return editor.sequence;
            },
            timeline: {
                get sequence() {
                    return editor.sequence;
                },
                get editor() {
                    return editor;
                },
            },
        };
        let proto = PZ.ui.timeline.tracks.prototype;
        for (let name of ["updateSequenceLength", "createClip", "deleteClip", "moveClip", "createTrack", "deleteTrack", "linkClip", "unlinkClip", "cleanUpLink", "linkAfterCreation", "unlinkBeforeDeletion"]) {
            ops[name] = proto[name];
        }
        return ops;
    }

    function makeObjectOps() {
        return {
            get editor() {
                return editor;
            },
            createObject: PZ.ui.edit.prototype.createObject,
            deleteObject: PZ.ui.edit.prototype.deleteObject,
            moveObject: PZ.ui.edit.prototype.moveObject,
        };
    }

    // Runs fn as one undo step. Throwing rolls back whatever fn already did.
    function op(fn) {
        if (!editor.project) return undefined;
        if (editor.history.operation) return fn();
        editor.history.startOperation();
        let result;
        try {
            result = fn();
            trackOps.updateSequenceLength();
        } catch (e) {
            console.error(e);
            editor.history.discardOperation();
            toast(e.message || String(e));
            return undefined;
        }
        editor.history.finishOperation();
        return result;
    }

    function tracksOf(type) {
        return type === 0 ? editor.sequence.videoTracks : editor.sequence.audioTracks;
    }

    function clipType(clip) {
        return clip instanceof PZ.clip.audio ? 1 : 0;
    }

    function locate(clip) {
        if (!editor.sequence) return null;
        for (let type = 0; type < 2; type++) {
            let tracks = tracksOf(type);
            for (let t = 0; t < tracks.length; t++) {
                let i = tracks[t].clips.indexOf(clip);
                if (i !== -1) return { type: type, track: t, index: i };
            }
        }
        return null;
    }

    function rate() {
        return editor.sequence.properties.rate.get();
    }

    // A clip and the clips linked to it (the audio half of an imported
    // video, for instance) move, trim, split and delete together.
    function linkGroup(clip) {
        if (clip.link && clip.link.clips && clip.link.clips.length) return clip.link.clips.slice();
        return [clip];
    }

    function isFree(track, start, length, ignore) {
        for (let c of track.clips) {
            if (ignore && ignore.indexOf(c) !== -1) continue;
            if (c.start < start + length && start < c.start + c.length) return false;
        }
        return true;
    }

    // Clips on a track are kept sorted by start frame.
    function insertionIndex(track, start, skip) {
        let idx = 0;
        for (let c of track.clips) {
            if (c === skip) continue;
            if (c.start > start) break;
            idx++;
        }
        return idx;
    }

    function createTrack(type, idx) {
        trackOps.createTrack({ type: type, newTrackIdx: idx, data: { type: type, clips: [] } });
    }

    // Overlay tracks that end up empty are removed, so the timeline does not
    // fill with blank rows. Track 0 of each kind always stays.
    function pruneEmptyTracks() {
        for (let type = 0; type < 2; type++) {
            let tracks = tracksOf(type);
            for (let t = tracks.length - 1; t >= 1; t--) {
                if (tracks[t].clips.length === 0) trackOps.deleteTrack({ type: type, oldTrackIdx: t });
            }
        }
    }

    // Places clip data (the "track fragments" media items hold: a list of
    // {type, clips}) at a frame. Each fragment track goes onto the first
    // existing track from opts.from[type] upward that has room for all of
    // its clips, or a new one on top. Returns the created clips.
    function insertFragments(fragments, frame, opts) {
        opts = opts || {};
        let from = (opts.from || [0, 0]).slice();
        let minStart = Infinity;
        for (let tr of fragments) for (let c of tr.clips) minStart = Math.min(minStart, c.start || 0);
        if (minStart === Infinity) return [];
        let links = new Map();
        let created = [];
        for (let tr of fragments) {
            if (!tr.clips.length) continue;
            let type = tr.type === 1 ? 1 : 0;
            let tracks = tracksOf(type);
            let spans = tr.clips.map((c) => {
                let data = JSON.parse(JSON.stringify(c));
                if (opts.rescale) data.length = Math.max(1, Math.round((data.length * rate()) / 30));
                data.start = frame + ((c.start || 0) - minStart);
                return data;
            });
            let t = Math.min(from[type], tracks.length);
            while (t < tracks.length && !spans.every((s) => isFree(tracks[t], s.start, s.length))) t++;
            if (t >= tracks.length) {
                createTrack(type, tracks.length);
                t = tracks.length - 1;
            }
            for (let s of spans) {
                let idx = insertionIndex(tracks[t], s.start);
                let args = { type: type, newTrackIdx: t, newIdx: idx, start: s.start, length: s.length, data: s };
                trackOps.createClip(args);
                trackOps.linkAfterCreation(args, links);
                created.push(tracks[t].clips[idx]);
            }
            from[type] = t + 1;
        }
        if (opts.fit) for (let c of created) fitToCanvas(c);
        return created;
    }

    // Panzoid places media at its native pixel size; phone editors fill the
    // frame. Scale imported video and photos to fit inside the canvas.
    function fitToCanvas(clip) {
        let p = clip.object && clip.object.properties;
        if (!p || !p.resolution || !p.scale || p.scale.animated) return;
        let kind = layerKind(clip);
        if (kind !== "video" && kind !== "image") return;
        let [w, h] = p.resolution.get();
        let [W, H] = editor.sequence.properties.resolution.get();
        if (!w || !h) return;
        let k = Math.min(W / w, H / h);
        if (Math.abs(k - 1) < 1e-3) return;
        propOps.setValue({ property: p.scale.getAddress(), frame: 0, value: [k, k] });
    }

    function hasVideoClips() {
        return editor.sequence.videoTracks.some((t) => t.clips.length > 0);
    }

    function addLayer(kind, then) {
        let tpl = LAYERS[kind];
        let f = editor.playback.currentFrame;
        let data = {
            type: 0,
            start: f,
            length: Math.round(rate() * 5),
            offset: 0,
            link: null,
            properties: { name: tpl.name },
            object: JSON.parse(JSON.stringify(tpl.object)),
        };
        let clip = op(() => {
            let c = insertFragments([{ type: 0, clips: [data] }], f, { from: [hasVideoClips() ? 1 : 0, 0] })[0];
            if (then) then(c);
            return c;
        });
        if (clip) select(clip);
        return clip;
    }

    function addEffectTo(layer, item) {
        objectOps.createObject({
            newParentAddress: layer.effects.getAddress(),
            baseType: PZ.effect,
            subType: item.type,
            data: item.data,
        });
    }

    // --------------------------------------------------------- media import

    function assetKeyOf(clipData) {
        if (!clipData) return null;
        let p = clipData.properties || {};
        if (p.media) return p.media;
        let o = clipData.object;
        if (o && o.properties && o.properties.childProperties && o.properties.childProperties.image) return o.properties.childProperties.image;
        return null;
    }

    function clipAssetKey(clip) {
        try {
            let v = clip.properties.media && clip.properties.media.get();
            if (v) return v;
        } catch (e) {}
        try {
            let cp = clip.object && clip.object.properties.childProperties;
            let v = cp && cp.image && cp.image.get();
            if (v) return v;
        } catch (e) {}
        return null;
    }

    function rememberThumb(item) {
        if (!item || !item.thumbnail) return;
        let url = typeof item.thumbnail === "string" ? item.thumbnail : URL.createObjectURL(item.thumbnail);
        item.thumbUrl = url;
        for (let tr of item.data || []) for (let c of tr.clips) {
            let key = assetKeyOf(c);
            if (key && !thumbs.has(key)) thumbs.set(key, url);
        }
    }

    async function importFiles(files) {
        if (!files || !files.length) return;
        busy(true, files.length > 1 ? "Importing " + files.length + " files…" : "Importing…");
        let frame = editor.playback.currentFrame;
        let firstClip = null;
        try {
            for (let file of Array.from(files)) {
                let item = null;
                try {
                    item = await mediaOps.importFile(file);
                } catch (e) {
                    console.error(e);
                }
                if (!item) {
                    toast("Can't open " + file.name);
                    continue;
                }
                rememberThumb(item);
                let isProject = /\.pz$/i.test(file.name);
                let created = op(() => {
                    mediaOps.createMedia({ address: [1, editor.project.media.length], data: item });
                    return insertFragments(item.data, frame, { rescale: !isProject, fit: !isProject, from: [0, 0] });
                });
                if (created && created.length) {
                    firstClip = firstClip || created[0];
                    frame = Math.max(...created.map((c) => c.start + c.length));
                }
            }
        } finally {
            busy(false);
        }
        if (firstClip) select(firstClip);
    }

    function pickFiles(accept) {
        editor.showFilePicker((e) => importFiles(e.currentTarget.files), accept, true);
    }

    // ----------------------------------------------------------- selection

    function selectedClip() {
        return selection.length ? selection[0] : null;
    }

    function select(clip) {
        if (selection.length === 1 && selection[0] === clip) return;
        if (clip) selection.splice(0, selection.length, clip);
        else if (selection.length) selection.splice(0, selection.length);
    }

    // ------------------------------------------------------------- layout

    const ui = {};

    function buildShell() {
        let root = el("div", "", document.body);
        root.id = "pzm";
        ui.root = root;

        // top bar
        let top = el("header", "pzm-top", root);
        top.appendChild(iconButton("menu", "Menu", openMenuSheet));
        let brand = el("div", "pzm-brand", top, "openzoid");
        el("small", "", brand, "mobile");
        ui.canvasChip = el("button", "pzm-chip", top);
        ui.canvasChip.type = "button";
        ui.canvasChip.addEventListener("click", openCanvasSheet);
        let exp = el("button", "pzm-btn primary", top);
        exp.type = "button";
        exp.appendChild(icon("export"));
        exp.appendChild(document.createTextNode("Export"));
        exp.addEventListener("click", openExportSheet);

        // preview
        ui.preview = el("section", "pzm-preview", root);
        ui.previewHint = el("div", "pzm-preview-hint", ui.preview, "Drag to move · pinch to scale · twist to rotate");

        // transport
        let tr = el("div", "pzm-transport", root);
        ui.time = el("div", "pzm-time", tr);
        let mid = el("div", "pzm-transport-mid", tr);
        ui.playBtn = iconButton("play", "Play", togglePlay, "pzm-play");
        mid.appendChild(ui.playBtn);
        let right = el("div", "pzm-transport-right", tr);
        ui.kfBtn = iconButton("keyframe", "Add or remove a keyframe here", toggleTransformKeyframe);
        ui.kfBtn.replaceChild(diamondIcon(), ui.kfBtn.firstChild);
        ui.undoBtn = iconButton("undo", "Undo", () => editor.history.undo());
        ui.redoBtn = iconButton("redo", "Redo", () => editor.history.redo());
        ui.fullBtn = iconButton("zoomin", "Full screen preview", toggleFullPreview);
        for (let b of [ui.kfBtn, ui.undoBtn, ui.redoBtn, ui.fullBtn]) right.appendChild(b);

        // timeline
        buildTimeline(el("section", "pzm-timeline", root));

        // toolbar
        let tb = el("nav", "pzm-toolbar", root);
        ui.toolbar = tb;
        let back = el("button", "pzm-toolbar-back pzm-iconbtn", tb);
        back.type = "button";
        back.title = "Done";
        back.appendChild(icon("back"));
        back.addEventListener("click", () => select(null));
        ui.toolstrip = el("div", "pzm-toolstrip", tb);

        // sheet
        ui.scrim = el("div", "pzm-scrim", root);
        ui.scrim.addEventListener("click", closeSheet);
        ui.sheet = el("div", "pzm-sheet", root);
        let head = el("div", "pzm-sheet-head", ui.sheet);
        ui.sheetTitle = el("div", "pzm-sheet-title", head);
        ui.sheetActions = el("div", "", head);
        ui.sheetActions.style.display = "flex";
        let done = iconButton("check", "Done", closeSheet);
        head.appendChild(done);
        ui.sheetBody = el("div", "pzm-sheet-body", ui.sheet);

        // The engine's file picker lives in the desktop window; give it one.
        editor.fileInput = el("input", "", root);
        editor.fileInput.type = "file";
        editor.fileInput.tabIndex = -1;
        editor.fileInput.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0;";
    }

    // ------------------------------------------------------------ preview

    function buildViewport() {
        viewport = new PZ.ui.viewport(editor, {
            helper3dObjects: new PZ.objectList(),
            widget3dObjects: new PZ.objectList(),
            widget2dObjects: selection,
        });
        ui.preview.insertBefore(viewport.el, ui.previewHint);
        viewport.objects = selection;
        if (!viewport.renderer) return;
        viewport.edit = false;
        viewport.widget2d.el.classList.add("pzm-w2d");
        viewport.widget2d.edit = true;
        viewport.enabled = true;
        bindPreviewGestures();
    }

    function resizeViewport() {
        if (viewport && viewport.renderer && editor.sequence) viewport.resize();
    }

    function togglePlay() {
        let pb = editor.playback;
        if (pb.speed !== 0) {
            pb.speed = 0;
            return;
        }
        if (pb.currentFrame >= pb.totalFrames - 1) pb.currentFrame = 0;
        if (pb.audioCtx && pb.audioCtx.state === "suspended") pb.audioCtx.resume();
        pb.speed = 1;
    }

    function pause() {
        if (editor.playback.speed !== 0) editor.playback.speed = 0;
    }

    function toggleFullPreview() {
        ui.root.classList.toggle("pzm-full");
        requestAnimationFrame(resizeViewport);
    }

    // The clip whose layer the preview gestures move, if there is one under
    // the playhead.
    function transformTarget() {
        if (viewport && viewport.edit && viewport.scene) return null;
        let clip = selectedClip();
        if (!clip || !(clip instanceof PZ.clip.video)) return null;
        let p = clip.object && clip.object.properties;
        if (!p || !p.position || !p.scale || !p.rotation) return null;
        let f = editor.playback.currentFrame;
        if (f < clip.start || f >= clip.start + clip.length) return null;
        return clip;
    }

    let hintTimer = 0;
    function showHint(text) {
        ui.previewHint.textContent = text;
        ui.previewHint.classList.add("show");
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => ui.previewHint.classList.remove("show"), 1800);
    }

    // One finger moves the selected layer, two fingers move/scale/rotate it,
    // a tap plays or pauses. Values are written live, then committed as one
    // undo step on release, like the desktop transform box does.
    function bindPreviewGestures() {
        let area = ui.preview;
        let pointers = new Map();
        let g = null;

        function snapshot() {
            let pts = Array.from(pointers.values());
            if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, dist: 0, angle: 0 };
            let [a, b] = pts;
            return {
                x: (a.x + b.x) / 2,
                y: (a.y + b.y) / 2,
                dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
                angle: Math.atan2(b.y - a.y, b.x - a.x),
            };
        }

        function baseline() {
            if (!g) return;
            g.base = snapshot();
            g.count = pointers.size;
            if (g.clip) {
                g.pos0 = g.props.position.get(g.frame).slice();
                g.scale0 = g.props.scale.get(g.frame).slice();
                g.rot0 = g.props.rotation.get(g.frame);
            }
        }

        function begin() {
            g.moved = true;
            if (!g.clip) return;
            pause();
            editor.history.startOperation();
            g.initial = {
                position: g.props.position.get(g.frame).slice(),
                scale: g.props.scale.get(g.frame).slice(),
                rotation: g.props.rotation.get(g.frame),
            };
            for (let k of ["position", "scale", "rotation"]) propOps.startEdit(g.props[k], g.frame);
            baseline();
        }

        area.addEventListener("pointerdown", (e) => {
            if (viewport && viewport.edit && viewport.scene) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try {
                area.setPointerCapture(e.pointerId);
            } catch (err) {}
            if (!g) {
                let clip = transformTarget();
                g = { moved: false, clip: clip, touched: {} };
                if (clip) {
                    g.props = clip.object.properties;
                    g.frame = editor.playback.currentFrame - g.props.position.frameOffset;
                }
            }
            baseline();
        });

        area.addEventListener("pointermove", (e) => {
            if (!g || !pointers.has(e.pointerId)) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            let s = snapshot();
            if (!g.moved) {
                if (Math.hypot(s.x - g.base.x, s.y - g.base.y) < 6 && (g.count < 2 || Math.abs(s.dist - g.base.dist) < 6)) return;
                begin();
                s = snapshot();
            }
            if (!g.clip) return;
            let ratio = viewport.widget2d.ratio || 1;
            let pos = [g.pos0[0] + (s.x - g.base.x) / ratio, g.pos0[1] - (s.y - g.base.y) / ratio];
            g.props.position.set(pos, g.frame);
            g.touched.position = true;
            if (g.count >= 2 && pointers.size >= 2) {
                let k = s.dist / g.base.dist;
                g.props.scale.set([g.scale0[0] * k, g.scale0[1] * k], g.frame);
                g.props.rotation.set(g.rot0 - (s.angle - g.base.angle), g.frame);
                g.touched.scale = true;
                g.touched.rotation = true;
            }
        });

        function up(e) {
            if (!pointers.has(e.pointerId)) return;
            pointers.delete(e.pointerId);
            if (pointers.size > 0) {
                baseline();
                return;
            }
            let done = g;
            g = null;
            if (!done) return;
            if (!done.moved) {
                if (e.type === "pointerup") togglePlay();
                return;
            }
            if (!done.clip) return;
            for (let k of ["position", "scale", "rotation"]) {
                if (!done.touched[k]) continue;
                propOps.setValue({ property: done.props[k].getAddress(), frame: done.frame, oldValue: done.initial[k] });
            }
            editor.history.finishOperation();
        }
        area.addEventListener("pointerup", up);
        area.addEventListener("pointercancel", up);
    }

    // ----------------------------------------------------------- timeline

    const TL = {
        zoom: 3, // px per frame
        minZoom: 0.05,
        maxZoom: 48,
        rows: [], // {type, track, el}
        clipEls: new Map(),
        expectedScroll: -1,
        lastUserScroll: 0,
        touching: false,
        gesture: null,
        needsBuild: true,
        rulerKey: "",
    };

    function buildTimeline(root) {
        TL.root = root;
        TL.ruler = el("canvas", "pzm-ruler", root);
        TL.scroll = el("div", "pzm-tl-scroll", root);
        TL.content = el("div", "pzm-tl-content", TL.scroll);
        TL.tracks = el("div", "", TL.content);
        TL.tracks.style.position = "relative";
        TL.snapline = el("div", "pzm-snapline", TL.tracks);
        TL.playhead = el("div", "pzm-playhead", root);
        TL.empty = el("div", "pzm-empty", root, "Tap + to add video, photos or text");
        let fab = el("button", "pzm-addfab", root);
        fab.type = "button";
        fab.title = "Add media";
        fab.setAttribute("aria-label", "Add media");
        fab.appendChild(icon("add"));
        fab.addEventListener("click", openAddSheet);

        TL.scroll.addEventListener("scroll", onTimelineScroll, { passive: true });
        TL.scroll.addEventListener("touchstart", onTimelineTouchStart, { passive: true });
        TL.scroll.addEventListener("touchmove", onTimelineTouchMove, { passive: false });
        TL.scroll.addEventListener("touchend", onTimelineTouchEnd, { passive: true });
        TL.scroll.addEventListener("touchcancel", onTimelineTouchEnd, { passive: true });
        TL.scroll.addEventListener("wheel", onTimelineWheel, { passive: false });
        TL.tracks.addEventListener("click", (e) => {
            if (TL.suppressClick) return;
            let clipEl = e.target.closest(".pzm-clip");
            select(clipEl ? clipEl.pz_clip : null);
        });
    }

    function halfWidth() {
        return TL.scroll.clientWidth / 2;
    }

    function totalFrames() {
        return Math.max(1, editor.sequence ? editor.sequence.length : 1);
    }

    function layoutContent(extraFrames) {
        let w = halfWidth();
        TL.content.style.paddingLeft = w + "px";
        TL.content.style.paddingRight = w + "px";
        TL.tracks.style.width = Math.max(1, (totalFrames() + (extraFrames || 0)) * TL.zoom) + "px";
    }

    function scheduleBuild() {
        TL.needsBuild = true;
    }

    // Rebuilds the track rows and clip elements from the sequence. Clip
    // counts are small, so a full rebuild on every committed change keeps
    // this simple and always in step with undo, redo and the AI agent.
    function buildTimelineNow() {
        TL.needsBuild = false;
        if (!editor.sequence) return;
        if (TL.gesture) {
            TL.needsBuild = true;
            return;
        }

        // Drop selected clips that no longer exist (undo, agent deletes...).
        let alive = selection.filter((c) => locate(c));
        if (alive.length !== selection.length) selection.splice(0, selection.length, ...alive);

        for (let r of TL.rows) r.el.remove();
        let sep = TL.tracks.querySelector(".pzm-track-sep");
        if (sep) sep.remove();
        TL.rows = [];
        TL.clipEls.clear();

        let seq = editor.sequence;
        let selected = selectedClip();
        let group = selected ? linkGroup(selected) : [];

        // Higher video tracks draw on top, so they are listed first, with
        // the main track (0) sitting just above the audio tracks.
        for (let t = seq.videoTracks.length - 1; t >= 0; t--) addRow(0, t, group, selected);
        if (seq.audioTracks.some((t) => t.clips.length)) {
            el("div", "pzm-track-sep", TL.tracks);
            for (let t = 0; t < seq.audioTracks.length; t++) addRow(1, t, group, selected);
        }

        TL.empty.style.display = hasVideoClips() || seq.audioTracks.some((t) => t.clips.length) ? "none" : "";
        layoutContent();
        TL.rulerKey = "";
        updateToolbar();
    }

    function addRow(type, t, group, selected) {
        let track = tracksOf(type)[t];
        let row = el("div", "pzm-track" + (type ? " audio" : "") + (type === 0 && t === 0 ? " main" : ""), TL.tracks);
        row.pz_type = type;
        row.pz_track = t;
        TL.rows.push({ type: type, track: t, el: row });
        for (let clip of track.clips) {
            let ce = makeClipEl(clip, clip === selected, group.indexOf(clip) !== -1 && clip !== selected);
            row.appendChild(ce);
        }
    }

    function makeClipEl(clip, isSelected, isLinkedSelected) {
        let kind = layerKind(clip);
        let ce = el("div", "pzm-clip t-" + kind);
        if (isSelected) ce.classList.add("selected");
        if (isLinkedSelected) ce.classList.add("linked-selected");
        ce.pz_clip = clip;
        TL.clipEls.set(clip, ce);

        let key = clipAssetKey(clip);
        if (key && thumbs.has(key) && kind !== "audio") {
            let th = el("div", "pzm-clip-thumbs", ce);
            th.style.backgroundImage = "url(" + thumbs.get(key) + ")";
        }
        let label = el("div", "pzm-clip-label", ce);
        label.appendChild(icon(KIND_ICONS[kind] || "fragment"));
        let name = "";
        try {
            name = clip.properties.name.get();
        } catch (e) {}
        el("span", "", label, name || kind);

        if (isSelected) {
            el("div", "pzm-clip-dur", ce, (clip.length / rate()).toFixed(1) + "s");
            for (let f of transformKeyframeFrames(clip)) {
                let d = el("div", "pzm-kf", ce);
                d.pz_frame = f;
            }
            let l = el("div", "pzm-handle l", ce);
            let r = el("div", "pzm-handle r", ce);
            bindTrimHandle(l, clip, "l");
            bindTrimHandle(r, clip, "r");
        }
        bindClipDrag(ce, clip);
        positionClipEl(ce, clip.start, clip.length);
        return ce;
    }

    function positionClipEl(ce, start, length) {
        ce.style.left = start * TL.zoom + "px";
        ce.style.width = Math.max(2, length * TL.zoom) + "px";
        for (let d of ce.querySelectorAll(".pzm-kf")) d.style.left = d.pz_frame * TL.zoom + "px";
    }

    function relayoutClips() {
        layoutContent();
        for (let [clip, ce] of TL.clipEls) positionClipEl(ce, clip.start, clip.length);
        TL.rulerKey = "";
    }

    function setZoom(z) {
        TL.zoom = clamp(z, TL.minZoom, TL.maxZoom);
        relayoutClips();
        syncScrollToFrame(true);
    }

    // Scrolling the timeline is how you scrub: frame = scrollLeft / zoom.
    function onTimelineScroll() {
        let sl = TL.scroll.scrollLeft;
        if (Math.abs(sl - TL.expectedScroll) < 1) return;
        TL.expectedScroll = -1;
        TL.lastUserScroll = performance.now();
        if (TL.gesture && TL.gesture.kind !== "pinch") {
            TL.gesture.update();
            return;
        }
        pause();
        let f = clamp(Math.round(sl / TL.zoom), 0, totalFrames() - 1);
        if (f !== editor.playback.currentFrame) editor.playback.currentFrame = f;
    }

    function syncScrollToFrame(force) {
        let desired = editor.playback.currentFrame * TL.zoom;
        if (!force) {
            if (TL.touching || TL.gesture) return;
            if (performance.now() - TL.lastUserScroll < 150) return;
        }
        if (Math.abs(TL.scroll.scrollLeft - desired) > 0.5) {
            TL.scroll.scrollLeft = desired;
            TL.expectedScroll = TL.scroll.scrollLeft;
        }
    }

    function onTimelineTouchStart(e) {
        TL.touching = true;
        pause();
        if (e.touches.length === 2 && (!TL.gesture || TL.gesture.kind === "pending")) {
            cancelPendingDrag();
            let [a, b] = e.touches;
            TL.gesture = { kind: "pinch", d0: Math.abs(a.clientX - b.clientX) || 1, z0: TL.zoom, update() {} };
        }
    }

    function onTimelineTouchMove(e) {
        let g = TL.gesture;
        if (!g) return;
        if (g.kind === "pinch" && e.touches.length >= 2) {
            e.preventDefault();
            let [a, b] = e.touches;
            let d = Math.abs(a.clientX - b.clientX) || 1;
            setZoom((g.z0 * d) / g.d0);
            return;
        }
        if (g.kind === "move" || g.kind === "pending") g.touchMove(e);
    }

    function onTimelineTouchEnd(e) {
        if (e.touches.length === 0) {
            TL.touching = false;
            if (TL.gesture && TL.gesture.kind === "pinch") TL.gesture = null;
        }
    }

    // Desktop testing: ctrl/cmd+wheel zooms, plain wheel scrolls sideways.
    function onTimelineWheel(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom(TL.zoom * Math.exp(-e.deltaY * 0.01));
        } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey && TL.scroll.scrollHeight <= TL.scroll.clientHeight + 1) {
            e.preventDefault();
            TL.scroll.scrollLeft += e.deltaY;
        }
    }

    function drawRuler() {
        let c = TL.ruler;
        let w = c.clientWidth;
        let h = c.clientHeight;
        let key = [w, h, TL.scroll.scrollLeft, TL.zoom, totalFrames()].join("|");
        if (key === TL.rulerKey) return;
        TL.rulerKey = key;
        let dpr = window.devicePixelRatio || 1;
        if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
        if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
        let ctx = c.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        let r = rate();
        let steps = [1, 2, 5, 10, r / 2, r, 2 * r, 5 * r, 10 * r, 30 * r, 60 * r, 300 * r, 600 * r].filter((s) => s >= 1 && Number.isInteger(s));
        let step = steps.find((s) => s * TL.zoom >= 64) || steps[steps.length - 1];
        let minor = step >= r ? step / (step % 5 === 0 ? 5 : 2) : step / (step % 5 === 0 ? 5 : step % 2 === 0 ? 2 : 1);
        let x0 = halfWidth() - TL.scroll.scrollLeft;
        let fStart = Math.max(0, Math.floor(-x0 / TL.zoom / minor) * minor);
        let fEnd = Math.min(totalFrames(), Math.ceil((w - x0) / TL.zoom));
        ctx.font = "10px 'Source Code Pro', monospace";
        ctx.textBaseline = "top";
        for (let f = fStart; f <= fEnd; f += minor) {
            let x = Math.round(x0 + f * TL.zoom) + 0.5;
            let major = Math.abs(f / step - Math.round(f / step)) < 1e-6;
            ctx.fillStyle = major ? "#777" : "#444";
            ctx.fillRect(x, major ? h - 8 : h - 4, 1, major ? 8 : 4);
            if (major) {
                ctx.fillStyle = "#8a8a8a";
                let label = f % r === 0 ? formatTime(f, r).slice(0, 5) : (f % r) + "f";
                ctx.fillText(label, x + 3, 3);
            }
        }
        // End of the sequence.
        let xe = x0 + totalFrames() * TL.zoom;
        if (xe < w) {
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(xe, 0, w - xe, h);
        }
    }

    // Frame under a screen x, measured against the track area so it stays
    // right while the timeline auto-scrolls during a drag.
    function frameAt(clientX) {
        let r = TL.tracks.getBoundingClientRect();
        return (clientX - r.left) / TL.zoom;
    }

    function snapCandidates(ignore) {
        let out = [0, editor.playback.currentFrame];
        for (let type = 0; type < 2; type++) {
            for (let tr of tracksOf(type)) for (let c of tr.clips) {
                if (ignore.indexOf(c) !== -1) continue;
                out.push(c.start, c.start + c.length);
            }
        }
        return out;
    }

    function snapFrame(f, candidates) {
        let best = null;
        let bestD = 10 / TL.zoom; // 10px
        for (let c of candidates) {
            let d = Math.abs(c - f);
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        return best;
    }

    function showSnap(frame) {
        if (frame === null || frame === undefined) {
            TL.snapline.style.display = "none";
            return;
        }
        TL.snapline.style.display = "block";
        TL.snapline.style.left = frame * TL.zoom + "px";
    }

    // Auto-scroll while dragging near either edge of the timeline. Only
    // once the finger has travelled towards that edge, so a drag that merely
    // starts near the edge does not run away.
    function edgeScroll(clientX, g) {
        if (!g.armed) {
            if (Math.abs(clientX - g.x0) < 24) return 0;
            g.armed = true;
        }
        let r = TL.scroll.getBoundingClientRect();
        let edge = 36;
        let v = 0;
        if (clientX < r.left + edge && clientX < g.x0) v = -Math.ceil((r.left + edge - clientX) / 6);
        else if (clientX > r.right - edge && clientX > g.x0) v = Math.ceil((clientX - (r.right - edge)) / 6);
        if (v) TL.scroll.scrollLeft += v;
        return v;
    }

    // ---- trimming: drag the white handles on the selected clip

    function bindTrimHandle(h, clip, side) {
        h.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
        h.addEventListener("click", (e) => e.stopPropagation());
        h.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (TL.gesture) return;
            pause();
            try {
                h.setPointerCapture(e.pointerId);
            } catch (err) {}
            startTrim(clip, side, e.clientX, h, e.pointerId);
        });
    }

    function trimLimits(group, side) {
        let r = rate();
        let lo = -Infinity;
        let hi = Infinity;
        for (let c of group) {
            let loc = locate(c);
            if (!loc) continue;
            let clips = tracksOf(loc.type)[loc.track].clips;
            let prev = clips[loc.index - 1];
            let next = clips[loc.index + 1];
            let time = c.properties.time;
            let adjust = !time.animated;
            let hasMedia = !!c.media;
            if (side === "l") {
                lo = Math.max(lo, -(c.start - (prev ? prev.start + prev.length : 0)));
                if (adjust && hasMedia) lo = Math.max(lo, -Math.floor(time.keyframes[0].value * r + 1e-6));
                hi = Math.min(hi, c.length - 1);
            } else {
                if (next) hi = Math.min(hi, next.start - (c.start + c.length));
                if (adjust && hasMedia && isFinite(c.mediaLength)) hi = Math.min(hi, Math.floor(c.mediaLength - time.keyframes[1].value * r + 1e-6));
                lo = Math.max(lo, -(c.length - 1));
            }
        }
        return { lo: Math.min(lo, 0), hi: Math.max(hi, 0) };
    }

    function startTrim(clip, side, clientX, handleEl, pointerId) {
        let group = linkGroup(clip);
        let lim = trimLimits(group, side);
        let snaps = snapCandidates(group);
        let g = {
            kind: "trim",
            clip: clip,
            group: group,
            side: side,
            lim: lim,
            f0: frameAt(clientX),
            x: clientX,
            x0: clientX,
            n: 0,
            update() {
                edgeScroll(g.x, g);
                let n = Math.round(frameAt(g.x) - g.f0);
                let edge = side === "l" ? clip.start + n : clip.start + clip.length + n;
                let s = snapFrame(edge, snaps);
                if (s !== null) n = s - (side === "l" ? clip.start : clip.start + clip.length);
                n = clamp(n, lim.lo, lim.hi);
                g.n = n;
                showSnap(s !== null && clamp(n, lim.lo, lim.hi) === n ? s : null);
                // Let the sequence grow under the finger when extending.
                let end = Math.max(...group.map((c) => c.start + c.length + (side === "r" ? n : 0)));
                if (end > totalFrames()) layoutContent(end - totalFrames());
                for (let c of group) {
                    let ce = TL.clipEls.get(c);
                    if (!ce) continue;
                    if (side === "l") positionClipEl(ce, c.start + n, c.length - n);
                    else positionClipEl(ce, c.start, c.length + n);
                }
                let dur = TL.clipEls.get(clip) && TL.clipEls.get(clip).querySelector(".pzm-clip-dur");
                if (dur) dur.textContent = ((clip.length + (side === "l" ? -n : n)) / rate()).toFixed(1) + "s";
            },
        };
        TL.gesture = g;
        let tick = () => {
            if (TL.gesture !== g) return;
            g.update();
            g.raf = requestAnimationFrame(tick);
        };
        g.raf = requestAnimationFrame(tick);

        let move = (e) => {
            if (e.pointerId === pointerId) g.x = e.clientX;
        };
        let end = (e) => {
            if (e.pointerId !== pointerId) return;
            handleEl.removeEventListener("pointermove", move);
            handleEl.removeEventListener("pointerup", end);
            handleEl.removeEventListener("pointercancel", end);
            cancelAnimationFrame(g.raf);
            TL.gesture = null;
            showSnap(null);
            commitTrim(g, e.type === "pointercancel");
        };
        handleEl.addEventListener("pointermove", move);
        handleEl.addEventListener("pointerup", end);
        handleEl.addEventListener("pointercancel", end);
    }

    function commitTrim(g, cancelled) {
        let n = g.n;
        if (!cancelled && n !== 0) {
            op(() => {
                let r = rate();
                for (let c of g.group) {
                    let loc = locate(c);
                    if (!loc) continue;
                    let time = c.properties.time;
                    let adjust = !time.animated;
                    let args = { type: loc.type, oldTrackIdx: loc.track, oldIdx: loc.index };
                    if (g.side === "l") {
                        args.start = c.start + n;
                        args.length = c.length - n;
                        if (adjust) {
                            args.offset = -n;
                            args.timeStart = time.keyframes[0].value + n / r;
                        }
                    } else {
                        args.length = c.length + n;
                        if (adjust) args.timeEnd = time.keyframes[1].value + n / r;
                    }
                    trackOps.moveClip(args);
                }
            });
        }
        scheduleBuild();
    }

    // ---- moving: long-press a clip, then drag it in time or between tracks

    function cancelPendingDrag() {
        let g = TL.gesture;
        if (g && g.kind === "pending") {
            clearTimeout(g.timer);
            TL.gesture = null;
        }
    }

    function bindClipDrag(ce, clip) {
        ce.addEventListener("touchstart", (e) => {
            if (e.touches.length !== 1 || TL.gesture) return;
            let t = e.touches[0];
            let g = {
                kind: "pending",
                x: t.clientX,
                y: t.clientY,
                touchMove(ev) {
                    let p = ev.touches[0];
                    if (Math.hypot(p.clientX - g.x, p.clientY - g.y) > 10) cancelPendingDrag();
                },
                update() {},
            };
            g.timer = setTimeout(() => {
                if (TL.gesture !== g) return;
                vibrate(12);
                startMove(clip, g.x, g.y, "touch");
            }, 380);
            TL.gesture = g;
        }, { passive: true });
        ce.addEventListener("touchend", cancelPendingDrag, { passive: true });
        ce.addEventListener("touchcancel", cancelPendingDrag, { passive: true });

        // Mouse: drag straight away once it moves a few pixels.
        ce.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || TL.gesture) return;
            let x0 = e.clientX;
            let y0 = e.clientY;
            let mm = (ev) => {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) {
                    cleanup();
                    startMove(clip, x0, y0, "mouse", ev);
                }
            };
            let cleanup = () => {
                document.removeEventListener("mousemove", mm);
                document.removeEventListener("mouseup", cleanup);
            };
            document.addEventListener("mousemove", mm);
            document.addEventListener("mouseup", cleanup);
        });
    }

    function rowAt(clientY, type) {
        let rows = TL.rows.filter((r) => r.type === type);
        let best = null;
        let bestD = Infinity;
        for (let r of rows) {
            let rect = r.el.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) return { row: r, above: false };
            let d = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
            if (d < bestD) {
                bestD = d;
                best = r;
            }
        }
        // Dragging above the top video row asks for a new layer on top.
        if (type === 0 && rows.length) {
            let topRect = rows[0].el.getBoundingClientRect();
            if (clientY < topRect.top - 4) return { row: null, above: true };
        }
        return { row: best, above: false };
    }

    function startMove(clip, x, y, source, firstEvent) {
        cancelPendingDrag();
        if (selectedClip() !== clip) {
            select(clip);
            buildTimelineNow();
        }
        let ce = TL.clipEls.get(clip);
        let loc = locate(clip);
        if (!ce || !loc) return;
        pause();
        let group = linkGroup(clip);
        let others = group.filter((c) => c !== clip);
        let snaps = snapCandidates(group);
        let minStart = Math.min(...group.map((c) => c.start));
        ce.classList.add("dragging");
        let g = {
            kind: "move",
            clip: clip,
            group: group,
            f0: frameAt(x),
            x: x,
            x0: x,
            y: y,
            delta: 0,
            target: { row: TL.rows.find((r) => r.type === loc.type && r.track === loc.track), above: false },
            blocked: false,
            touchMove(ev) {
                ev.preventDefault();
                let p = ev.touches[0];
                g.x = p.clientX;
                g.y = p.clientY;
            },
            update() {
                edgeScroll(g.x, g);
                let d = Math.round(frameAt(g.x) - g.f0);
                d = Math.max(d, -minStart);
                let snapped = null;
                let s = snapFrame(clip.start + d, snaps);
                if (s !== null) {
                    d = s - clip.start;
                    snapped = s;
                } else {
                    let s2 = snapFrame(clip.start + clip.length + d, snaps);
                    if (s2 !== null) {
                        d = s2 - clip.start - clip.length;
                        snapped = s2;
                    }
                }
                d = Math.max(d, -minStart);
                g.delta = d;
                showSnap(snapped);
                let end = Math.max(...group.map((c) => c.start + c.length + d));
                if (end > totalFrames()) layoutContent(end - totalFrames());

                let tgt = rowAt(g.y, loc.type);
                g.target = tgt;
                if (tgt.row && ce.parentElement !== tgt.row.el) tgt.row.el.appendChild(ce);
                positionClipEl(ce, clip.start + d, clip.length);
                ce.style.transform = tgt.above ? "translateY(-28px)" : "";

                let blocked = false;
                if (tgt.row) blocked = !isFree(tracksOf(loc.type)[tgt.row.track], clip.start + d, clip.length, group);
                for (let o of others) {
                    let ol = locate(o);
                    let oe = TL.clipEls.get(o);
                    if (oe) positionClipEl(oe, o.start + d, o.length);
                    if (ol && !isFree(tracksOf(ol.type)[ol.track], o.start + d, o.length, group)) g.othersBlocked = true;
                    else if (ol) g.othersBlocked = false;
                }
                g.blocked = blocked;
                ce.classList.toggle("blocked", blocked || !!g.othersBlocked);
            },
        };
        TL.gesture = g;
        TL.suppressClick = true;
        let tick = () => {
            if (TL.gesture !== g) return;
            g.update();
            g.raf = requestAnimationFrame(tick);
        };
        g.raf = requestAnimationFrame(tick);

        let finish = (cancelled) => {
            cancelAnimationFrame(g.raf);
            TL.gesture = null;
            showSnap(null);
            ce.classList.remove("dragging", "blocked");
            ce.style.transform = "";
            setTimeout(() => (TL.suppressClick = false), 50);
            if (!cancelled) commitMove(g, loc.type);
            scheduleBuild();
        };

        if (source === "touch") {
            let end = (ev) => {
                if (ev.touches.length) return;
                document.removeEventListener("touchend", end);
                document.removeEventListener("touchcancel", end);
                finish(ev.type === "touchcancel");
            };
            document.addEventListener("touchend", end);
            document.addEventListener("touchcancel", end);
        } else {
            let mm = (ev) => {
                g.x = ev.clientX;
                g.y = ev.clientY;
            };
            let mu = () => {
                document.removeEventListener("mousemove", mm);
                document.removeEventListener("mouseup", mu);
                finish(false);
            };
            document.addEventListener("mousemove", mm);
            document.addEventListener("mouseup", mu);
            if (firstEvent) mm(firstEvent);
        }
    }

    function commitMove(g, type) {
        let clip = g.clip;
        let d = g.delta;
        let orig = locate(clip);
        if (!orig) return;
        let targetTrack = g.target.above ? -1 : g.target.row ? g.target.row.track : orig.track;
        if (d === 0 && targetTrack === orig.track) return;
        if (g.othersBlocked) {
            toast("The linked clip has no room there");
            return;
        }
        op(() => {
            let tracks = tracksOf(type);
            let newStart = clip.start + d;
            // No room on the target track: make a new layer just above it.
            if (targetTrack === -1 || (g.blocked && targetTrack !== -1)) {
                let at = targetTrack === -1 ? tracks.length : targetTrack + 1;
                createTrack(type, at);
                targetTrack = at;
            }
            for (let o of g.group) {
                if (o === clip) continue;
                let ol = locate(o);
                let otrack = tracksOf(ol.type)[ol.track];
                trackOps.moveClip({ type: ol.type, oldTrackIdx: ol.track, oldIdx: ol.index, newTrackIdx: ol.track, newIdx: insertionIndex(otrack, o.start + d, o), start: o.start + d });
            }
            let loc = locate(clip);
            trackOps.moveClip({
                type: type,
                oldTrackIdx: loc.track,
                oldIdx: loc.index,
                newTrackIdx: targetTrack,
                newIdx: insertionIndex(tracks[targetTrack], newStart, clip),
                start: newStart,
            });
            pruneEmptyTracks();
        });
    }

    // ------------------------------------------------------ clip actions

    function splitAtPlayhead() {
        let clip = selectedClip();
        if (!clip) return;
        let f = editor.playback.currentFrame;
        let group = linkGroup(clip).filter((c) => f > c.start && f < c.start + c.length);
        if (!group.length) {
            toast("Move the playhead over the clip to split it");
            return;
        }
        op(() => {
            let links = new Map();
            for (let c of group) {
                let loc = locate(c);
                let l = f - c.start;
                let left = { type: loc.type, oldTrackIdx: loc.track, oldIdx: loc.index, length: l };
                let right = {
                    type: loc.type,
                    oldTrackIdx: loc.track,
                    newTrackIdx: loc.track,
                    newIdx: loc.index + 1,
                    oldIdx: loc.index + 1,
                    start: c.start + l,
                    length: c.length - l,
                    offset: -l,
                    data: c,
                };
                if (!c.properties.time.animated) {
                    let t = c.properties.time.get(l);
                    left.timeEnd = t;
                    right.timeStart = t;
                }
                trackOps.createClip(right);
                trackOps.moveClip(right);
                trackOps.moveClip(left);
                trackOps.linkAfterCreation(right, links);
            }
        });
    }

    function deleteSelected() {
        let clip = selectedClip();
        if (!clip) return;
        let group = linkGroup(clip);
        select(null);
        op(() => {
            for (let c of group) {
                let loc = locate(c);
                if (!loc) continue;
                let args = { type: loc.type, oldTrackIdx: loc.track, oldIdx: loc.index };
                trackOps.unlinkBeforeDeletion(args);
                trackOps.deleteClip(args);
            }
            pruneEmptyTracks();
        });
    }

    function duplicateSelected() {
        let clip = selectedClip();
        if (!clip) return;
        let group = linkGroup(clip);
        let end = Math.max(...group.map((c) => c.start + c.length));
        let from = [0, 0];
        let frags = group.map((c) => {
            let loc = locate(c);
            from[loc.type] = loc.track;
            let data = JSON.parse(JSON.stringify(c));
            data.link = group.length > 1 ? 0 : null;
            data.start = c.start;
            return { type: loc.type, clips: [data] };
        });
        let created = op(() => insertFragments(frags, end, { from: from }));
        if (created && created.length) {
            let main = created[group.indexOf(clip)] || created[0];
            select(main);
            editor.playback.currentFrame = main.start;
        }
    }

    // Speed is how much media time a clip plays per second of timeline. It
    // is changed the way the desktop's ctrl-drag does it: scale the clip's
    // length and its keyframes, keep the media in/out points.
    function clipSpeed(c) {
        let time = c.properties.time;
        if (time.animated || !c.media) return null;
        let span = time.keyframes[1].value - time.keyframes[0].value;
        return (span * rate()) / c.length;
    }

    function setSpeed(clip, speed) {
        let group = linkGroup(clip).filter((c) => clipSpeed(c) !== null);
        if (!group.length) return;
        op(() => {
            for (let c of group) {
                let time = c.properties.time;
                let span = time.keyframes[1].value - time.keyframes[0].value;
                let newLen = Math.max(1, Math.round((span * rate()) / speed));
                if (newLen === c.length) continue;
                let grow = newLen - c.length;
                let loc = locate(c);
                let track = tracksOf(loc.type)[loc.track];
                // Push later clips on the same track along instead of
                // overlapping them.
                let next = track.clips[loc.index + 1];
                if (grow > 0 && next && next.start < c.start + newLen) {
                    let shift = c.start + newLen - next.start;
                    for (let i = track.clips.length - 1; i > loc.index; i--) {
                        trackOps.moveClip({ type: loc.type, oldTrackIdx: loc.track, oldIdx: i, start: track.clips[i].start + shift });
                    }
                }
                trackOps.moveClip({ type: loc.type, oldTrackIdx: loc.track, oldIdx: loc.index, length: newLen, scale: newLen / c.length });
            }
        });
    }

    // The four layer transform properties the keyframe button acts on.
    function transformProps(clip) {
        let p = clip && clip.object && clip.object.properties;
        if (!p || !p.position) return [];
        return [p.position, p.scale, p.rotation, p.opacity].filter(Boolean);
    }

    function keyframeFrames(prop) {
        let out = [];
        if (prop.objects) {
            for (let o of prop.objects) out.push(...keyframeFrames(o));
        } else if (prop.animated && prop.keyframes) {
            for (let k of prop.keyframes) out.push(k.frame);
        }
        return out;
    }

    function transformKeyframeFrames(clip) {
        let set = new Set();
        for (let p of transformProps(clip)) for (let f of keyframeFrames(p)) set.add(f);
        return Array.from(set).filter((f) => f >= 0 && f <= clip.length);
    }

    function keyframeState() {
        let clip = selectedClip();
        let props = transformProps(clip);
        if (!props.length) return null;
        let f = editor.playback.currentFrame - clip.start;
        if (f < 0 || f >= clip.length) return null;
        let all = props.every((p) => p.animated && p.hasKeyframe(f));
        return { clip: clip, props: props, frame: f, has: all };
    }

    function toggleTransformKeyframe() {
        let st = keyframeState();
        if (!st) {
            toast("Select a clip and put the playhead on it");
            return;
        }
        op(() => {
            for (let p of st.props) {
                if (st.has) {
                    if (keyframeFrames(p).length <= 1) propOps.toggleAnimation(p, st.frame, false, false);
                    else propOps.toggleKeyframe(p, st.frame, false);
                } else if (!p.animated) {
                    propOps.toggleAnimation(p, st.frame, false, true);
                } else if (!p.hasKeyframe(st.frame)) {
                    propOps.toggleKeyframe(p, st.frame, true);
                }
            }
        });
        if (!st.has) showHint("Keyframe added — move the playhead, then drag the layer");
    }

    // ------------------------------------------------------------ toolbar

    function tool(iconName, label, fn, opts) {
        let b = el("button", "pzm-tool");
        b.type = "button";
        b.appendChild(icon(iconName));
        el("span", "", b, label);
        b.addEventListener("click", fn);
        if (opts && opts.disabled) b.disabled = true;
        return b;
    }

    let toolbarKey = "";
    function updateToolbar() {
        let clip = selectedClip();
        let key = clip ? "clip:" + layerKind(clip) + ":" + !!clip.link + ":" + (clipSpeed(clip) !== null) : "root";
        if (key === toolbarKey) return;
        toolbarKey = key;
        let strip = ui.toolstrip;
        strip.innerHTML = "";
        strip.scrollLeft = 0;
        ui.toolbar.classList.toggle("clip-mode", !!clip);
        if (!clip) {
            strip.appendChild(tool("addmedia", "Import", () => pickFiles("video/*,audio/*,image/*,.pz")));
            strip.appendChild(tool("project", "Library", openLibrarySheet));
            strip.appendChild(tool("text", "Text", () => addLayer("text", null) && openTextSheet(true)));
            strip.appendChild(tool("shape", "Shapes", openShapesSheet));
            strip.appendChild(tool("fx", "Effects", () => openEffectCatalog(null)));
            strip.appendChild(tool("objects", "3D", () => addLayer("scene", null) && openObjectsSheet()));
            strip.appendChild(tool("music", "Audio", () => pickFiles("audio/*")));
            strip.appendChild(tool("layers", "Composite", () => addLayer("composite", null)));
            strip.appendChild(tool("sequence", "Canvas", openCanvasSheet));
            if (PZ.ui.agent) strip.appendChild(tool("inspired", "AI", openAgentSheet));
            return;
        }
        let kind = layerKind(clip);
        let isAudio = kind === "audio";
        let group = linkGroup(clip);
        let audioClip = group.find((c) => c instanceof PZ.clip.audio);
        strip.appendChild(tool("edit2", "Edit", () => openEditSheet()));
        strip.appendChild(tool("split", "Split", splitAtPlayhead));
        if (clipSpeed(clip) !== null) strip.appendChild(tool("slow", "Speed", openSpeedSheet));
        if (audioClip) strip.appendChild(tool("audio", "Volume", () => openVolumeSheet(audioClip)));
        if (!isAudio) {
            strip.appendChild(tool("fx", "Effects", openEffectsSheet));
            if (kind === "text") strip.appendChild(tool("text", "Text", () => openTextSheet(false)));
            else if (kind === "scene") strip.appendChild(tool("objects", "Objects", openObjectsSheet));
            strip.appendChild(tool("visible", "Opacity", openOpacitySheet));
            let kf = tool("keyframe", "Keyframe", toggleTransformKeyframe);
            kf.replaceChild(diamondIcon(), kf.firstChild);
            strip.appendChild(kf);
        }
        strip.appendChild(tool("duplicate", "Duplicate", duplicateSelected));
        strip.appendChild(tool("delete", "Delete", deleteSelected));
    }

    // ------------------------------------------------------------- sheets

    let sheet = null;

    // opts: {title, tall, build(body, actions), close()}
    function openSheet(opts) {
        closeSheet();
        sheet = opts;
        ui.sheetTitle.textContent = opts.title || "";
        ui.sheetActions.innerHTML = "";
        ui.sheetBody.innerHTML = "";
        ui.sheetBody.className = "pzm-sheet-body";
        ui.sheetBody.scrollTop = 0;
        positionSheet();
        opts.build(ui.sheetBody, ui.sheetActions);
        ui.sheet.classList.add("open");
        ui.scrim.classList.add("show");
    }

    function positionSheet() {
        if (!sheet) return;
        let rootRect = ui.root.getBoundingClientRect();
        let anchor = sheet.tall ? ui.root.querySelector(".pzm-top") : ui.root.querySelector(".pzm-transport");
        let a = anchor.getBoundingClientRect();
        // Landscape puts the transport beside the preview; anchor to the top.
        if (!sheet.tall && a.left > rootRect.left + 10) a = ui.root.querySelector(".pzm-top").getBoundingClientRect();
        let top = a.bottom - rootRect.top;
        ui.sheet.style.top = top + "px";
        ui.scrim.style.top = top + "px";
    }

    function closeSheet() {
        if (!sheet) return;
        let s = sheet;
        sheet = null;
        ui.sheet.classList.remove("open");
        ui.scrim.classList.remove("show");
        if (s.close) s.close();
    }

    // Embeds a PZ.ui panel (desktop property editor, export, AI chat).
    function hostPanel(parent, panel) {
        let host = el("div", "pzm-panelhost", parent);
        host.appendChild(panel.el);
        panel.enabled = true;
        requestAnimationFrame(() => {
            try {
                panel.resize();
            } catch (e) {}
        });
        return () => {
            panel.enabled = false;
            panel.el.remove();
        };
    }

    const panels = {};
    function panel(name, make) {
        if (!panels[name]) panels[name] = make();
        return panels[name];
    }

    function openEditSheet(title) {
        let p = panel("edit", () => {
            let e = new PZ.ui.edit(editor, {
                childFilter: (o) => o instanceof PZ.propertyList || o instanceof PZ.object || (o instanceof PZ.objectList && o.type === PZ.property.dynamic),
                emptyMessage: "select a clip",
                showListItemButtons: false,
                columnLayout: 1,
                // The layer (or audio object) rather than the clip wrapper,
                // whose media/time rows are rarely what you want on a phone.
                objectFilter: (c) => !!c.object,
                objectMap: (c) => c.object,
            });
            e.objects = selection;
            return e;
        });
        let release;
        openSheet({
            title: title || "Edit",
            build(body) {
                body.classList.add("host");
                release = hostPanel(body, p);
            },
            close() {
                release();
            },
        });
    }

    // Text gets a real text box on top (the keyboard comes straight up, as in
    // phone editors) with the full property editor underneath.
    function openTextSheet(focus) {
        let clip = selectedClip();
        let cp = clip && clip.object && clip.object.properties.childProperties;
        if (!cp || !cp.text) {
            openEditSheet("Text");
            return;
        }
        openEditSheet("Text");
        let body = ui.sheetBody;
        let col = el("div", "pzm-col");
        body.insertBefore(col, body.firstChild);
        let host = body.querySelector(".pzm-panelhost");
        let box = el("div", "pzm-textbox", col);
        let ta = el("textarea", "pzm-textinput", box);
        ta.rows = 2;
        ta.placeholder = "Enter text";
        ta.setAttribute("autocapitalize", "sentences");
        let prop = cp.text;
        let frame = () => editor.playback.currentFrame - clip.start;
        let f0 = frame();
        let v0 = prop.get(f0);
        ta.value = v0;
        ta.addEventListener("input", () => prop.set(ta.value, f0));
        let commit = () => {
            if (ta.value === v0) return;
            op(() => propOps.setValue({ property: prop.getAddress(), frame: f0, value: ta.value, oldValue: v0 }));
            v0 = ta.value;
        };
        ta.addEventListener("change", commit);
        ta.addEventListener("blur", commit);
        col.appendChild(host);
        let prevClose = sheet.close;
        sheet.close = () => {
            commit();
            prevClose();
        };
        if (focus) {
            setTimeout(() => {
                ta.focus();
                ta.select();
            }, 250);
        }
    }

    // Objects (3D objects, text and shape parts) and Effects both use the
    // desktop's two-part arrangement: the list on top, the selected item's
    // properties underneath.
    function openSplitSheet(name, title, listType, key, actions) {
        let pair = panel(name, () => {
            let top = new PZ.ui.edit(editor, {
                childFilter: (o) => o instanceof PZ.objectList && o.type === listType,
                columnLayout: 1,
                showListItemButtons: true,
                emptyMessage: "select a clip",
                objectFilter: (o) => !!o.object && !!o.object[key],
                objectMap: (o) => o.object[key],
            });
            let bottom = new PZ.ui.edit(editor, {
                childFilter: (o) => !(o instanceof PZ.objectList) || o.type !== listType,
                columnLayout: 1,
            });
            top.objects = selection;
            bottom.objects = top.selection;
            return { top: top, bottom: bottom };
        });
        let releases = [];
        let clip = selectedClip();
        let list = clip && clip.object && clip.object[key];
        let current = pair.top.selection[0];
        if (list && list.length && (!current || list.indexOf(current) === -1)) pair.top.selection.splice(0, pair.top.selection.length, list[list.length - 1]);
        openSheet({
            title: title,
            build(body, head) {
                body.classList.add("host");
                let split = el("div", "pzm-split", body);
                releases.push(hostPanel(split, pair.top));
                releases.push(hostPanel(split, pair.bottom));
                if (actions) actions(head);
            },
            close() {
                releases.forEach((r) => r());
            },
        });
    }

    function openObjectsSheet() {
        let clip = selectedClip();
        let isScene = clip && clip.object instanceof PZ.layer.scene;
        openSplitSheet("objects", "Objects", PZ.object3d, "objects", (head) => {
            if (!isScene || !viewport.renderer) return;
            let cam = iconButton("camera", "Editing camera", () => {
                viewport.edit = !viewport.edit;
                cam.classList.toggle("on", viewport.edit);
                showHint(viewport.edit ? "Editing camera: drag to orbit, pinch to zoom" : "Showing the final render");
            });
            cam.classList.toggle("on", viewport.edit);
            head.appendChild(cam);
        });
    }

    function openEffectsSheet() {
        openSplitSheet("effects", "Effects", PZ.effect, "effects", (head) => {
            let add = el("button", "pzm-btn", head);
            add.type = "button";
            add.appendChild(icon("add"));
            add.appendChild(document.createTextNode("Add"));
            add.style.marginRight = "6px";
            add.addEventListener("click", () => openEffectCatalog(selectedClip()));
        });
    }

    function catalogItems(baseType) {
        let out = [];
        let category = "";
        for (let item of PZ.ui.objectTypes.get(baseType) || []) {
            if (item.category) {
                category = item.name;
                continue;
            }
            if (item.list && !item.hidelist) {
                for (let sub of item.list) out.push({ name: item.name + " · " + sub.name, desc: item.desc, type: sub.type, data: sub.data, category: category });
                continue;
            }
            out.push({ name: item.name, desc: item.desc, type: item.type, data: item.data, category: category });
        }
        return out;
    }

    // Effect browser. With a clip it adds to that clip; without one it adds
    // an adjustment layer at the playhead carrying the effect, which is how
    // phone editors treat "effects" on the timeline.
    function openEffectCatalog(clip) {
        let items = catalogItems(PZ.effect);
        openSheet({
            title: clip ? "Add effect" : "Effects",
            tall: true,
            build(body) {
                let search = el("input", "pzm-search", body);
                search.type = "search";
                search.placeholder = "Search effects";
                let list = el("ul", "pzm-list", body);
                let render = () => {
                    let q = search.value.trim().toLowerCase();
                    list.innerHTML = "";
                    let lastCat = null;
                    for (let it of items) {
                        if (q && (it.name + " " + (it.desc || "")).toLowerCase().indexOf(q) === -1) continue;
                        if (it.category !== lastCat) {
                            lastCat = it.category;
                            let h = el("li", "pzm-section", list, it.category);
                            h.style.cssText = "min-height:0;border:0;cursor:default;";
                        }
                        let li = el("li", "", list, it.name);
                        if (it.desc) el("small", "", li, it.desc);
                        li.addEventListener("click", () => chooseEffect(clip, it));
                    }
                };
                search.addEventListener("input", render);
                render();
            },
        });
    }

    async function chooseEffect(clip, item) {
        let data = item.data;
        if (typeof data === "function") {
            try {
                data = await data.call(objectOps);
            } catch (e) {
                toast("Couldn't add " + item.name);
                return;
            }
        }
        let it = { type: item.type, data: data };
        if (clip && clip.object && clip.object.effects) {
            op(() => addEffectTo(clip.object, it));
            openEffectsSheet();
            return;
        }
        let c = addLayer("adjustment", (newClip) => {
            newClip.properties.name.set(item.name);
            addEffectTo(newClip.object, it);
        });
        if (c) openEffectsSheet();
    }

    function openShapesSheet() {
        openSheet({
            title: "Shapes",
            build(body) {
                let grid = el("div", "pzm-grid", body);
                let add = (ico, name, fn) => {
                    let t = el("button", "pzm-tile", grid);
                    t.type = "button";
                    t.appendChild(icon(ico));
                    el("span", "pzm-tile-name", t, name);
                    t.addEventListener("click", fn);
                };
                add("shape", "Preset shape", () => {
                    closeSheet();
                    if (addLayer("shape", null)) openEditSheet("Shape");
                });
                add("edit", "Drawn shape", () => {
                    closeSheet();
                    if (addLayer("path", null)) openEditSheet("Shape");
                });
                add("objects", "3D scene", () => {
                    closeSheet();
                    if (addLayer("scene", null)) openObjectsSheet();
                });
                add("layers", "Composite", () => {
                    closeSheet();
                    addLayer("composite", null);
                });
                add("fx", "Adjustment", () => {
                    closeSheet();
                    if (addLayer("adjustment", null)) openEffectsSheet();
                });
            },
        });
    }

    function openAddSheet() {
        openSheet({
            title: "Add",
            build(body) {
                let grid = el("div", "pzm-grid", body);
                let add = (ico, name, fn) => {
                    let t = el("button", "pzm-tile", grid);
                    t.type = "button";
                    t.appendChild(icon(ico));
                    el("span", "pzm-tile-name", t, name);
                    t.addEventListener("click", () => {
                        closeSheet();
                        fn();
                    });
                };
                add("addmedia", "Video / photo", () => pickFiles("video/*,image/*"));
                add("music", "Audio", () => pickFiles("audio/*"));
                add("text", "Text", () => addLayer("text", null) && openTextSheet(true));
                add("shape", "Shape", () => addLayer("shape", null) && openEditSheet("Shape"));
                add("objects", "3D scene", () => addLayer("scene", null) && openObjectsSheet());
                add("fx", "Effect", () => openEffectCatalog(null));
                add("project", "Library", openLibrarySheet);
                add("load", "Panzoid project", () => pickFiles(".pz"));
            },
        });
    }

    function openLibrarySheet() {
        openSheet({
            title: "Library",
            tall: true,
            build(body) {
                let media = editor.project.media.filter((m) => m.loaded && m.baseType === "track");
                if (!media.length) {
                    el("div", "pzm-note", body, "Nothing imported yet. Imported videos, photos, audio and .pz projects show up here so you can reuse them.").style.paddingTop = "18px";
                }
                let grid = el("div", "pzm-grid", body);
                for (let m of media) {
                    let t = el("button", "pzm-tile", grid);
                    t.type = "button";
                    let url = m.thumbUrl || (m.thumbnail && (typeof m.thumbnail === "string" ? m.thumbnail : (m.thumbUrl = URL.createObjectURL(m.thumbnail))));
                    if (url) {
                        let img = el("img", "", t);
                        img.src = url;
                        img.alt = "";
                    } else {
                        t.appendChild(icon(m.properties.icon.get() || "fragment"));
                    }
                    el("span", "pzm-tile-name", t, m.properties.name.get());
                    t.addEventListener("click", () => {
                        closeSheet();
                        let frame = editor.playback.currentFrame;
                        let created = op(() => insertFragments(m.data, frame, { from: [0, 0], fit: true }));
                        if (created && created.length) select(created[0]);
                    });
                }
                let more = el("div", "pzm-presets", body);
                let imp = el("button", "pzm-btn", more);
                imp.type = "button";
                imp.appendChild(icon("addmedia"));
                imp.appendChild(document.createTextNode("Import files"));
                imp.addEventListener("click", () => {
                    closeSheet();
                    pickFiles("video/*,audio/*,image/*,.pz");
                });
            },
        });
    }

    // A slider sheet that edits one numeric property. Values are written
    // live while dragging and committed as one undo step on release.
    function sliderSheet(opts) {
        openSheet({
            title: opts.title,
            build(body) {
                let block = el("div", "pzm-slider-block", body);
                let row = el("div", "pzm-slider-row", block);
                let range = el("input", "pzm-range", row);
                range.type = "range";
                range.min = 0;
                range.max = 1000;
                let out = el("div", "pzm-slider-value", row);
                let v = opts.get();
                let toPos = opts.toPos || ((x) => ((x - opts.min) / (opts.max - opts.min)) * 1000);
                let fromPos = opts.fromPos || ((p) => opts.min + (p / 1000) * (opts.max - opts.min));
                let show = (x) => (out.textContent = opts.format(x));
                range.value = toPos(v);
                show(v);
                range.addEventListener("input", () => {
                    v = fromPos(+range.value);
                    show(v);
                    if (opts.live) opts.live(v);
                });
                range.addEventListener("change", () => opts.commit(v));
                if (opts.presets) {
                    let pr = el("div", "pzm-presets", body);
                    for (let p of opts.presets) {
                        let c = el("button", "pzm-chip", pr, opts.format(p));
                        c.type = "button";
                        if (Math.abs(p - v) < 1e-3) c.classList.add("on");
                        c.addEventListener("click", () => {
                            v = p;
                            range.value = toPos(p);
                            show(p);
                            for (let x of pr.children) x.classList.toggle("on", x === c);
                            opts.commit(p);
                        });
                    }
                }
                if (opts.note) el("div", "pzm-note", body, opts.note);
            },
        });
    }

    function openSpeedSheet() {
        let clip = selectedClip();
        let s0 = clip && clipSpeed(clip);
        if (s0 === null || !clip) return;
        sliderSheet({
            title: "Speed",
            get: () => s0,
            min: 0.1,
            max: 10,
            // Logarithmic so 0.1x-1x gets as much travel as 1x-10x.
            toPos: (x) => (Math.log10(clamp(x, 0.1, 10)) + 1) * 500,
            fromPos: (p) => Math.round(Math.pow(10, p / 500 - 1) * 100) / 100,
            format: (x) => x.toFixed(2).replace(/0$/, "") + "x",
            presets: [0.25, 0.5, 1, 1.5, 2, 3, 5],
            commit: (x) => setSpeed(clip, x),
            note: "Slowing a clip down pushes the clips after it along so nothing overlaps.",
        });
    }

    function propertySlider(title, prop, min, max, fmt, presets) {
        if (!prop) return;
        if (prop.animated) {
            toast(title + " is animated — change it in Edit");
            openEditSheet();
            return;
        }
        let v0 = prop.get(0);
        sliderSheet({
            title: title,
            get: () => v0,
            min: min,
            max: max,
            format: fmt,
            presets: presets,
            live: (x) => prop.set(x, 0),
            commit: (x) => {
                op(() => propOps.setValue({ property: prop.getAddress(), frame: 0, value: x, oldValue: v0 }));
                v0 = x;
            },
        });
    }

    function openVolumeSheet(audioClip) {
        propertySlider("Volume", audioClip.object.properties.volume, 0, 2, (x) => Math.round(x * 100) + "%", [0, 0.5, 1, 1.5, 2]);
    }

    function openOpacitySheet() {
        let clip = selectedClip();
        let p = clip && clip.object && clip.object.properties.opacity;
        propertySlider("Opacity", p, 0, 1, (x) => Math.round(x * 100) + "%", [0, 0.25, 0.5, 0.75, 1]);
    }

    const RATIOS = [
        { name: "16:9", w: 1920, h: 1080 },
        { name: "9:16", w: 1080, h: 1920 },
        { name: "1:1", w: 1080, h: 1080 },
        { name: "4:5", w: 1080, h: 1350 },
        { name: "4:3", w: 1440, h: 1080 },
        { name: "21:9", w: 2560, h: 1080 },
    ];

    function ratioName() {
        let [w, h] = editor.sequence.properties.resolution.get();
        let hit = RATIOS.find((r) => r.w * h === r.h * w);
        return hit ? hit.name : w + "×" + h;
    }

    function openCanvasSheet() {
        let seq = editor.sequence;
        let releaseSeq = null;
        openSheet({
            title: "Canvas",
            build(body) {
                el("div", "pzm-section", body, "Aspect ratio");
                let grid = el("div", "pzm-grid", body);
                let cur = seq.properties.resolution.get();
                for (let r of RATIOS) {
                    let t = el("button", "pzm-tile", grid);
                    t.type = "button";
                    if (r.w * cur[1] === r.h * cur[0]) t.classList.add("on");
                    let box = el("div", "pzm-ratio", t);
                    let i = el("i", "", box);
                    let k = 34 / Math.max(r.w, r.h);
                    i.style.width = r.w * k + "px";
                    i.style.height = r.h * k + "px";
                    el("span", "pzm-tile-name", t, r.name);
                    t.addEventListener("click", () => {
                        op(() => propOps.setValue({ property: seq.properties.resolution.getAddress(), frame: 0, value: [r.w, r.h] }));
                        for (let x of grid.children) x.classList.toggle("on", x === t);
                        updateCanvasChip();
                        requestAnimationFrame(resizeViewport);
                    });
                }
                el("div", "pzm-section", body, "Frame rate");
                let fr = el("div", "pzm-presets", body);
                for (let fps of [24, 25, 30, 50, 60]) {
                    let c = el("button", "pzm-chip", fr, fps + " fps");
                    c.type = "button";
                    if (rate() === fps) c.classList.add("on");
                    c.addEventListener("click", () => {
                        op(() => propOps.setValue({ property: seq.properties.rate.getAddress(), frame: 0, value: fps }));
                        for (let x of fr.children) x.classList.toggle("on", x === c);
                        updateCanvasChip();
                        scheduleBuild();
                    });
                }
                el("div", "pzm-note", body, "Clip lengths are counted in frames, so changing the frame rate changes how long clips last.");
                let more = el("div", "pzm-presets", body);
                let b = el("button", "pzm-btn", more);
                b.type = "button";
                b.appendChild(icon("settings"));
                b.appendChild(document.createTextNode("All sequence settings"));
                b.addEventListener("click", () => {
                    let p = panel("sequence", () => {
                        let e = new PZ.ui.edit(editor, { childFilter: (o) => o instanceof PZ.propertyList, columnLayout: 1 });
                        return e;
                    });
                    let list = new PZ.objectList();
                    list.push(editor.sequence);
                    p.objects = list;
                    openSheet({
                        title: "Sequence",
                        build(bd) {
                            bd.classList.add("host");
                            releaseSeq = hostPanel(bd, p);
                        },
                        close() {
                            releaseSeq && releaseSeq();
                        },
                    });
                });
            },
        });
    }

    function updateCanvasChip() {
        if (!editor.sequence) return;
        ui.canvasChip.textContent = ratioName() + " · " + rate() + "fps";
    }

    function openExportSheet() {
        pause();
        let p = panel("export", () => new PZ.ui.export(editor));
        let release;
        openSheet({
            title: "Export",
            tall: true,
            build(body) {
                body.classList.add("host");
                release = hostPanel(body, p);
            },
            close() {
                release();
            },
        });
    }

    function openAgentSheet() {
        let p = panel("agent", () => new PZ.ui.agent(editor));
        let release;
        openSheet({
            title: "AI assistant",
            tall: true,
            build(body) {
                body.classList.add("host");
                release = hostPanel(body, p);
            },
            close() {
                release();
            },
        });
    }

    function openMenuSheet() {
        pause();
        openSheet({
            title: "Project",
            build(body) {
                let list = el("ul", "pzm-list", body);
                let item = (title, desc, fn) => {
                    let li = el("li", "", list, title);
                    if (desc) el("small", "", li, desc);
                    li.addEventListener("click", () => {
                        closeSheet();
                        fn();
                    });
                };
                item("New project", "Start from an empty scene", () => editor.new());
                item("Open project", "Load a .pz file from this device", () => editor.open());
                item("Save project", "Download this project as a .pz file", () => editor.save());
                item("Import media", "Video, photos, audio or a .pz project", () => pickFiles("video/*,audio/*,image/*,.pz"));
                item("Export video", "Render on this device", openExportSheet);
                item("Desktop editor", "The full Clipmaker 3 layout", () => {
                    location.href = "clipmaker.html?desktop";
                });
            },
        });
    }

    // ------------------------------------------------------------ the loop

    let lastTimeKey = "";
    let lastKfKey = "";
    function frameLoop() {
        requestAnimationFrame(frameLoop);
        if (!editor.sequence) return;
        if (TL.needsBuild) buildTimelineNow();
        syncScrollToFrame(false);
        drawRuler();

        let pb = editor.playback;
        let r = rate();
        let timeKey = pb.currentFrame + "/" + totalFrames() + "@" + r;
        if (timeKey !== lastTimeKey) {
            lastTimeKey = timeKey;
            ui.time.innerHTML = "";
            el("b", "", ui.time, formatTime(pb.currentFrame, r));
            ui.time.appendChild(document.createTextNode(" / " + formatTime(totalFrames(), r)));
        }
        ui.undoBtn.disabled = !(editor.history.undoStack && editor.history.undoStack.length);
        ui.redoBtn.disabled = !(editor.history.redoStack && editor.history.redoStack.length);

        let st = keyframeState();
        let kfKey = st ? (st.has ? "on" : "off") : "none";
        if (kfKey !== lastKfKey) {
            lastKfKey = kfKey;
            ui.kfBtn.disabled = !st;
            ui.kfBtn.classList.toggle("on", !!(st && st.has));
        }
    }

    // ---------------------------------------------------------------- boot

    function watchSequence() {
        let seq = editor.sequence;
        if (seq) {
            for (let o of [seq.ui.onClipCreated, seq.ui.onClipDeleted, seq.ui.onClipMoved, seq.ui.onTrackCreated, seq.ui.onTrackDeleted]) o.watch(scheduleBuild);
            seq.onLengthChanged.watch(scheduleBuild);
            seq.properties.rate.onChanged.watch(() => {
                updateCanvasChip();
                scheduleBuild();
            });
            seq.properties.resolution.onChanged.watch(() => {
                updateCanvasChip();
                requestAnimationFrame(resizeViewport);
            });
            updateCanvasChip();
            // Start zoomed so the whole sequence fits the screen width.
            requestAnimationFrame(() => {
                let w = TL.scroll.clientWidth || 360;
                TL.zoom = clamp((w * 0.8) / totalFrames(), 0.3, 12);
                relayoutClips();
                syncScrollToFrame(true);
            });
        }
        scheduleBuild();
        requestAnimationFrame(resizeViewport);
    }

    PZM.start = async function () {
        editor = new PZ.ui.editor();
        editor.name = "openzoid mobile";
        editor.defaultProject = PZM.defaultProject;
        editor.playback = new PZ.ui.playback(editor);
        editor.playback.loop = true;
        propOps = new PZ.ui.properties(editor);
        trackOps = makeTrackOps();
        objectOps = makeObjectOps();
        mediaOps = Object.create(PZ.ui.media.prototype);
        mediaOps.editor = editor;
        PZM.editor = editor;

        buildShell();
        buildViewport();

        if (PZ.agent && PZ.agent.attach) PZ.agent.attach(editor, { viewport: viewport });

        selection.onListChanged.watch(() => {
            scheduleBuild();
            updateToolbar();
            if (selection.length === 1 && transformTarget() && !PZM.hintShown) {
                PZM.hintShown = true;
                showHint("Drag to move · pinch to scale · twist to rotate");
            }
        });
        editor.onProjectChanged.watch(() => {
            select(null);
            closeSheet();
            if (editor.project) editor.project.ui.onChanged.watch(scheduleBuild);
        });
        editor.onSequenceChanged.watch(watchSequence);
        editor.playback.onSpeedChanged.watch(() => {
            let playing = editor.playback.speed !== 0;
            PZ.ui.switchIcon(ui.playBtn.firstChild, playing ? "pause" : "play");
            ui.playBtn.title = playing ? "Pause" : "Play";
            ui.playBtn.setAttribute("aria-label", ui.playBtn.title);
        });

        window.addEventListener("resize", () => {
            positionSheet();
            relayoutClips();
            syncScrollToFrame(true);
            clearTimeout(PZM.resizeTimer);
            PZM.resizeTimer = setTimeout(resizeViewport, 120);
        });
        document.addEventListener("keydown", onKey);

        let creation = null;
        try {
            creation = await editor.getCreationFromUrl();
        } catch (e) {}
        editor.init(creation);
        editor.enabled = true;
        updateToolbar();
        requestAnimationFrame(frameLoop);
    };

    // Hardware keyboards (tablets, desktop testing).
    function onKey(e) {
        let t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey) {
            let k = e.key.toLowerCase();
            if (k === "z") editor.history[e.shiftKey ? "redo" : "undo"]();
            else if (k === "y") editor.history.redo();
            else if (k === "s") editor.save();
            else return;
            e.preventDefault();
            return;
        }
        if (e.key === " ") togglePlay();
        else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
        else if (e.key === "s") splitAtPlayhead();
        else if (e.key === "Escape") {
            if (sheet) closeSheet();
            else select(null);
        } else if (e.key === "ArrowLeft") {
            pause();
            editor.playback.currentFrame = Math.max(0, editor.playback.currentFrame - 1);
        } else if (e.key === "ArrowRight") {
            pause();
            editor.playback.currentFrame = Math.min(totalFrames() - 1, editor.playback.currentFrame + 1);
        } else return;
        e.preventDefault();
    }

    // Exposed for tests and for poking at from the console.
    PZM.select = select;
    PZM.selection = selection;
    PZM.addLayer = addLayer;
    PZM.split = splitAtPlayhead;
    PZM.remove = deleteSelected;
    PZM.duplicate = duplicateSelected;
    PZM.setSpeed = setSpeed;
    PZM.importFiles = importFiles;
    PZM.toggleKeyframe = toggleTransformKeyframe;
    PZM.timeline = TL;
    PZM.locate = locate;
})();
