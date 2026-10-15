// Tests mcp/server.js end to end without a browser: an MCP client on stdio,
// and a fake editor tab speaking the bridge's HTTP long-poll protocol.
//
//   node tests/mcp_server.test.js

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 17000 + Math.floor(Math.random() * 2000);
const BASE = "http://127.0.0.1:" + PORT;

const server = spawn(process.execPath, [path.join(__dirname, "..", "mcp", "server.js")], {
    env: Object.assign({}, process.env, { OPENZOID_MCP_PORT: String(PORT) }),
    stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
server.stderr.on("data", (d) => (stderr += d));

let buffer = "";
let nextId = 1;
const waiting = new Map();
const notifications = [];
server.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
        let msg = JSON.parse(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (msg.id !== undefined && waiting.has(msg.id)) {
            waiting.get(msg.id)(msg);
            waiting.delete(msg.id);
        } else {
            notifications.push(msg);
        }
    }
});

function rpc(method, params) {
    let id = nextId++;
    return new Promise((resolve) => {
        waiting.set(id, resolve);
        server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }) + "\n");
    });
}

async function waitForListening() {
    for (let i = 0; i < 50; i++) {
        try {
            let r = await fetch(BASE + "/editor/status");
            if (r.ok) return;
        } catch (e) {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start:\n" + stderr);
}

async function run() {
    await waitForListening();

    // --- MCP handshake
    let init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.strictEqual(init.result.protocolVersion, "2025-06-18");
    assert.strictEqual(init.result.serverInfo.name, "openzoid");
    assert.ok(init.result.capabilities.tools.listChanged);
    assert.ok(init.result.instructions.indexOf("Panzoid") !== -1, "instructions carry the agent guide");
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    let older = await rpc("initialize", { protocolVersion: "1999-01-01" });
    assert.strictEqual(older.result.protocolVersion, "2025-06-18", "unknown versions fall back to the latest supported");

    // --- tool list comes from agent.js even before an editor connects
    let list = await rpc("tools/list");
    let names = list.result.tools.map((t) => t.name);
    for (let n of ["get_project", "add_layer", "add_node", "animate_property", "set_properties", "render_frames", "editor_status"]) {
        assert.ok(names.indexOf(n) !== -1, "tools/list includes " + n);
    }
    for (let t of list.result.tools) {
        assert.strictEqual(t.inputSchema.type, "object", t.name + " has an object inputSchema");
    }

    let status = await rpc("tools/call", { name: "editor_status", arguments: {} });
    assert.strictEqual(JSON.parse(status.result.content[0].text).connected, false);

    let unknown = await rpc("tools/call", { name: "nope", arguments: {} });
    assert.strictEqual(unknown.result.isError, true);

    let missing = await rpc("no/such/method");
    assert.strictEqual(missing.error.code, -32601);

    // --- a fake editor connects
    let connect = await fetch(BASE + "/editor/connect", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:2345" },
        body: JSON.stringify({ tools: [{ name: "get_project", description: "d", input_schema: { type: "object", properties: {} } }, { name: "render_frame", description: "r", input_schema: { type: "object", properties: {} } }], title: "fake" }),
    });
    assert.strictEqual(connect.status, 200);
    assert.strictEqual(connect.headers.get("access-control-allow-origin"), "http://localhost:2345");
    let session = (await connect.json()).session;
    assert.ok(session);

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(notifications.some((n) => n.method === "notifications/tools/list_changed"), "tool list change is announced");
    let list2 = await rpc("tools/list");
    assert.deepStrictEqual(list2.result.tools.map((t) => t.name), ["get_project", "render_frame", "editor_status"], "the editor's own tool list wins once connected");

    // The editor answers whatever arrives on its poll.
    async function serveOne(answer) {
        let res = await fetch(BASE + "/editor/next?session=" + session);
        assert.strictEqual(res.status, 200);
        let call = await res.json();
        let reply = Object.assign({ session: session, id: call.id }, answer(call));
        await fetch(BASE + "/editor/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reply) });
        return call;
    }

    // Plain JSON result.
    let pendingCall = rpc("tools/call", { name: "get_project", arguments: { x: 1 } });
    let seen = await serveOne(() => ({ ok: true, value: { resolution: [1920, 1080] } }));
    assert.strictEqual(seen.name, "get_project");
    assert.deepStrictEqual(seen.args, { x: 1 });
    let result = await pendingCall;
    assert.deepStrictEqual(JSON.parse(result.result.content[0].text), { resolution: [1920, 1080] });

    // Images become MCP image content.
    pendingCall = rpc("tools/call", { name: "render_frame", arguments: {} });
    await serveOne(() => ({ ok: true, value: { _image: "iVBORw0KGgo=", frame: 12 } }));
    result = await pendingCall;
    assert.strictEqual(result.result.content[0].type, "image");
    assert.strictEqual(result.result.content[0].mimeType, "image/png");
    assert.strictEqual(result.result.content[0].data, "iVBORw0KGgo=");
    assert.deepStrictEqual(JSON.parse(result.result.content[1].text), { frame: 12 });

    // Tool errors pass through as isError results.
    pendingCall = rpc("tools/call", { name: "get_project", arguments: {} });
    await serveOne(() => ({ ok: false, error: "No video track 9." }));
    result = await pendingCall;
    assert.strictEqual(result.result.isError, true);
    assert.strictEqual(result.result.content[0].text, "No video track 9.");

    // A stale session is told to reconnect.
    let stale = await fetch(BASE + "/editor/next?session=bogus");
    assert.strictEqual(stale.status, 410);

    // --- origin checks: other websites may not register as the editor
    let evil = await fetch(BASE + "/editor/connect", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://example.com" },
        body: "{}",
    });
    assert.strictEqual(evil.status, 403);

    // --- static serving of the editor, marked as same-origin
    let page = await fetch(BASE + "/clipmaker.html?mcp");
    assert.strictEqual(page.status, 200);
    assert.ok((await page.text()).indexOf("PZ_MCP_SAME_ORIGIN") !== -1);
    let agent = await fetch(BASE + "/agent.js");
    assert.strictEqual(agent.status, 200);
    assert.ok(/javascript/.test(agent.headers.get("content-type")));
    let traversal = await fetch(BASE + "/..%2f..%2fetc%2fpasswd");
    assert.ok(traversal.status === 403 || traversal.status === 404, "no path traversal");
    let git = await fetch(BASE + "/.git/config");
    assert.strictEqual(git.status, 404);
}

run().then(
    () => {
        console.log("mcp_server.test.js: all tests passed");
        server.stdin.end();
    },
    (e) => {
        console.error(e);
        console.error(stderr);
        server.kill();
        process.exit(1);
    }
);
