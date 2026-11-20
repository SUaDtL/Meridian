# Meridian Pages preview: deployment and approval boundary

## Repository scope

Publish **SUaDtL/Meridian** only to its own GitHub Pages preview. No `CNAME`, custom domain, DNS modifications, shared-site navigation changes, or writes to `arbiterForge/arbiterforge-site` or `SUaDtL/SIM` are part of this workflow. A later integration with `arbiterforge.com` requires separate explicit approval.

## Source build and verification

1. Work on a feature branch and open a PR against `main`.
2. CI installs exact dependencies with `npm ci` and the Node version from `.nvmrc`.
3. `npm run verify:legacy` reconstructs and checks the archived published bundle. Its original checksum is unchanged.
4. `npm test` verifies renderer and document boundaries.
5. `npm run build:pages` builds a split static site from React/TypeScript source into `site/`. `site/build.json` inventories all local assets with SHA-256 and byte counts, including the initial dependency graph.
6. `npm run verify:artifact` checks every inventoried file, local script/style paths, CSP, preview metadata, and repository isolation. `build:standalone` and `verify:standalone` separately build and check the portable application and its exact inline script hash.
7. Playwright tests the hosted production artifact and compares its default diagram appearance with the archived application in the same pinned Chromium browser. It also opens the portable application through `file:` with HTTP requests blocked. Browser evidence is retained as a workflow artifact.
8. After all checks pass, a merge to `main` runs the same verification. The deploy job publishes those exact verified bytes to this repository's Pages environment.

PR checks do not publish. Deployment requires `github.ref == 'refs/heads/main'` and a successful verification job. Only the deploy job receives Pages/OIDC write permissions.

## Local reproduction

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

The browser configuration starts the candidate at port 4173 and the historical reference at port 4174. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a locally installed browser. CI uses the browser pinned by the Playwright dependency.

For a quick manual inspection, run `python3 -m http.server 8000 --directory site`. Pages publishes the split Vite build after CSP staging and inventory validation. Copy the complete `site/` folder when hosting it elsewhere; `index.html` alone is not the hosted app. Use `standalone/Meridian.html` when a single offline application file is required.

## Verify a publication

Use the URL reported by the deploy job, normally `https://suadtl.github.io/Meridian/`. Verify HTTPS, editor/rendering, themes, presentation mode, project import/export, mobile panels, and reduced motion. Compare the retrieved HTML's SHA-256 with `build.json` if verifying exact deployment bytes.

The build receipt names the source commit and every artifact hash. Its `workingTreeDirty` flag identifies uncommitted local builds; CI builds the checked-out commit and publishes the same verified folder.

## Rollback

Revert the relevant `main` commit and allow the normal checks and deployment to run, or disable this repository's Pages deployment. Do not overwrite the historical bundle guard to roll back a source build. No shared site or DNS migration is involved.
