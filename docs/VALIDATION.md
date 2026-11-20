# Validation and evidence

## Usability and performance acceptance

The current release gates extend the original comparisons with real browser workflows:

- A clean visit creates no project and initializes neither Mermaid nor CodeMirror. Scratch opens empty; example selection and import create only the chosen project.
- Returning visits show recent projects. Continue preserves source, appearance, headings, and scenes.
- Canvas headings open a focused keyboard-accessible editor, support cancel and undo/redo, and do not invoke Mermaid layout.
- Project deletion has immediate recovery; deleting the final project does not seed a replacement example.
- Corrupt data is preserved while new work can be exported; cross-tab changes pause autosave and offer explicit reload.
- Style controls reflect inherited source values, retain precise decimal widths, reset individual properties, and avoid ineffective typography controls on unlabeled connections.
- Scene selection and paused navigation show settled compositions, while playback shows entrances. Timing input commits deliberately, deletion and missing-reference cleanup can be undone, and large target lists are searched and bounded.
- Mobile inactive panels are hidden and inert. Presentation from Story returns to that panel after exit.
- PNG dimensions are shown before export using the same size-limit calculation as rasterization.
- Browser instrumentation checks initial dependency bytes, render/decorate work counts, and unchanged SVG identity during scene edits and playback.
- The optional single-file application renders without an HTTP server or network assets.

The six-theme and ten-example pixel comparisons retain the immutable original reference and their existing threshold. Browser reports attach welcome, studio, mobile, inspector, storyboard, export, and comparison screenshots alongside performance counters. No comparison reference or original archive checksum was replaced to accommodate the usability changes.

## Source migration checks

The restored source builds the same executable JavaScript as the published application. See [SOURCE-PROVENANCE.md](SOURCE-PROVENANCE.md) for exact byte counts and hashes.

Local checks completed during source restoration:

- `npm ci` installed the committed dependency graph.
- `npm test` passed 25 renderer-boundary and project-validation tests.
- `npm run build:standalone` typechecked and built the application.
- `npm run build:pages` generated the deployable source-built artifact.
- `npm run verify:artifact` passed inline script CSP, self-contained resource, preview metadata, and repository-isolation checks.

The local managed executor prevented headless Chromium from opening its process-singleton socket before application execution (`socket(): Operation not permitted`). This is an environment launch restriction, not a passed browser test. The GitHub workflow executes browser checks in its runner before it can publish. Its results and retained artifacts are the authoritative evidence for that run.

## Browser regression suite

Tests run against the built Pages artifact, not the development server:

- All ten examples render safe, dimensioned SVG; supported flowchart nodes remain selectable.
- Invalid source retains the last valid diagram, blocks stale picture export, and recovers.
- Source and theme persist through an actual browser reload.
- Real SVG and PNG downloads have valid dimensions; HTML playback works in an offline context.
- Downloaded project JSON round-trips through the actual file input and receives a fresh project identity.
- Mobile Canvas/Source/Style panels remain accessible, presentation exits correctly, and reduced-motion preferences suppress animation.
- Default appearance is compared against the archived published application across six themes and all supplied diagram families in the same browser. Current/reference screenshots and any difference image are attached to the report.

## Reproduce

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

The verification job uploads `meridian-browser-evidence-<attempt>` and the exact site bytes. Pull requests retain them as `meridian-verified-site-<attempt>`. Main uploads them as `github-pages-<attempt>`, then the deployment job publishes that artifact without rebuilding or re-uploading it. Inspect the workflow conclusion and its artifacts when reviewing a change.

## Coverage limits

Chromium is the automated browser target. Physical multi-touch hardware, screen-reader operation, Firefox, Safari, and arbitrarily large diagrams are not covered by this suite. Local file behavior depends on browser storage and clipboard policies; hosted HTTP is the primary verified path.
