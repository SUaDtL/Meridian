# Meridian architecture

## Source, rendering, and presentation

Meridian keeps ordinary Mermaid text as the diagram source. React owns the studio
interface and document state; Mermaid parses and lays out the diagram; the visual
adapter enhances the resulting SVG. Presentation settings live beside the source
in a versioned project document.

This separation preserves Mermaid's supported notation without maintaining a
second parser or translating diagrams into an unrelated node editor. Mermaid's
public asynchronous `render` API returns SVG; it is the supported integration
point. See [Mermaid usage](https://mermaid.js.org/config/usage).

Meridian does not claim arbitrary drag-to-rewrite round trips. Pan and zoom change
the viewport. Themes and presentation controls change appearance. Node-specific
accent choices are separate project metadata. Editing the source changes the
diagram's structure.

## Main responsibilities

| Layer | Responsibility |
| --- | --- |
| React studio | Source editing, active document, controls, dialogs, keyboard actions, viewport |
| Mermaid | Grammar, diagram type, graph layout, standard shapes, labels, semantic relationships |
| SVG adapter | Theme treatments, framing, supported node/edge styling, optional motion |
| Export | A portable visual result, independent of the editor's UI |
| Project document | Source plus settings, title/subtitle, node accents, timestamps, schema identity |
| Browser workspace | A bounded list of documents and active-document identity |

The application is a static build. There is no accounts system, cloud document
service, diagram API, or server rendering dependency.

## Rendering choices and limits

The full Mermaid package is intentionally used rather than implementing a
flowchart-only parser. Its published APIs determine syntax support. A diagram
family may render correctly while supporting fewer Meridian-specific visual
effects: flowchart nodes/edges, sequence lifelines, and ER entities have different
SVG structures and semantics. Presentation controls should not imply that every
graph family has identical capabilities.

Mermaid configuration exposes layout, typography, spacing, and theme variables.
Meridian applies an explicit studio configuration instead of depending on the
library's changing defaults. See the
[Mermaid configuration schema](https://mermaid.js.org/config/schema-docs/config.html)
and [theme documentation](https://mermaid.js.org/config/theming.html).

The SVG enhancement layer is the most version-sensitive boundary. Mermaid is
pinned in `package.json` and the dependency graph is locked. When upgrading it,
verify the sample families and exports rather than assuming its internal SVG
class names remain unchanged. Presentation metadata must not alter the user's
source silently.

## Document format

`StudioDocument` in `src/types.ts` is the source of truth. A version 1 file contains:

```json
{
  "schema": "meridian/v1",
  "id": "an-opaque-project-id",
  "title": "A diagram title",
  "subtitle": "Optional context",
  "source": "flowchart LR\n  A[Idea] --> B[Result]",
  "settings": { "...": "all fields defined by StudioSettings" },
  "nodeAccents": { "A": "#5eead4" },
  "updatedAt": "2026-11-19T00:00:00.000Z"
}
```

The settings placeholder above illustrates structure and is not an importable
project. Export an actual document from the application for a complete example.

`src/lib/storage.ts` validates imported files and browser data. Version 1 uses
strict field/type checks and rejects unknown schemas, unexpected fields, invalid
colors, non-finite values, and prototype-related keys. Bounds include 100,000
source characters, 120 title characters, 240 subtitle characters, 1,000 accent
entries, and 50 browser projects. Color values are hexadecimal; imported strings
are not treated as CSS or executable content.

Imports preserve the validated source and settings. The studio assigns a new
document ID when adding an imported project so another project cannot be silently
replaced by a colliding file ID. Surrounding Mermaid Markdown fences may be
removed on plain-text import; unrelated or partial fences are left alone.

## Persistence

The workspace uses the namespaced browser key `meridian:v1` with a separate
workspace `version: 1`. Storage helpers return explicit error results. The UI can
keep editing in memory if storage is blocked or full, and direct the user to
download the project. A failed save must not be displayed as successful.

Local browser storage is neither a cloud backup nor shared collaboration. It is
scoped to an origin and browser profile and may be cleared by the browser or
user. Portable project JSON is the interchange and backup format. Any future
schema migration should read, validate, and preserve old data before replacing it.

## Untrusted source and exported files

Mermaid input can arrive through paste, file import, or a share link. Treat it as
untrusted document content. The renderer uses strict Mermaid security and SVG
sanitization; it must not enable source-supplied script callbacks or remote
resources. Mermaid documents `securityLevel: 'strict'` as encoding HTML labels
and disabling click functionality in its
[security configuration](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html).

SVG exports are generated from the sanitized visual representation. PNG export
rasterizes a still, so motion is not preserved. Animation requires a suitable
SVG/HTML viewer and is not a video format. Keep generated frames and effects
self-contained; a presentation export should not depend on a public diagram API.

Reduced-motion preferences, explicit motion controls, readable labels, and
keyboard access are product behavior, not optional decorative enhancements.

## Deployment boundary

Vite produces a normal static site with relative asset URLs. Hosting a new path
on an existing domain means putting the complete built tree in that path of the
domain's served output. It does not require a new backend. The authorized standalone publication procedure is in
[DEPLOYMENT.md](../DEPLOYMENT.md). Custom-domain or shared-site integration requires
separate approval.

## Useful extension points

- Add a diagram-family adapter when a supported Mermaid family needs a distinct
  treatment; keep the general SVG path as the fallback.
- Add curated examples and theme tokens without changing the document schema.
- Add slide sequencing or a recorded presentation as an explicit document
  feature with a versioned schema, not implicit DOM state.
- Add collaboration only with a separately designed persistence and conflict
  model; local storage should remain a useful independent mode.
- Keep font/image handling and SVG serialization testable at the export boundary.

Exact acceptance results for this build belong in the validation report, not in
architectural promises.
