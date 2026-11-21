# Rendering and loading performance

This document describes the usability overhaul in the independent
`SUaDtL/Meridian` repository. Performance is evaluated as observable work and
downloaded bytes. It does not equate smaller bundles with a measured page-load
time, or fewer layouts with a guaranteed frame rate on every device.

## Baseline and measured build output

The preceding release, commit
`c4e7468d626b719bc8203f2fe4cd7870abd8da13`, served a self-contained application of
6,845,074 bytes. Its SHA-256 was
`67b377181dd21d13612e39bf97aa78caeb0a9984cd429a60637747267d7246d4`.
Every visit downloaded all diagram renderers, the code editor, application code,
styles, and dependency notices in that HTML file.

The [initial production CI measurement](https://github.com/SUaDtL/Meridian/actions/runs/44677231584)
for PR head `db45fbe06c18070b2e92d1d48a573ab6417c3409` measured 335,861
uncompressed bytes in the welcome dependency graph, including HTML, CSS,
JavaScript, and the favicon. That is 95.09% fewer initial bytes than the preceding
single-file release. The complete split site contained 106 verified files and
6,845,005 bytes; splitting defers work rather than claiming to remove every
diagram capability from the application.

The browser actually loaded three JavaScript files whose published uncompressed
sizes totaled **281,368 bytes**, out of **5,994,358 JavaScript bytes** in the full
site: **4.69%**. The welcome page initialized neither Mermaid layout nor the code
editor. The browser's requested asset paths were matched to the verified build
inventory; these numbers describe uncompressed asset content, not compressed
network transfer size, elapsed loading time, or end-user frame rate.

A subsequent local build with notification refinements measured 336,880 initial
bytes, retaining approximately the same 95.1% reduction. The release's exact
values are recorded in its generated `build.json`; measurements in this document
identify their build rather than presenting a development snapshot as final
deployed bytes.

The hosted build and the portable build serve different purposes:

| Output | Loading behavior | Integrity evidence |
| --- | --- | --- |
| `site/` | Lightweight welcome; studio, editor, export UI, and Mermaid diagram families load when needed | Every published file has a byte count and SHA-256 in `build.json`; the initial static dependency graph is listed separately |
| `standalone/Meridian.html` | One complete application file for use without a server | Exactly one embedded module with its exact CSP script hash; no external application assets |
| Exported presentation HTML | The diagram and its presentation runtime, without the full authoring app | Existing portable presentation tests exercise offline rendering, navigation, and reduced motion |

Hosted JavaScript and styles are content-named local assets. The hosted CSP allows
local module scripts, rejects inline application scripts, and sets
`connect-src 'none'`. The standalone CSP still authorizes only its exact embedded
script hash. The original archived bundle and its original checksum are unchanged.

## Render work is split by what changed

| Change | Required work |
| --- | --- |
| Title, subtitle, frame ratio, padding, background, ambient light, heading/signature visibility | Rebuild the lightweight export frame; do not invoke the diagram renderer |
| Motion mode/speed, surface finish, shadows/glow, connector weight, accent colors, decorative element styles | Clone a cached, sanitized Mermaid layout and apply current decoration |
| Mermaid source, native theme, layout engine, line shape, spacing, base font, element shape/typography/routing | Run Mermaid layout, then decorate |
| Return to a recently rendered combination | Reuse the complete cached result |
| Storyboard scene names, timing, visibility, camera targets, or playback progress | Update the presentation engine; keep the framed SVG DOM in place |
| Canvas selection or spotlight | Update cached DOM targets using source-key maps |

The invalidation functions are explicit and tested. A native Mermaid theme
remains a layout input because different diagram families embed their appearance
in native SVG output. The optimization does not attempt to recolor arbitrary
renderer internals or change published geometry.

### Latest-only scheduling

Mermaid uses global configuration. The scheduler therefore allows one executing
render and at most one waiting request. A newer request rejects superseded
consumers with `AbortError` and replaces the waiting request. A running Mermaid
layout cannot be interrupted safely; it finishes its current asynchronous call,
then cancellation prevents the remaining decoration and measurement work. The
next layout starts only after the previous call has settled.

The scheduling regression submits one running request, 25 superseded edits, and
one final edit. It verifies that only the first and final tasks execute, maximum
concurrency is one, all superseded promises settle, shared consumers can cancel
independently, and a parse failure does not poison subsequent requests.

### Bounded reuse

Layout snapshots have an LRU limit of six entries and an estimated 8 MiB byte budget.
Complete results have eight entries and an estimated 12 MiB budget. Source-bearing keys and
SVG strings count toward the budgets; oversized entries are not cached. The
Mermaid parser's mutable flowchart database is copied before caching, so another
diagram cannot change a retained model. Each decoration starts from a sanitized
snapshot, rather than accumulating changes on a previous decorated SVG.

### Stage and editor

Framing returns SVG and dimensions together, eliminating a second XML parse.
Frame memoization depends only on the fields used by the frame builder, so scene
metadata and playback notifications do not rebuild it. Selection indexes and
cached DOM target lists replace repeated array searches and selector scans.

The stage keeps a synchronous camera for pointer calculations and commits React
camera state at most once per animation frame. Pinch gestures reuse viewport
geometry until scrolling or resizing invalidates it. Entering presentation fits
the presentation view; leaving restores the editing camera and fitted state for
the same project.

The source editor has stable CodeMirror extensions, setup, and callback bridges.
An explicit focus request reaches its `EditorView` even if the editor finishes
lazy loading after the request. Unrelated studio updates do not recreate its
configuration or discard editing history.

## Verification

The production browser suite measures actual hosted behavior through
`tests/browser/performance.spec.ts`. It instruments SVG parsing and temporary
renderer hosts in the test page, without adding analytics or a public diagnostics
API to the app. It checks:

- The welcome screen downloads only its entry graph, initializes neither a
  Mermaid layout nor CodeMirror, loads under 500,000 uncompressed JavaScript
  bytes, and uses less than 15% of the site's total JavaScript.
- Direct heading edits and framing changes cause no new renderer invocation.
- Changing motion causes one decoration pass and no Mermaid layout; returning
  to the previous style causes neither pass.
- Scene edits and playback do not parse another SVG or replace the diagram DOM.
- The standalone authoring app opens through a `file:` URL and renders while
  all HTTP requests are blocked.

Each performance test attaches its counters or payload inventory to the browser
report. The existing six-theme and ten-example comparisons still compare the
production artifact with the immutable published reference in the same browser.

### Observed production-browser work

All four performance tests and both visual comparison suites passed in the
initial CI measurement above. Its attached `render-work-counts` and
`storyboard-work-counts` record the following work. Counts in the last three
columns are additional work caused by that action, not cumulative totals.

| Browser action | New Mermaid layouts | New decoration passes | New SVG parses |
| --- | ---: | ---: | ---: |
| Initial example render | 1 | Included in the layout pass | 2 |
| Edit title and subtitle on the stage | 0 | 0 | 1 |
| Change frame ratio | 0 | 0 | 1 |
| Change connector effect from Flow to Pulse | 0 | 1 | 2 |
| Return from Pulse to the cached Flow result | 0 | 0 | 1 |
| Edit storyboard scene metadata and play/pause | 0 | 0 | 0 |

Heading and framing changes still prepare a new frame. Motion changes still
apply decoration and prepare that frame. The evidence demonstrates that those
actions avoid expensive Mermaid layout; it does not describe them as doing no
work. Storyboard editing and playback kept the exact same diagram DOM element,
with cumulative counts unchanged at one layout, zero separate decoration passes,
and two SVG parses. The same browser test verified that presentation restored a
manually panned editing camera.

The offline application test opened `standalone/Meridian.html` through a `file:`
URL and rendered an example with all HTTP requests blocked. All six theme
comparisons and all ten example comparisons stayed within the existing 0.2%
changed-pixel limit against the archived reference, using the same browser and
fonts for each pair.

These are specific passed checks, not an assertion that the initial workflow was
ready to release: that run passed 25 of 29 browser tests, with four design and
storyboard functional checks requiring follow-up. The full workflow must be green before
merging and deploying.

Run the gates with:

```sh
npm test
npm run verify:legacy
npm run build:pages
npm run verify:artifact
npm run build:standalone
npm run verify:standalone
npm run test:browser
```

Local unit, hosted-build, portable-build, and static integrity gates passed during
implementation. The measured CI run also passed all 81 unit tests. This managed
workspace cannot launch Chromium: it fails before page creation with
`socket() failed: Operation not permitted` in Chromium's process singleton, so
the browser measurements above came from GitHub CI. CI installs the browser
pinned by Playwright and deploys the exact verified `site/` artifact without
rebuilding it after the complete workflow passes.


### Ordinary input on a medium v3 project

The production input lab ran on Chromium 159.0.8154.6 with an AMD EPYC 9V74
host, a four-core cgroup quota and 16 GiB of memory. It used the clean build at
`c04f6a93a058592659244370ba6ea1fcb74749d5`. This revision changes the
measurement script and uses the same app source as its parent
`02bc15949cf8ced80252e3e110c65b6f06e53a11`.

Each profile opened a warm-up project and ten measured projects with 50 nodes
and 75 connections. It collected three trusted Outline selections and three
CodeMirror keystrokes per measured project. Each measurement spans the
`pointerdown` or `keydown` timestamp to the animation frame following the DOM
change. The returned draft keystrokes leave the accepted source untouched.
Mobile selection uses touch emulation. Mobile typing uses Chromium keyboard
injection at a 390 × 844 viewport and 4× CPU throttling. Desktop is
1280 × 900 at 1×. The first run overlapped a local browser suite. The repeated
run had no concurrent local browser tests.

| Run | Profile | Outline selection p95 / max | Typing p95 / max |
| --- | --- | --- | --- |
| Concurrent browser suite | Desktop | 160.1 / 190.1 ms | 153.8 / 247.8 ms |
| Concurrent browser suite | Throttled mobile | 58.2 / 63.7 ms | 38.5 / 48.9 ms |
| Isolated repeat | Desktop | 80.8 / 180.6 ms | 200.1 / 225.5 ms |
| Isolated repeat | Throttled mobile | 69.1 / 79.1 ms | 49.2 / 57.7 ms |

Desktop typing exceeded the 100 ms p95 target on both runs. Desktop selection
exceeded the target on the concurrent run and met it in the isolated repeat.
Both actions met the target in the throttled browser profile. Physical phone
input, IME composition, other fixture sizes and input while an explicit layout
candidate is rendering remain open. The existing layout timing report keeps
automatic preview unavailable.

Build Pages from a clean commit, serve its `site` directory, and run
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173/ node scripts/measure-layout-review.mjs --input`.
The JSON records the exact artifact, host limits and individual samples.

### Current input across four graph sizes

The current Pages lab artifact `32e2015581bd172e63b770c8222910412d73c6fe` uses application source `9a04ff7e52a8f67314c56df0da30c42805c5912c`. Chromium 159.0.8154.6 ran on Linux 6.18.57 and an AMD EPYC 9V74 host with a four-core quota and 16 GiB memory ceiling. It loaded the production files over loopback. Desktop used a 1280 × 900 viewport at 1×. The phone viewport was 390 × 844 at 4× CPU throttling, with touch emulation for selection and Chromium keyboard injection for typing.

Each graph size used one warm-up and ten distinct fixtures. Three Outline selections and three source keystrokes per fixture produced 30 samples per action and profile. The input tool timed trusted events through the animation frame after the expected UI state, after the foreground drawing settled. The larger measurements overlapped local artifact builds.

| Nodes and connections | Profile | Selection median / p95 / max (ms) | Typing median / p95 / max (ms) |
| --- | --- | --- | --- |
| 10 / 15 | Desktop | 64.0 / 80.1 / 130.7 | 42.8 / 56.5 / 56.6 |
| 10 / 15 | Throttled phone viewport | 45.4 / 64.0 / 98.6 | 24.8 / 33.7 / 34.7 |
| 50 / 75 | Desktop | 64.0 / 81.2 / 114.4 | 40.6 / 57.1 / 57.4 |
| 50 / 75 | Throttled phone viewport | 49.6 / 66.7 / 70.5 | 24.5 / 47.2 / 51.5 |
| 150 / 225 | Desktop | 64.0 / 80.7 / 80.7 | 43.6 / 78.7 / 111.3 |
| 150 / 225 | Throttled phone viewport | 46.9 / 141.7 / 193.5 | 25.0 / 35.2 / 38.6 |
| 200 / 300 | Desktop | 64.1 / 162.7 / 223.8 | 48.0 / 72.6 / 77.8 |
| 200 / 300 | Throttled phone viewport | 44.7 / 74.3 / 97.6 | 20.2 / 33.3 / 33.5 |

All 480 actions returned the expected feedback. The 10- and 50-node fixtures met the 100 ms p95 ordinary-input budget in both profiles. Selection exceeded 100 ms p95 at 150 nodes on the throttled profile and at 200 nodes on desktop. Explicit layout review stays in place because the separate automatic-preview blocking test exceeded its budget. These runs leave physical mobile input, additional graph shapes and separate layout phase timings open.

Use the same input command with `--nodes=10`, `--nodes=50`, `--nodes=150` or `--nodes=200` to reproduce each row pair.

### Readability processing and visible results

The same artifact and Chromium profiles drew ten 50-node, 75-connection fixtures after one warm-up. Each settled drawing received three Readability checks via a trusted click or tap. The lab sampled the worker round trip from sending the measured drawing facts to receiving its complete report, including crossings. It separately timed the complete interaction through the animation frame after the results settled. Local artifact verification overlapped the phone run.

| Profile | Worker round trip median / p95 / max (ms) | Visible report median / p95 / max (ms) |
| --- | --- | --- |
| Desktop | 19.2 / 56.4 / 58.1 | 94.4 / 147.2 / 148.1 |
| Throttled phone viewport | 36.6 / 61.1 / 74.4 | 115.4 / 191.1 / 387.4 |

All 60 checks reused the settled drawing. A DOM observer saw zero new Mermaid renderer hosts. Worker time stayed below 100 ms in both profiles. The visible report exceeded 100 ms p95 in both profiles, so complete readiness retains explicit activation. Additional physical device and layout phase evidence remains open.

Run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173/ node scripts/measure-layout-review.mjs --readability` against a clean Pages artifact. The JSON contains both timing samples for each interaction.
