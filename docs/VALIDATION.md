# Validation and evidence

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
npx playwright install --with-deps chromium
npm run test:browser
```

The workflow uploads `meridian-browser-evidence` and the exact `meridian-verified-site`. Publication uses the verified site artifact without rebuilding. Inspect both the workflow conclusion and those attachments when reviewing a change.

## Coverage limits

Chromium is the automated browser target. Physical multi-touch hardware, screen-reader operation, Firefox, Safari, and arbitrarily large diagrams are not covered by this suite. Local file behavior depends on browser storage and clipboard policies; hosted HTTP is the primary verified path.
