// End-to-end check of the phone editor (mobile.html) in an emulated phone.
//
//   node tests/mobile_ui.test.js
//
// Needs Playwright with a Chromium build. It is not a dependency of this
// repo, so the test skips (and passes) when it cannot be loaded; point
// NODE_PATH at a global install to run it, e.g.
//   NODE_PATH=$(npm root -g) node tests/mobile_ui.test.js

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

let playwright;
try {
    playwright = require("playwright");
} catch (e) {
    console.log("mobile_ui: skipped (playwright is not installed)");
    process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ttf": "font/ttf", ".glsl": "text/plain" };

function serve() {
    let server = http.createServer((req, res) => {
        let file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
        if (!file.startsWith(ROOT)) {
            res.writeHead(403);
            return res.end();
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
            res.end(data);
        });
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    let server = await serve();
    let base = "http://127.0.0.1:" + server.address().port;
    let browser = await playwright.chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
    let errors = [];
    try {
        let ctx = await browser.newContext({ ...playwright.devices["iPhone 13"] });
        let page = await ctx.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        let cdp = await ctx.newCDPSession(page);
        let touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type: type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
        async function drag(from, to, holdMs) {
            await touch("touchStart", from);
            if (holdMs) await sleep(holdMs);
            for (let i = 1; i <= 10; i++) {
                let t = i / 10;
                await touch("touchMove", from.map((a, k) => [a[0] + (to[k][0] - a[0]) * t, a[1] + (to[k][1] - a[1]) * t]));
                await sleep(16);
            }
            await sleep(50);
            await touch("touchEnd", []);
            await sleep(200);
        }
        let seq = () =>
            page.evaluate(() => {
                let s = PZM.editor.sequence;
                return {
                    v: s.videoTracks.map((t) => t.clips.map((c) => [c.properties.name.get(), c.start, c.length])),
                    a: s.audioTracks.map((t) => t.clips.map((c) => [c.start, c.length])),
                    sel: PZM.selection.map((c) => c.properties.name.get()),
                };
            });

        // Phones opening the desktop page land on the touch editor.
        await page.goto(base + "/index.html");
        await page.waitForURL(/mobile\.html/);
        await sleep(1000);
        assert.deepStrictEqual((await seq()).v, [[["Scene", 0, 150]]], "default project");

        // Text: adding one opens the text box with the keyboard.
        await page.getByRole("button", { name: "Text" }).first().tap();
        await sleep(600);
        await page.keyboard.type("Hi");
        await page.locator(".pzm-sheet-head [title=Done]").tap();
        await sleep(200);
        let state = await seq();
        assert.deepStrictEqual(state.v[1], [["Text", 0, 150]], "text added on an overlay track");
        assert.strictEqual(await page.evaluate(() => PZM.selection[0].object.properties.childProperties.text.get(0)), "Hi");

        // Scrub by scrolling the timeline, split, undo.
        await page.evaluate(() => (PZM.timeline.scroll.scrollLeft = 60 * PZM.timeline.zoom));
        await sleep(300);
        assert.strictEqual(await page.evaluate(() => PZM.editor.playback.currentFrame), 60, "scrolling scrubs");
        await page.getByRole("button", { name: "Split" }).tap();
        await sleep(200);
        assert.deepStrictEqual((await seq()).v[1], [["Text", 0, 60], ["Text", 60, 90]], "split at playhead");
        await page.getByRole("button", { name: "Undo" }).tap();
        await sleep(200);
        assert.deepStrictEqual((await seq()).v[1], [["Text", 0, 150]], "undo split");

        // Trim with the left handle.
        let h = await page.locator(".pzm-clip.selected .pzm-handle.l").boundingBox();
        await drag([[h.x + 8, h.y + h.height / 2]], [[h.x + 48, h.y + h.height / 2]]);
        state = await seq();
        assert.ok(state.v[1][0][1] > 0 && state.v[1][0][1] + state.v[1][0][2] === 150, "left trim keeps the end: " + JSON.stringify(state.v[1]));

        // Long-press and drag moves the clip later.
        let before = state.v[1][0][1];
        let c = await page.locator(".pzm-clip.selected").boundingBox();
        let cx = Math.min(c.x + 40, 300);
        await drag([[cx, c.y + c.height / 2]], [[cx + 30, c.y + c.height / 2]], 500);
        state = await seq();
        assert.ok(state.v[1][0][1] > before && state.v[1][0][1] < before + 40, "long-press move: " + before + " -> " + state.v[1][0][1]);

        // Pinch on the preview scales the selected layer as one undo step.
        await page.evaluate(() => {
            let cl = PZM.selection[0];
            PZM.timeline.scroll.scrollLeft = (cl.start + 5) * PZM.timeline.zoom;
        });
        await sleep(300);
        let undo0 = await page.evaluate(() => PZM.editor.history.undoStack.length);
        let pv = await page.locator(".pzm-preview").boundingBox();
        let mx = pv.x + pv.width / 2;
        let my = pv.y + pv.height / 2;
        await drag([[mx - 30, my], [mx + 30, my]], [[mx - 60, my], [mx + 60, my]]);
        let sc = await page.evaluate(() => PZM.selection[0].object.properties.scale.get(0)[0]);
        assert.ok(sc > 1.5, "pinch scaled to " + sc);
        assert.strictEqual(await page.evaluate(() => PZM.editor.history.undoStack.length), undo0 + 1, "pinch is one undo step");

        // Photo import fits the canvas and gets a filmstrip.
        await page.evaluate(async () => {
            PZM.select(null);
            let cv = document.createElement("canvas");
            cv.width = 400;
            cv.height = 300;
            cv.getContext("2d").fillRect(0, 0, 400, 300);
            let blob = await new Promise((r) => cv.toBlob(r, "image/png"));
            await PZM.importFiles([new File([blob], "photo.png", { type: "image/png" })]);
        });
        await sleep(400);
        assert.deepStrictEqual(await page.evaluate(() => PZM.selection[0].object.properties.scale.get(0)), [3.6, 3.6], "photo fitted to 1920x1080");
        assert.ok(await page.locator(".pzm-clip.selected .pzm-clip-thumbs").count(), "photo clip has a thumbnail strip");

        // Video with sound: linked video+audio, speed, duplicate, delete.
        await page.evaluate(async () => {
            let cv = document.createElement("canvas");
            cv.width = 160;
            cv.height = 90;
            let g = cv.getContext("2d");
            let stream = cv.captureStream(30);
            let ac = new AudioContext();
            let osc = ac.createOscillator();
            let dst = ac.createMediaStreamDestination();
            osc.connect(dst);
            osc.start();
            stream.addTrack(dst.stream.getAudioTracks()[0]);
            let rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
            let chunks = [];
            rec.ondataavailable = (e) => chunks.push(e.data);
            let timer = setInterval(() => {
                g.fillStyle = "#" + Math.floor(Math.random() * 4095).toString(16);
                g.fillRect(0, 0, 160, 90);
            }, 30);
            rec.start();
            await new Promise((r) => setTimeout(r, 1500));
            rec.stop();
            await new Promise((r) => (rec.onstop = r));
            clearInterval(timer);
            PZM.select(null);
            PZM.editor.playback.currentFrame = 0;
            await PZM.importFiles([new File(chunks, "clip.webm", { type: "video/webm" })]);
        });
        await sleep(400);
        let vid = await page.evaluate(() => {
            let c = PZM.selection[0];
            let loc = PZM.locate(c);
            return { name: c.properties.name.get(), len: c.length, linked: !!c.link, loc: loc };
        });
        assert.strictEqual(vid.name, "clip.webm");
        assert.ok(vid.linked, "video and its audio are linked");
        let audioLen = (await seq()).a[0][0][1];
        assert.strictEqual(audioLen, vid.len, "audio half matches the video");
        await page.evaluate(() => PZM.setSpeed(PZM.selection[0], 2));
        await sleep(200);
        state = await seq();
        assert.strictEqual(state.a[0][0][1], Math.round(vid.len / 2), "2x speed halves both halves");
        await page.getByRole("button", { name: "Duplicate" }).tap();
        await sleep(200);
        assert.strictEqual((await seq()).a[0].length, 2, "duplicate copies the linked audio too");
        await page.getByRole("button", { name: "Delete" }).tap();
        await sleep(200);
        assert.strictEqual((await seq()).a[0].length, 1, "delete removes the linked audio too");

        // The embedded desktop panels open inside sheets.
        await page.getByRole("button", { name: "Export" }).tap();
        await sleep(300);
        assert.ok(await page.locator(".pzm-sheet.open .pz-option").count(), "export options shown");
        await page.locator(".pzm-sheet-head [title=Done]").tap();

        assert.deepStrictEqual(errors, [], "no page errors");
        await ctx.close();
        console.log("mobile_ui: all checks passed");
    } finally {
        await browser.close();
        server.close();
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
