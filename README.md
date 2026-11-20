# Meridian

A presentation-grade, browser-based Mermaid diagram studio. Meridian converts familiar Mermaid source into visually polished diagrams, with live editing, themes, purposeful motion, pan/zoom, and portable exports.

**Independent preview:** This is the standalone personal repository `SUaDtL/Meridian`, modeled after the independent `SUaDtL/SIM` project. This repository has no custom domain and no connection to the ArbiterForge site's publication pipeline. A future `arbiterforge.com` integration requires separate explicit approval.

## Features

- React-based studio with Mermaid 12.3.0, a live source editor and last-known-good error recovery
- Ten sample diagrams, a large pan/zoom canvas, fit, presentation mode and replay
- Six themes, diagram layout/style controls, per-node emphasis where the Mermaid format supports it, reduced-motion support
- Local project persistence, import/export of `.mmd` and project JSON
- SVG, high-resolution PNG and standalone animated HTML export
- Mobile-friendly Canvas, Source and Style panels
- No backend, API key, accounts, analytics, runtime CDNs, or external runtime assets

## Local preview

The deployable app is a self-contained compiled HTML bundle stored as eight numbered, text-only parts. Assemble it without any external dependencies:

```sh
python3 scripts/assemble.py
python3 tests/validate.py
python3 -m http.server 8000 --directory public
```

Open `http://localhost:8000`. The build script verifies the exact SHA-256 of the recovered app before writing `public/index.html`. You may also open that HTML file directly.

## GitHub Pages

The workflow `.github/workflows/pages.yml` validates every pull request and deploys **only on pushes to `main`** or manual dispatch from `main`. After merging the PR, set **Settings → Pages → Source → GitHub Actions** if it is not already enabled. Use the URL shown by the deploy job, normally `https://suadtl.github.io/Meridian/`.

Do **not** create a `CNAME`, edit DNS, add links from the existing site, modify `SUaDtL/SIM`, or modify `arbiterForge/arbiterforge-site` without separate approval.

## Source and maintainability

This first PR preserves the previously built and tested application **as a compiled bundle**. It is not falsely represented as a reconstructed/unminified React source tree. The third-party license notices bundled by its dependencies remain embedded in the HTML. A follow-up source-recovery or proper Vite/React source migration should preserve the existing features, replace the opaque bundled pieces with maintainable source, lock dependencies, and add browser-level regression tests. Do not edit generated HTML by hand.

## Security

Client-side only. The HTML includes a restrictive Content Security Policy, source-sanitization safeguards, and `noindex` for the temporary public preview. Autosaves remain in the viewer's browser. See `DEPLOYMENT.md` for the publish and approval boundary.
