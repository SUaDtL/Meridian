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
accents, element overrides, and storyboard scenes are separate project metadata.
Geometry-sensitive design changes are applied to a temporary rendering copy so
Mermaid can measure and lay out the adjusted labels and shapes. The saved source
and downloaded `.mmd` remain unchanged. Editing the source changes the diagram's
structure.

## Main responsibilities

| Layer | Responsibility |
| --- | --- |
| Application entry and welcome | Explicit scratch/example/import choice, recent projects, project management, lazy studio loading |
| React studio | Source editing, controls, dialogs, keyboard actions, viewport, presentation coordination |
| Workspace reducer and persistence hook | Atomic document patches, bounded/coalesced undo, dirty-only autosave, cross-tab conflict protection |
| Mermaid | Grammar, diagram type, graph layout, standard shapes, labels, semantic relationships |
| SVG adapter | Theme treatments, framing, supported node/edge styling, optional motion |
| Storyboard | Versioned scene data, deterministic reveals/spotlight/flow, camera regions, timeline playback |
| Export | A portable visual result, independent of the editor's UI |
| Project document | Source plus settings, title/subtitle, node accents, element design, optional storyboard, timestamps, schema identity |
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

The SVG enhancement layer and flowchart graph adapter are the most version-sensitive boundaries. Mermaid is
pinned in `package.json` and the dependency graph is locked. When upgrading it,
verify the sample families and exports rather than assuming its internal SVG
class names remain unchanged. Presentation metadata must not alter the user's
source silently.

## Document format

`StudioDocument` in `src/types.ts` is the source of truth. New projects use
`meridian/v2`; version 1 files remain accepted and are normalized on import. A
version 2 file has this structure:

```json
{
  "schema": "meridian/v2",
  "id": "an-opaque-project-id",
  "title": "A diagram title",
  "subtitle": "Optional context",
  "source": "flowchart LR\n  A[Idea] --> B[Result]",
  "settings": { "...": "all fields defined by StudioSettings" },
  "nodeAccents": { "A": "#5eead4" },
  "design": {
    "preset": "custom",
    "elements": { "node:A": { "fill": "#143c32", "fontSize": 18 } }
  },
  "storyboard": { "version": 1, "scenes": [], "loop": false },
  "updatedAt": "2026-11-19T00:00:00.000Z"
}
```

The settings placeholder above illustrates structure and is not an importable
project. Export an actual document from the application for a complete example.
The `storyboard` field is optional; its absence means there are no authored scenes.
`src/types/design.ts` and `src/types/storyboard.ts` define the sidecar structures.

`src/lib/storage.ts` validates imported files and browser data, delegating design
and storyboard validation to their respective modules. Validation uses
strict field/type checks and rejects unknown schemas, unexpected fields, invalid
colors, non-finite values, and prototype-related keys. Bounds include 100,000
source characters, 120 title characters, 240 subtitle characters, 1,000 accent
entries, 2,000 element styles, 50 scenes per storyboard, and 50 browser projects.
Scene durations range from 0.5 to 120 seconds; transitions cannot exceed either
10 seconds or their own scene duration. Element references remain plain strings,
and colors are hexadecimal. Imported values are not treated as CSS or executable
content.

Imports preserve the validated source and settings. The studio assigns a new
document ID when adding an imported project so another project cannot be silently
replaced by a colliding file ID. Surrounding Mermaid Markdown fences may be
removed on plain-text import; unrelated or partial fences are left alone.

## Persistence

The workspace writes the namespaced browser key `meridian:v2` with a separate
workspace `version: 2`. When no v2 entry exists, it reads and validates
`meridian:v1`; migrating does not delete or modify that old entry. A present but
damaged v2 entry produces a warning instead of falling back to an older copy and
silently losing recent work. Project v1 imports receive an empty design sidecar
and retain their source, settings, node accents, and identity.

Storage helpers return explicit error results. The UI can
keep editing in memory if storage is blocked or full, and direct the user to
download the project. A failed save must not be displayed as successful.

Local browser storage is neither a cloud backup nor shared collaboration. It is
scoped to an origin and browser profile and may be cleared by the browser or
user. Portable project JSON is the interchange and backup format. Any future
schema migration should read, validate, and preserve old data before replacing it.

## Storyboard runtime and identities

`src/lib/storyboard.ts` contains pure validation/timeline helpers and re-exports
the self-contained `createStoryboardPlayer` DOM runtime from `storyboard-runtime.ts`. The studio attaches the
player to the framed SVG only while previewing or presenting. It evaluates the
scene at a specific time, changes element opacity and flow overlays, and animates
the SVG viewBox between measured regions. It does not move the underlying nodes
or change the surrounding pan/zoom transform. Destroying a player restores its
captured styles, accessibility attributes, and original viewBox.

The export module serializes that same compiled function into a portable HTML
presentation and authorizes its exact bytes with a SHA-256 CSP hash. It escapes
all scene titles and JSON data. The exported document needs no renderer, editor,
remote assets, or network connections. Scene plans, target indexes, and final states are cached when the player is created; static styles are not rewritten on every animation frame. The production browser suite opens the
actual downloaded HTML in an offline context to test this boundary after bundling.

Element references use canonical node, group, and edge keys supplied by the
pinned Mermaid adapter. Explicit edge IDs are retained; implicit edge keys use
endpoints, a label hash, and an ordinal among equivalent parallel edges. Missing
references remain in the document so temporary source edits do not discard
scene intent. Unsupported or missing camera targets fall back to the full
diagram. See [STORYBOARD.md](STORYBOARD.md) for user-visible targeting limits.

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
- Extend the versioned storyboard schema for new presentation features; keep
  preview and portable export on the same playback engine.
- Add collaboration only with a separately designed persistence and conflict
  model; local storage should remain a useful independent mode.
- Keep font/image handling and SVG serialization testable at the export boundary.

Exact acceptance results for this build belong in the validation report, not in
architectural promises.

## Render invalidation and loading

`useDiagram` debounces source updates, aborts superseded consumers, and retains the last valid diagram after a parse failure. The renderer separates layout inputs from decorative inputs and document framing. A latest-only queue protects Mermaid's global configuration; bounded LRU caches hold sanitized layout snapshots and complete results. Heading and frame edits do not call the diagram renderer. Scene edits and playback keep the existing framed SVG DOM. See [PERFORMANCE.md](PERFORMANCE.md) for exact cache budgets and observable-work tests.

The hosted entry does not import the diagram engine or code editor. The studio, source editor, export UI, and Mermaid families use lazy local chunks. The optional portable build folds those same sources into one application file. Both outputs are validated independently; the historical bundle remains immutable.
