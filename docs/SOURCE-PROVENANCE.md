# Authoring source recovery

## Reference

The previously published application was introduced by commit `17b45b4a90d622d47737d3b68fd9fac4caa96c8a`. It remains in the repository as eight `bundle/meridian.part-*` files. `scripts/assemble.py` verifies all eight parts, byte count, and the original SHA-256 before reconstructing the reference.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Published application | 6,761,234 | `1b1e9771b4a5348f56ba1a0b4124ef2f59fba94d7b8c8525fac3a80b1521e6c2` |
| Recovered original standalone HTML | 6,762,033 | `c6e6b9ce63357a7c8082cd7bea0273c7c0a6386c5729435033fe081718826b9f` |
| Embedded application module, identical in both | 5,942,997 | `e332f46862d746703e59d3135ec945c20055ab9893983ff301cff2a44d9b2f8c` |

## Recovery method and evidence

The original authoring workspace was available locally, including React components, TypeScript types, rendering/storage/export modules, Vite configuration, the dependency lockfile, and existing unit/browser tests. These authoring files were restored into this repository. The executable identity below establishes their provenance; the source was not reverse engineered from the compiled bundle.

After `npm ci`, a fresh `npm run build:standalone` reproduced the embedded JavaScript hash above exactly. The compiler output's inline script authorization was `sha256-4zL0aGLXRnA+WdMTXslFwgBVq5iTmD/zAc/ypE2bL4w=`. The source, locked dependencies, and build thus reproduce the deployed application code.

Whole-HTML differences between the original recovered file and the published file were limited to:

- The published preview includes `<meta name="robots" content="noindex, nofollow" />`.
- The published file normalized CRLF line endings in dependency notices. The executable module is byte-identical; newline normalization must never be applied indiscriminately to JavaScript.

Adding the preview metadata to `index.html` preserves the intended publication behavior. Pinning all direct dependency specifications and adding development test tools intentionally changes generated attribution metadata, so subsequent whole-file hashes need not equal the archived preview hash.

## Ongoing builds

`src/` and the lockfile are now the authoring source of truth. CI builds a fresh standalone artifact and calculates its CSP authorization and artifact digest. The archived bundle and its original integrity guard stay unchanged and serve as a stable regression reference.

The browser visual suite renders the candidate and the archived reference using the same browser, fonts, viewport, diagram examples, and themes. It compares normalized screenshots of the diagram itself, independently of editor-panel changes. Reports retain current/reference images and differences when a comparison fails. Intentional visual changes require an explicit test expectation decision and evidence; updating a checksum is not a substitute for checking behavior.
