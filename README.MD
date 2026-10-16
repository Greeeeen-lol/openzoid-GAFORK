# openzoid, the Clipmaker 3 Open Source Project

## Information

This is the **main** branch.

This branch builds off of the work being done on the **unminified** branch, which aims to make the minified Panzoid code readable enough to be worked on without issues.

This branch may include **major functional differences** to what you can find on the unminified branch, on the archive branch, and on panzoid.com.

Just like with the unminified branch, **performance may be slightly worse**, as the files being loaded are larger, and take slightly longer for the browser to parse and understand, but also because this branch may have additional features that the original Clipmaker 3 does not already have.

**Anything involving connecting to panzoid.com will not work** here due to CORS blocking.

| Branch       | Purpose                                                                    | Functionality                                                             | Broken Features Handling                                            | Development Status                     |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `archive`    | Preserves the original, minified Clipmaker 3 as a local web archive        | Identical to original; no changes made                                    | Panzoid API access and community project display broken due to CORS | Complete (static)                      |
| `unminified` | Makes the archived code human-readable while maintaining original behavior | Matches original functionality; code is reformatted and partially renamed | Broken features are stubbed to prevent errors                       | Ongoing (improvement never truly ends) |
| `main`       | Active development of a new version based on `unminified`                  | Original features modified or replaced; new functionality added           | Broken features removed entirely                                    | In development                         |

### This branch is a transformation of the currently publicly available minified Clipmaker 3 source. The rights to the original codebase, which can be found in either the archive branch or links below, remain with the Panzoid team at [panzoid.com](https://panzoid.com/)

# What is openzoid?

openzoid is an attempt to:
1. Firstly, make it so that it is possible to **run Panzoid cm3 locally** without going to panzoid.com
2. After this, make Panzoid cm3 less of a pain to use, by **adding quality of life functionality**, such as autosaving

This project also **counts as archival**, as if panzoid.com ever goes down for any reason, or if the Panzoid team ever decides to delete Clipmaker 3 entirely, **one of the strongest web video editors** (that even **runs flawlessly on Chromebooks**) **could be lost to time.**

An offline version of Panzoid has been desired by a few users, and as far as I can tell, **no public copies exist.**

https://panzoid.com/community/search/85948?q=user%3ARedTubePoop

https://panzoid.com/community/18345

## Mobile editor

`mobile.html` is a touch editor for phones, built on the same Clipmaker 3 engine. Phones that open `index.html` or `clipmaker.html` are sent there automatically. Add `?desktop` to the URL to keep the desktop layout. Tablets keep the desktop layout by default.

The layout follows phone video editors: the preview on top, a timeline with a fixed centre playhead underneath, a tool strip along the bottom, and panels that slide up over the timeline while the preview stays visible. Everything is in Panzoid's colours and icons.

- **Timeline.** Scroll it sideways to scrub, pinch to zoom. Tap a clip to select it, drag the white handles to trim, and long-press then drag to move it in time or onto another layer. Clips snap to the playhead and to each other's edges. An imported video's sound moves, trims, splits and deletes with it.
- **Preview.** With a clip selected, drag on the preview to move it, pinch to scale and twist to rotate. Tap to play or pause.
- **Tools.** Import (video, photos, audio, `.pz`), Library, Text, Shapes, Effects (adds an adjustment layer carrying the effect), 3D, Audio, Composite, Canvas (aspect ratio and frame rate) and AI. A selected clip gets Edit, Split, Speed, Volume, Effects, Opacity, Keyframe, Duplicate and Delete.
- **Keyframes.** The ◆ button adds or removes a keyframe for position, scale, rotation and opacity at the playhead. Move the playhead, drag the layer, and it animates.
- **Full editing.** Edit, Effects, Objects, Export and AI embed the desktop panels as they are, so every property, effect and export option is still reachable.

Imported videos and photos are scaled to fit the canvas, the way phone editors do. Panzoid itself places them at their pixel size.

Edits go through the same undoable commands as the desktop timeline, so projects open in either editor and undo behaves the same. On a phone you can also "Add to Home Screen" to run it full screen like an app. `tests/mobile_ui.test.js` drives the whole thing in an emulated phone when Playwright is installed.

## AI agent

openzoid ships with an optional AI agent that builds and edits the project for you. Open the lightbulb tab in the sidebar, paste an API key, and describe what you want — "make a spinning intro that says my name", "add a glow to the title", "slow the whole thing down".

**Providers.** Either works, pick one in the settings:

| Provider | Get a key | Default model |
| --- | --- | --- |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) | `claude-opus-5-5` |
| Google (Gemini) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | `gemini-2.5-pro` |

Paste a key and the provider switches to match it automatically (Anthropic keys start with `sk-ant-`, Google keys with `AIza`). The **Model** field is free text, so you can point it at any model the provider offers. Each provider keeps its own key, model and endpoint, so switching between them doesn't lose your settings.

**How it works.** The agent doesn't write into the project file directly. It drives the same undoable command layer the UI uses (`PZ.ui.properties`, `PZ.ui.timeline.tracks`), so everything it does shows up live in the timeline and property panels. It can also render a frame and look at it, which is how it checks its own work instead of animating blind. **Everything the agent does in one reply is a single undo step** — one ctrl+Z takes it all back, which makes it safe to just try things.

**About the API key.** openzoid is deliberately a pile of static files with no server, so there is nowhere server-side to keep a key. Yours is stored in this browser's `localStorage` and sent straight from the page to the provider. If you would rather it not live in the browser, point the **Endpoint** field in the agent settings at your own proxy instead.

**What it can do.** Beyond adding layers and setting properties, the agent can add any of the editor's effects (80+, including the Panzoid+ shader pack), build 3D scenes (shapes, 3D text, lights, cameras, materials), duplicate and retime clips, animate with named easings ("back out", "elastic out"…), set many properties in one call, and render a contact sheet of several frames to check motion and timing.

**Use it from Claude Desktop, Claude Code or any MCP client.** `mcp/server.js` is a dependency-free MCP server that exposes the same tools to an external client and relays them to the open editor tab. Register it with your client, then open `http://127.0.0.1:7823/clipmaker.html?mcp`. The server also serves the editor, so you don't need a separate web server. No API key is needed in the browser for this. See [mcp/README.md](mcp/README.md).

Everything lives in `agent.js`, in four self-contained sections: the tool surface over the editor, the agent loop with one adapter per provider, the MCP bridge, and the chat panel. Adding a provider means implementing the small adapter interface described in the client section. The loop and the tools are shared.

## Current issues
- There is a **memory leaking issue that causes performance issues over time**, but currently it is unknown whether this is caused by unminified branch or archive branch. If the origin is in archive, it's an upstream problem and will likely be fixed in main. If the origin is in unminified, it's a downstream problem, meaning something changed functionally, and a lot of work will have to be done to undo that...

<!--

## How to use

### I want to run this locally

You only need basic knowledge about running web servers, so if you have that, this process should not be difficult.
There are many ways to do this, but this is the one I personally use:

1. Download all the files and start a webserver of your choice.
    - I personally prefer **php** as it is the easiest to set up. Simply navigate to the folder containing this very README file and run:
```sh
php -S localhost:2345
```
(make sure that the port is available, of course)

2. Open a web browser and go to this corresponding URL:
```
localhost:2345/clipmaker.html
```
There is currently no index.html, so you have to go to clipmaker.html to not receive a 404. Of course, make sure that the domain name corresponds to whatever you chose.

3. Clipmaker 3 should now be loaded; you might have to reload the page once or twice if you notice any oddities. Enjoy!

-->

## Important information, or 'Why is some stuff missing?'

When you open Panzoid cm3 from the website, you will be taken to the webpage [panzoid.com/tools/gen3/clipmaker](https://panzoid.com/tools/gen3/clipmaker). **This is not really where Panzoid cm3 is located**, it is simply a webpage with the Panzoid navbar, some functionality / scripts to run ads, and an [iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe).

The Panzoid team also has had a history of changing the URL that the navbar's Clipmaker 3 button leads to.

### **The URL for Panzoid cm3 is actually [panzoid.com/legacy/gen3/clipmaker.html](https://panzoid.com/legacy/gen3/clipmaker.html).**

This version is fully functional compared to the iframe-d one, but lacks the navbar, giving you more vertical space to use cm3. The main branch also features the removed ad banner by default. Not like the ad banner showed anything, anyways.

This project therefore aims to mirror the latter **clipmaker.html** instead of the former **tools/gen3/clipmaker**.

<!--

## Quality of life version

Once archiving cm3 is finished, there will be three versions of openzoid:

1. The original Panzoid cm3 as you would find it from panzoid.com's clipmaker.html -- for archival reasons
2. Panzoid cm3, with unminified JavaScript and a removed ad banner -- for general use purposes, and adding modification, or studying
3. Same as 2. + quality of life features, both from me and the community -- the heart of cm3 Open Source Project.

1 will never change as long as Panzoid cm3 never changes (which it allegedly has not done for at least the past 5 years).
2 will recieve updates only to make the code easier to read, no adding or removing features, no bugfixes.
3 will recieve updates for everything: refactors, bugfixes and more.

There are no plans to archive gen4. I wanted to archive gen3 as it has been abandoned even though it is such a great editor and I refuse to let it remain as abandonware.

-->
