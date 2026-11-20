# Meridian engineering instructions

## Repository and release boundaries

This is the **independent** personal account repository `SUaDtL/Meridian`, similar to `SUaDtL/SIM`. No code, workflow, link or domain change may be made to `arbiterForge/arbiterforge-site`, `arbiterforge.com`, or `SUaDtL/SIM` without the user's separate explicit approval. No `CNAME` and no custom-domain automation. Keep Pages publishing scoped to this repository.

## Development workflow

1. Work on a feature branch and open PRs against `main`.
2. Run `python3 scripts/assemble.py && python3 tests/validate.py` before proposing a release.
3. The integrity checksum is an intentional guard. Do not change it to hide a corrupted bundle; provide provenance, rebuild evidence and regression tests when changing the app.
4. Preserve Mermaid source, canvas behaviors, keyboard shortcuts, theme controls, local persistence, SVG/PNG/HTML export, reduced-motion behavior, and mobile panels.
5. Before merging, obtain green workflow checks. Merge triggers a GitHub Pages deploy; do not claim a public live URL until verified.

## Architectural debt

The first implementation is a compiled React/Mermaid single-page application recovered from the prior build, split only to accommodate GitHub connector upload limits. The parts are **not** maintainable authoring source. Restore a genuine source tree as a dedicated follow-up without regressing the working preview. Preserve dependency licenses. Avoid introducing credentials, external runtime network calls, unnecessary telemetry, or Mermaid input XSS.
