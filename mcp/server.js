#!/usr/bin/env node
// openzoid MCP server — lets any MCP client (Claude Desktop, Claude Code, ...)
// drive a running openzoid editor with the same tools as the built-in agent.
//
//   MCP client  <--stdio JSON-RPC-->  this server  <--HTTP long-poll-->  editor tab
//
// A browser page cannot accept connections, so the editor dials in: with the
// bridge enabled (agent settings, or open the editor with ?mcp) it registers
// its tool list at /editor/connect and long-polls /editor/next for calls.
//
// The server also serves the editor itself, so the simplest setup is:
//   1. register `node /path/to/openzoid/mcp/server.js` with your MCP client
//   2. open http://127.0.0.1:7823/clipmaker.html?mcp
//
// No dependencies; Node 18 or newer. Everything it logs goes to stderr, since
// stdout carries the protocol.

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const PORT = +(process.env.OPENZOID_MCP_PORT || 7823);
const HOST = process.env.OPENZOID_MCP_HOST || "127.0.0.1";
const CALL_TIMEOUT_MS = +(process.env.OPENZOID_MCP_TIMEOUT || 120000);
const CONNECT_GRACE_MS = 15000; // how long a tool call waits for an editor to appear
const POLL_HOLD_MS = 25000; // how long /editor/next holds a request open
const EDITOR_STALE_MS = 60000; // no poll for this long = editor gone
const SERVER_VERSION = "1.0.0";

function log() {
    process.stderr.write("[openzoid-mcp] " + Array.prototype.join.call(arguments, " ") + "\n");
}

// --------------------------------------------------------------- tool list

// The tool definitions and guide live in agent.js. Load them here too, so a
// client sees the full tool list even before an editor tab has connected.
function loadAgentDefinitions() {
    try {
        let source = fs.readFileSync(path.join(ROOT, "agent.js"), "utf8");
        let sandbox = { console: { log() {}, warn() {}, error() {} } };
        vm.runInNewContext(source, sandbox, { filename: "agent.js" });
        return {
            tools: sandbox.PZ.agent.tools.definitions,
            guide: sandbox.PZ.agent.guide || "",
        };
    } catch (e) {
        log("could not read tool definitions from agent.js:", e.message);
        return { tools: [], guide: "" };
    }
}

const fallback = loadAgentDefinitions();

const STATUS_TOOL = {
    name: "editor_status",
    description:
        "Check whether an openzoid editor tab is connected to this MCP server, and how to connect one if not. Call this if other tools report that no editor is connected.",
    inputSchema: { type: "object", properties: {}, required: [] },
};

function toMcpTool(t) {
    return { name: t.name, description: t.description, inputSchema: t.input_schema || t.inputSchema || { type: "object", properties: {} } };
}

// ------------------------------------------------------------ editor state

let editor = null; // { session, tools, guide, title, lastSeen, poll }
const queue = []; // calls waiting for the editor to pick them up
const pending = new Map(); // id -> { resolve, timer, name }
let connectWaiters = [];

function editorConnected() {
    return !!editor && Date.now() - editor.lastSeen < EDITOR_STALE_MS;
}

function currentTools() {
    let defs = editor && editor.tools && editor.tools.length ? editor.tools : fallback.tools;
    return defs.map(toMcpTool).concat([STATUS_TOOL]);
}

function editorUrl() {
    return "http://" + (HOST === "0.0.0.0" ? "127.0.0.1" : HOST) + ":" + PORT + "/clipmaker.html?mcp";
}

function notConnectedMessage() {
    return (
        "No openzoid editor is connected. Open " +
        editorUrl() +
        " in a browser (or, if you serve openzoid elsewhere, open the AI panel > Settings and turn on 'Connect to a local MCP server' with address http://127.0.0.1:" +
        PORT +
        "), then try again."
    );
}

function waitForEditor(ms) {
    if (editorConnected()) return Promise.resolve(true);
    return new Promise((resolve) => {
        let timer = setTimeout(() => {
            connectWaiters = connectWaiters.filter((w) => w !== waiter);
            resolve(false);
        }, ms);
        let waiter = () => {
            clearTimeout(timer);
            resolve(true);
        };
        connectWaiters.push(waiter);
    });
}

// Hand the next queued call to a waiting poll, if both exist.
function dispatch() {
    if (!editor || !editor.poll || !queue.length) return;
    let call = queue.shift();
    let poll = editor.poll;
    editor.poll = null;
    clearTimeout(poll.timer);
    sendJson(poll.res, 200, { id: call.id, name: call.name, args: call.args });
}

async function callEditor(name, args) {
    if (!editorConnected()) {
        let ok = await waitForEditor(CONNECT_GRACE_MS);
        if (!ok) throw new Error(notConnectedMessage());
    }
    let id = crypto.randomUUID();
    return new Promise((resolve) => {
        let timer = setTimeout(() => {
            pending.delete(id);
            let idx = queue.findIndex((c) => c.id === id);
            if (idx !== -1) queue.splice(idx, 1);
            resolve({ ok: false, error: "The editor did not answer within " + Math.round(CALL_TIMEOUT_MS / 1000) + "s. Is the tab still open and in the foreground?" });
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve: resolve, timer: timer, name: name });
        queue.push({ id: id, name: name, args: args || {} });
        dispatch();
    });
}

function toMcpResult(reply) {
    if (!reply.ok) {
        return { content: [{ type: "text", text: String(reply.error || "Tool failed.") }], isError: true };
    }
    let value = reply.value;
    if (value && typeof value === "object" && value._image) {
        let rest = Object.assign({}, value);
        delete rest._image;
        return {
            content: [
                { type: "image", data: value._image, mimeType: "image/png" },
                { type: "text", text: JSON.stringify(rest) },
            ],
        };
    }
    return { content: [{ type: "text", text: value === undefined ? "null" : JSON.stringify(value, null, 1) }] };
}

// -------------------------------------------------------------- HTTP side

const ALLOWED_ORIGINS = (process.env.OPENZOID_MCP_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Only pages on this machine may register as the editor, unless configured
// otherwise; anything else could read the tool calls your client makes.
function originAllowed(origin) {
    if (!origin) return true; // same-origin requests and non-browser clients
    if (ALLOWED_ORIGINS.indexOf("*") !== -1 || ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
    if (origin === "null") return true; // file:// pages
    try {
        let host = new URL(origin).hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    } catch (e) {
        return false;
    }
}

function corsHeaders(req) {
    let origin = req.headers.origin;
    if (!origin || !originAllowed(origin)) return {};
    return {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-allow-private-network": "true",
        vary: "origin",
    };
}

function sendJson(res, status, body) {
    if (res.writableEnded) return;
    let headers = Object.assign({ "cache-control": "no-store" }, res.pz_cors || {});
    if (status === 204) {
        res.writeHead(204, headers);
        res.end();
        return;
    }
    headers["content-type"] = "application/json";
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error("body too large"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".glsl": "text/plain; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
};

// Serve the editor's static files, so no separate web server is needed.
function serveStatic(req, res) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch (e) {
        res.writeHead(400);
        res.end();
        return;
    }
    if (pathname === "/") pathname = "/clipmaker.html";
    let file = path.resolve(ROOT, "." + pathname);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
    }
    // Keep the repository's own metadata private.
    let rel = path.relative(ROOT, file).split(path.sep);
    if (rel[0] === ".git" || rel[0] === "mcp") {
        res.writeHead(404);
        res.end();
        return;
    }
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("Not found");
            return;
        }
        let type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
        if (type.indexOf("text/html") === 0) {
            // Tell the page its bridge lives at this same origin.
            fs.readFile(file, "utf8", (err2, html) => {
                if (err2) {
                    res.writeHead(500);
                    res.end();
                    return;
                }
                html = html.replace("<head>", "<head>\n    <script>window.PZ_MCP_SAME_ORIGIN = true;</script>");
                res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
                res.end(html);
            });
            return;
        }
        res.writeHead(200, { "content-type": type, "content-length": stat.size, "cache-control": "no-cache" });
        fs.createReadStream(file).pipe(res);
    });
}

async function handleHttp(req, res) {
    let url = new URL(req.url, "http://x");
    res.pz_cors = corsHeaders(req);

    if (url.pathname.indexOf("/editor/") !== 0) {
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405);
            res.end();
            return;
        }
        serveStatic(req, res);
        return;
    }

    if (req.headers.origin && !originAllowed(req.headers.origin)) {
        sendJson(res, 403, { error: "origin not allowed; set OPENZOID_MCP_ORIGINS to allow " + req.headers.origin });
        return;
    }
    if (req.method === "OPTIONS") {
        sendJson(res, 204);
        return;
    }

    if (url.pathname === "/editor/connect" && req.method === "POST") {
        let body;
        try {
            body = await readBody(req, 4 * 1024 * 1024);
        } catch (e) {
            sendJson(res, 400, { error: "bad body" });
            return;
        }
        // The newest tab wins; an older one's polls get 410 and it reconnects
        // only if it is reopened or toggled.
        if (editor && editor.poll) {
            clearTimeout(editor.poll.timer);
            sendJson(editor.poll.res, 410, { error: "replaced by a newer editor tab" });
        }
        let previousNames = currentTools().map((t) => t.name).join(",");
        editor = {
            session: crypto.randomUUID(),
            tools: Array.isArray(body.tools) ? body.tools : [],
            guide: typeof body.guide === "string" ? body.guide : "",
            title: body.title || "",
            lastSeen: Date.now(),
            poll: null,
        };
        log("editor connected" + (editor.title ? " (" + editor.title + ")" : "") + " with " + editor.tools.length + " tools");
        sendJson(res, 200, { session: editor.session, server: "openzoid-mcp", version: SERVER_VERSION });

        if (currentTools().map((t) => t.name).join(",") !== previousNames) {
            notify("notifications/tools/list_changed");
        }
        let waiters = connectWaiters;
        connectWaiters = [];
        waiters.forEach((w) => w());
        return;
    }

    if (url.pathname === "/editor/next" && req.method === "GET") {
        let session = url.searchParams.get("session");
        if (!editor || editor.session !== session) {
            sendJson(res, 410, { error: "unknown session; reconnect" });
            return;
        }
        editor.lastSeen = Date.now();
        if (editor.poll) {
            clearTimeout(editor.poll.timer);
            sendJson(editor.poll.res, 204);
        }
        let poll = { res: res, timer: null };
        poll.timer = setTimeout(() => {
            if (editor && editor.poll === poll) editor.poll = null;
            sendJson(res, 204);
        }, POLL_HOLD_MS);
        req.on("close", () => {
            clearTimeout(poll.timer);
            if (editor && editor.poll === poll) editor.poll = null;
        });
        editor.poll = poll;
        dispatch();
        return;
    }

    if (url.pathname === "/editor/result" && req.method === "POST") {
        let body;
        try {
            body = await readBody(req, 64 * 1024 * 1024);
        } catch (e) {
            sendJson(res, 400, { error: "bad body" });
            return;
        }
        if (!editor || editor.session !== body.session) {
            sendJson(res, 410, { error: "unknown session" });
            return;
        }
        editor.lastSeen = Date.now();
        let entry = pending.get(body.id);
        if (entry) {
            pending.delete(body.id);
            clearTimeout(entry.timer);
            entry.resolve({ ok: !!body.ok, value: body.value, error: body.error });
        }
        sendJson(res, 200, { ok: true });
        return;
    }

    if (url.pathname === "/editor/status" && req.method === "GET") {
        sendJson(res, 200, statusInfo());
        return;
    }

    sendJson(res, 404, { error: "not found" });
}

function statusInfo() {
    return {
        connected: editorConnected(),
        editor_title: editor ? editor.title : null,
        tools: currentTools().length - 1,
        queued_calls: queue.length,
        editor_url: editorUrl(),
        port: PORT,
        http_listening: httpListening,
    };
}

let httpListening = false;
const httpServer = http.createServer((req, res) => {
    handleHttp(req, res).catch((e) => {
        log("http error:", e.message);
        try {
            sendJson(res, 500, { error: e.message });
        } catch (e2) {
            /* already closed */
        }
    });
});
httpServer.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
        log("port " + PORT + " is in use (is another openzoid MCP server running?). Set OPENZOID_MCP_PORT to use a different one.");
    } else {
        log("http server error:", e.message);
    }
});
httpServer.listen(PORT, HOST, () => {
    httpListening = true;
    log("editor bridge listening on http://" + HOST + ":" + PORT + " — open " + editorUrl());
});

// --------------------------------------------------------------- MCP side

function write(message) {
    process.stdout.write(JSON.stringify(message) + "\n");
}

function notify(method, params) {
    if (!initialized) return;
    write({ jsonrpc: "2.0", method: method, params: params || {} });
}

let initialized = false;

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

async function handleRpc(msg) {
    let method = msg.method;
    let params = msg.params || {};

    switch (method) {
        case "initialize": {
            let requested = params.protocolVersion;
            initialized = true;
            return {
                protocolVersion: SUPPORTED_PROTOCOLS.indexOf(requested) !== -1 ? requested : SUPPORTED_PROTOCOLS[0],
                capabilities: { tools: { listChanged: true } },
                serverInfo: { name: "openzoid", version: SERVER_VERSION },
                instructions:
                    ((editor && editor.guide) || fallback.guide) +
                    "\n\nThese tools act on an openzoid editor open in the user's browser. Each tool call is its own undo step there. If a call reports that no editor is connected, tell the user to open " +
                    editorUrl() +
                    ".",
            };
        }
        case "ping":
            return {};
        case "tools/list":
            return { tools: currentTools() };
        case "tools/call": {
            let name = params.name;
            if (name === STATUS_TOOL.name) {
                let info = statusInfo();
                if (!info.connected) info.how_to_connect = notConnectedMessage();
                return { content: [{ type: "text", text: JSON.stringify(info, null, 1) }] };
            }
            if (!currentTools().some((t) => t.name === name)) {
                return { content: [{ type: "text", text: "Unknown tool '" + name + "'." }], isError: true };
            }
            try {
                let reply = await callEditor(name, params.arguments || {});
                return toMcpResult(reply);
            } catch (e) {
                return { content: [{ type: "text", text: e.message }], isError: true };
            }
        }
        case "resources/list":
            return { resources: [] };
        case "prompts/list":
            return { prompts: [] };
        default: {
            let err = new Error("Method not found: " + method);
            err.code = -32601;
            throw err;
        }
    }
}

function onLine(line) {
    line = line.trim();
    if (!line) return;
    let msg;
    try {
        msg = JSON.parse(line);
    } catch (e) {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
    }
    let messages = Array.isArray(msg) ? msg : [msg];
    for (let m of messages) {
        if (!m || typeof m !== "object") continue;
        let isRequest = m.id !== undefined && m.id !== null && typeof m.method === "string";
        if (!isRequest) continue; // notifications and responses need no reply
        handleRpc(m).then(
            (result) => write({ jsonrpc: "2.0", id: m.id, result: result }),
            (e) => write({ jsonrpc: "2.0", id: m.id, error: { code: e.code || -32603, message: e.message } })
        );
    }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        onLine(line);
    }
});
process.stdin.on("end", () => {
    if (buffer.trim()) onLine(buffer);
    // The client went away; stop serving so the port frees up.
    httpServer.close();
    process.exit(0);
});

log("openzoid MCP server " + SERVER_VERSION + " ready (" + fallback.tools.length + " tools from agent.js)");
