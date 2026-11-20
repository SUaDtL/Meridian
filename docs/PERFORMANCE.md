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

The integrated hosted build after the split measured 335,861 uncompressed
bytes in its welcome dependency graph, including HTML, CSS, JavaScript, and the
favicon. That is approximately 95.1% fewer initial bytes than the preceding
single-file release. The earlier build with the same loading boundaries measured
279,297 initial JavaScript bytes out of 5,990,927 JavaScript bytes in the complete
site: approximately 4.7%. These are local build measurements, not browser timing
claims; the release's exact values are recorded in its generated `build.json`.

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
implementation. This managed workspace cannot launch Chromium: it fails before
page creation with `socket() failed: Operation not permitted` in Chromium's
process singleton. Browser assertions, pixel comparisons, and their attached
work counters must therefore pass in the GitHub workflow before release. CI
installs the browser pinned by Playwright; it deploys the exact verified `site/`
artifact without rebuilding it.
