# Meridian Pages preview: deployment and approval boundary

## Repository scope

Publish **SUaDtL/Meridian** only to its own GitHub Pages preview. No `CNAME`, custom domain, DNS modifications, shared-site navigation changes, or writes to `arbiterForge/arbiterforge-site` or `SUaDtL/SIM` are part of this workflow. A later integration with `arbiterforge.com` requires separate explicit approval.

## Source build and verification

1. Work on a feature branch and open a PR against `main`.
2. CI installs exact dependencies with `npm ci` and the Node version from `.nvmrc`.
3. `npm run verify:legacy` reconstructs and checks the archived published bundle. Its original checksum is unchanged.
4. `npm test` verifies renderer and document boundaries.
5. `npm run build:pages` builds from React/TypeScript source into the self-contained `site/index.html` artifact and a SHA-256 receipt in `site/build.json`.
6. `npm run verify:artifact` checks the deployable artifact, including the inline script hash, preview metadata, embedded resources, and repository isolation.
7. Playwright tests that production artifact and compares its default diagram appearance with the archived application in the same pinned Chromium browser. Browser evidence is retained as a workflow artifact.
8. After all checks pass, a merge to `main` runs the same verification. The deploy job publishes those exact verified bytes to this repository's Pages environment.

PR checks do not publish. Deployment requires `github.ref == 'refs/heads/main'` and a successful verification job. Only the deploy job receives Pages/OIDC write permissions.

## Local reproduction

```sh
npm ci
npm run verify:legacy
npm test
npm run build:pages
npm run verify:artifact
npx playwright install --with-deps chromium
npm run test:browser
```

The browser configuration starts the candidate at port 4173 and the historical reference at port 4174. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a locally installed browser. CI uses the browser pinned by the Playwright dependency.

For a quick manual inspection, run `python3 -m http.server 8000 --directory site`. The optional standard Vite output in `dist/` is available with `npm run build`, but Pages intentionally publishes the self-contained source build.

## Verify a publication

Use the URL reported by the deploy job, normally `https://suadtl.github.io/Meridian/`. Verify HTTPS, editor/rendering, themes, presentation mode, project import/export, mobile panels, and reduced motion. Compare the retrieved HTML's SHA-256 with `build.json` if verifying exact deployment bytes.

The build receipt names the source commit and artifact hash. An uncommitted local build may include working-copy changes; CI always builds the checked-out commit.

## Rollback

Revert the relevant `main` commit and allow the normal checks and deployment to run, or disable this repository's Pages deployment. Do not overwrite the historical bundle guard to roll back a source build. No shared site or DNS migration is involved.
