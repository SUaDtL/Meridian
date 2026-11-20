# Meridian engineering instructions

## Repository and release boundaries

This is the **independent** personal account repository `SUaDtL/Meridian`, similar to `SUaDtL/SIM`. No code, workflow, link or domain change may be made to `arbiterForge/arbiterforge-site`, `arbiterforge.com`, or `SUaDtL/SIM` without the user's separate explicit approval. No `CNAME` and no custom-domain automation. Keep Pages publishing scoped to this repository.

## Development workflow

1. Work on a feature branch and open PRs against `main`.
2. Run `python3 scripts/assemble.py && python3 tests/validate.py` before proposing a release.
3. The integrity checksum is an intentional guard. Do not change it to hide a corrupted bundle; provide provenance, rebuild evidence and regression tests when changing the app.
4. Preserve Mermaid source, canvas behaviors, keyboard shortcuts, theme controls, local persistence, SVG/PNG/HTML export, reduced-motion behavior, and mobile panels.
5. Before merging, obtain green workflow checks. Merge triggers a GitHub Pages deploy; do not claim a public live URL until verified.

## Source and architectural boundaries

The maintained authoring source is the React/TypeScript project in `src/`, with pinned dependencies and a committed lockfile. The original eight compiled bundle parts are an archived regression reference, **not** editable source. The source-built Pages artifact must pass its integrity checks and browser suite before publication. Preserve dependency licenses and backward-compatible project imports. Keep design overrides and storyboard scenes separate from the user's Mermaid text. Avoid introducing credentials, external runtime network calls, unnecessary telemetry, or Mermaid input XSS.
