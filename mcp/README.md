# openzoid MCP server

`server.js` lets any MCP client (Claude Desktop, Claude Code, or another MCP host) build and edit an openzoid project. The client gets the same tools as the built-in AI panel, and every change shows up live in the editor tab.

```
MCP client  ──stdio──▶  mcp/server.js  ◀──HTTP long-poll──  editor tab (agent.js)
```

A web page can't accept incoming connections, so the editor connects out to the server instead. It registers its tools, waits for calls, runs each one through the editor's undoable command layer and sends the result back. **Each tool call is one undo step** in the editor.

No dependencies. Needs Node 18 or newer.

## Setup

1. **Register the server with your MCP client.**

   Claude Code:
   ```sh
   claude mcp add openzoid -- node /absolute/path/to/openzoid/mcp/server.js
   ```

   Claude Desktop (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "openzoid": {
         "command": "node",
         "args": ["/absolute/path/to/openzoid/mcp/server.js"]
       }
     }
   }
   ```

2. **Open the editor from the server.** While the client is running, the server also serves openzoid itself, so you don't need a separate web server:

   ```
   http://127.0.0.1:7823/clipmaker.html?mcp
   ```

   `?mcp` turns the bridge on. The setting is saved, so later visits connect without it.

   If you already serve openzoid some other way (for example `php -S localhost:2345`), open the AI panel (the lightbulb), go to **Settings → MCP bridge**, tick **Connect to a local MCP server**, and leave the address as `http://127.0.0.1:7823`. You can also open `…/clipmaker.html?mcp=http://127.0.0.1:7823`.

3. Ask your client for something, e.g. *"make a neon intro that says GREEN with a glow and a bouncy entrance"*.

The settings panel shows the bridge status. If a tool reports that no editor is connected, call `editor_status` or just open the URL above. A call made before the tab is open waits up to 15 seconds for it.

## Tools

| Tool | What it does |
| --- | --- |
| `get_project` | Resolution, frame rate, length, and every track and clip with its layer id (`v1:0`), effects and 3D objects |
| `describe_layer` | Every property of a layer or of a child (`node: "effects/0"`, `"objects/2/material"`): value, type, range, options, keyframes and easings, plus the child tree |
| `list_catalog` | What can be added: `effects` (80+, including the Panzoid+ shader pack), `objects3d`, `materials`, `shapes`, `operations`, `fonts`, `easings`, `layers` |
| `add_layer` | Scene, text, preset shape, path, image, adjustment or composite. Takes `properties` so it can be styled in the same call |
| `duplicate_layer` / `delete_layer` | Copy a layer with everything on it, or remove one |
| `edit_clip` | Move or retime a clip (start, length, track), e.g. to stagger entrances |
| `add_node` / `delete_node` / `move_node` | Add, remove or reorder effects, 3D objects, lights, cameras, materials and shape parts |
| `set_property` / `set_properties` | Set one value, or many across layers in one call. Colours take `"#rrggbb"`, fonts take names like `"lobster"`, options take display names like `"multiply"` |
| `animate_property` | Keyframes with named easings (`"cubic out"`, `"back out"`, `"elastic out"`, `"bounce out"`…), on layers or children |
| `clear_animation` | Remove keyframes and expression from a property |
| `set_expression` | Per-frame expressions for continuous motion (`"sin(time * 2) * 50"`) |
| `set_sequence_property` | Resolution, frame rate, motion blur |
| `render_frame` / `render_frames` | Look at one frame, or a labelled contact sheet of several, to check motion and timing |
| `editor_status` | Whether an editor tab is connected, and how to connect one |

The server sends the same working guide the built-in agent uses as its MCP `instructions`. It covers coordinate conventions and how to build something that looks finished rather than like a placeholder.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENZOID_MCP_PORT` | `7823` | Port for the editor bridge and the static editor |
| `OPENZOID_MCP_HOST` | `127.0.0.1` | Interface to listen on |
| `OPENZOID_MCP_ORIGINS` | *(local only)* | Extra page origins allowed to connect as the editor, comma-separated (`*` for any) |
| `OPENZOID_MCP_TIMEOUT` | `120000` | Milliseconds to wait for the editor to answer one call |

By default, only pages served from `localhost`, `127.0.0.1` or `file://` may register as the editor. That keeps other websites from picking up the tool calls your client makes.

## Testing

```sh
node tests/mcp_server.test.js
```

This test drives the server over stdio and plays the editor's side of the HTTP protocol, so it needs no browser.
