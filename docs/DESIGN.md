# Visual design behavior

Meridian keeps Mermaid as the source of diagram topology. The project contains an additional `design` object with a preset identifier and a map of optional element overrides. Exporting Mermaid text returns the authored source unchanged; exporting a project preserves the overrides as well.

## Presets and selection

Executive, Infrastructure, Cyberpunk, Minimal, and Technical Blueprint coordinate the theme, layout, motion, surface, typography, frame, and background settings. Applying a preset retains per-element overrides. Manual global settings mark the preset as custom. Reset all styling returns the existing Meridian defaults and clears individual overrides.

Select an element on the canvas or from the element selector. The inspector shows only the controls its renderer supports. Connector hit areas extend beyond the visible stroke to make thin lines selectable, and labels select their associated connector. Keyboard users can use the element selector or focus a rendered element and press Enter or Space.

## Flowchart capabilities

- Nodes: seven native shapes, measured font family/size/weight, fill/text/border colors, stroke width and pattern, shadow, glow, and emphasis.
- Connections: stroke and label styling, arrowhead variants, line pattern/weight and effects. Dagre supports per-edge smooth, direct, or orthogonal-style curves.
- Groups: boundary and label styling, effects, and logical member spotlighting.
- Refine layout chooses more spacious Dagre placement for small flows and native layered ELK placement for larger or grouped graphs. ELK exposes its native routing controls; arbitrary spacing and individual curves remain unavailable under ELK.

The renderer parses a flowchart using the pinned Mermaid API and appends bounded shape/font commands to a temporary copy before geometry is calculated. Original source style declarations survive these commands. Rendering applies declarative SVG decoration afterward and sanitizes the result. The text in the editor is not rewritten.

Other diagram types retain their own native layout. Their supported elements expose styling when a stable source identity is available; unsupported controls are omitted.

## Stable identities

Nodes and groups use source IDs. Connections use explicit source edge IDs when supplied; otherwise identity combines endpoint IDs, label, and an ordinal for identical parallel connections. Inserting an unrelated edge does not change its identity. Renaming an endpoint or changing an implicit connection label creates a new identity. Overrides for missing elements stay in the project, allowing undoing source edits to recover their style; they do not attach to unrelated elements.

## Compatibility

The v2 project schema strictly validates each design property and rejects unknown fields, executable CSS values, prototype keys and unbounded numeric values. Existing v1 projects migrate without changing source text. Browser writes use `meridian:v2`; the previous `meridian:v1` entry remains untouched. Corrupt newer data produces a recovery warning rather than silently loading and overwriting it with an older workspace.

SVG and PNG exports preserve element styling and remove editor selection state. Animated HTML preserves the same diagram appearance. Third-party dependency notices remain bundled with the app.
