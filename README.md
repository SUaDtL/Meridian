# Meridian

A presentation-grade, browser-based Mermaid diagram studio. Meridian turns familiar Mermaid source into polished diagrams with live editing, themes, purposeful motion, pan/zoom, and portable exports.

This is the independent repository **SUaDtL/Meridian**. Its GitHub Pages workflow publishes only this repository. Integration with `arbiterforge.com`, `arbiterForge/arbiterforge-site`, or `SUaDtL/SIM` requires separate approval.

## Features

- React and TypeScript studio using pinned Mermaid 12.3.0.
- A welcome screen with an empty-canvas start, searchable examples, file import, and recent-project continuation.
- Direct canvas heading editing and bounded session undo/redo for source, design, headings, and scenes.
- Live source editing with last-known-good recovery when syntax is incomplete.
- Ten examples, six themes, node accents and spotlight, layout controls, pan/zoom, presentation mode, and replay.
- Browser-local projects, autosave, `.mmd` import, and portable `.meridian.json` project files.
- Select a solid flowchart connector in Dagre and set its minimum rank span to reserve more space along the flow direction. The project retains this constraint across exports and reopening. Source text, labels, and element identities stay intact.
- A storyboard composer with named scenes, progressive reveals, selected connector flow, camera regions, timing, and playback.
- SVG, high-resolution PNG, and standalone HTML presentations with offline scene playback.
- Download a widescreen PDF or PowerPoint deck with the full diagram or one page per storyboard scene. Each page contains a fixed image. Scene visibility and camera framing carry over, and private presenter notes stay local. Charts also export as single-page PDFs and PowerPoint slides.
- Mobile Canvas, Source, Style, and Story panels and reduced-motion support.
- No backend, accounts, API keys, telemetry, runtime CDNs, or external runtime assets.

## Design inspector

Choose Executive, Infrastructure, Cyberpunk, Minimal, or Technical Blueprint for a coordinated starting point. Select a supported node, connector, or group on the canvas, or use the element selector, to edit its properties. Individual overrides remain in the project when applying another preset.

Flowcharts expose node shapes, typography, fill/text/border colors, line patterns, arrowheads, shadows, glow, and emphasis. Shape and font overrides are applied to a temporary rendering copy before layout; the Mermaid text and downloaded `.mmd` remain unchanged. Dagre exposes per-connector curves and density; ELK uses its supported layered routing controls. Other diagram families retain their existing themes and expose only properties supported by their renderer.

Projects now use `meridian/v2`. Version 1 files and the existing browser workspace migrate automatically. The previous browser storage entry is retained, while subsequent writes use a separate v2 entry. Download project JSON to keep source and all styling together.

## Presentation storyboard

Open **Storyboard** in the side panel, or **Story** on mobile. Create a scene, choose its visible elements, and duplicate it to reveal more of the diagram in the next scene. Add a spotlight, choose the connectors that should show flow, and set a camera region. Arrange the scenes and adjust their duration, transition time, and easing. Selecting a scene shows its settled composition; playing shows the entrance transition. Timing fields commit on blur or Enter and cancel with Escape.

The playhead previews the exact sequence; scrubbing pauses playback. **Present** plays the storyboard with the editing panels hidden. **Export → HTML** creates a self-contained presentation using the same playback engine, with previous/next scene, replay, timeline, loop, and fullscreen controls. Reduced-motion preferences suppress camera interpolation and moving flow while retaining the scene content and controls.

Scenes and their stable element references are saved in project JSON without rewriting Mermaid source. SVG and PNG exports remain complete static diagrams. See [STORYBOARD.md](docs/STORYBOARD.md) for the complete workflow, timing semantics, and diagram targeting limits.

## Development

Use the Node version in `.nvmrc` and the committed lockfile:

```sh
npm ci
npm run dev
```

The authoring source is in `src/`. Edit source files and rebuild; do not edit compiled HTML or `bundle/meridian.part-*` by hand.

## Build and verify

```sh
npm ci
npm run verify:legacy
npm test
npm run build:pages
npm run verify:artifact
npm run build:standalone
npm run verify:standalone
npx playwright install --with-deps chromium
npm run test:browser
```

`npm run build:pages` typechecks and compiles a split static site from source. The welcome screen loads a small entry bundle; the studio, editor, and Mermaid renderers load when needed. `site/build.json` records every published file's size and SHA-256 plus the initial dependency graph. The browser suite tests this exact production artifact, including onboarding, heading edits, undo, persistence and recovery, actual imports/downloads, presentation controls, mobile panels, performance work counts, and visual comparisons against the archived application. The separate standalone build is also tested without network access.

Additional builds:

| Command | Output | Purpose |
| --- | --- | --- |
| `npm run build` | `dist/` | Standard Vite build with relative asset URLs |
| `npm run build:standalone` | `standalone/Meridian.html` | Portable application in one HTML file |
| `npm run build:pages` | `site/` | Split hosted application with hashed local assets and an integrity receipt |
| `npm run test:visual` | Browser report attachments | Published-reference comparisons across themes and diagram types |

## Source recovery and regression reference

The original React/TypeScript authoring project has been recovered. Rebuilding it reproduced the published application's JavaScript **byte for byte**. [Source provenance](docs/SOURCE-PROVENANCE.md) records the hashes and the small HTML metadata/line-ending differences.

The eight historical bundle pieces remain a frozen regression reference. Their original SHA-256 guard is unchanged. `scripts/assemble.py` reconstructs that reference into `public/index.html`; it is no longer the publication build. The source-built application is published only after the independent integrity and browser checks pass.

## Deployment

The workflow validates pull requests and deploys only a successful push or manual dispatch on `main`. The deploy job receives the exact artifact that passed verification; it does not rebuild it. GitHub Pages must use **GitHub Actions** as its source. See [DEPLOYMENT.md](DEPLOYMENT.md).

The preview remains `noindex`. There is no `CNAME` or custom-domain automation. Hosted code loads only from this site's local assets; the Content Security Policy disallows runtime data connections. The optional portable application instead authorizes its embedded module with an exact SHA-256 hash. Autosaves remain in the visitor's browser.

See [the usability pass](docs/USABILITY.md) for workflow decisions and [performance evidence](docs/PERFORMANCE.md) for loading boundaries, caching, cancellation, and verification.
