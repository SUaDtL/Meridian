# Studio usability pass

This pass makes the existing diagram and presentation features easier to discover, more predictable to edit, and cheaper to update. The retained product model is Mermaid source plus visual and presentation metadata. Projects and exports remain portable and local to the browser.

## Entry and everyday work

Meridian now opens on a welcome screen. A new visit has three explicit choices: **Start from scratch**, **Browse examples**, and **Import a project or Mermaid file**. Starting from scratch creates an empty source document and an instructional canvas. It does not insert a sample graph. Examples are searchable by title, description, and diagram category, and each opens as a separate project.

Returning users see **Continue** for the previously active project plus recent projects. Home returns here without discarding work. Project management offers search, import, a new-project chooser, duplication, downloads, and removal. Removing the final project returns to an empty workspace. An immediate Undo restores a deleted project.

The heading has one shared editor. Click the title or subtitle on the canvas, or the pencil beside the project name. The dialog focuses the chosen field, supports Enter to apply and Escape to cancel, and controls whether the heading appears on the canvas. The inspector links to this editor instead of maintaining a second set of title fields. A heading change updates framing without relaying out the diagram. Long headings are measured against the export frame so wide letters do not overflow.

## Reversible editing and persistence

The toolbar exposes Undo and Redo for the current project editing session. Whole-document snapshots make a preset or style reset atomic. Rapid typing and changes to the same control are grouped; changes to different element properties and scene structure remain distinct. History is bounded to 50 entries and an estimated 8 MB. Switching projects starts a new edit history; source editor typing retains its native CodeMirror undo behavior. History is not a permanent revision archive.

Workspace state, persistence, and diagram rendering are separate modules. Autosave runs only when the workspace changes and flushes dirty state when the page is hidden. Opening the welcome screen does not write fabricated projects. Save failures are shown as failures. An unreadable saved workspace is retained, with options to download its original bytes, import a backup, or explicitly use the current in-memory workspace. Changes from another tab pause autosave and offer a controlled reload.

If an editing tool fails to load, the application keeps the workspace available and provides project download, Home, and Reload actions. Error notifications use an error treatment rather than a success checkmark. Notifications and Undo actions stay inside an open dialog's focus boundary; outside dialogs, notifications sit above the canvas controls.

## Design controls

The inspector has two scopes: **Diagram** and **Selected**. The element picker stays available, with search on larger diagrams. Theme choices stay visible; preset choices use a compact disclosure; Layout, Effects, and Canvas controls are progressively disclosed. This reduces the length of the initial panel while retaining the full feature set.

Selected-element fields read the actual rendered appearance when no override exists. This fixes misleading inherited font sizes and decimal line weights. Each property can return to inheritance independently. Numeric fields retain a draft while typing and commit valid values; hexadecimal color fields validate before applying. Quick fills and the main fill control share one style operation. Existing node accents remain readable and resettable without a competing new accent workflow. Unlabeled connections explain why text styling is unavailable.

Presets, layout refinement, and selected-style resets apply as one document update. Source-authored group borders survive typography changes. Frame and effects edits preserve the Infrastructure preset's routing mode; the inspector identifies modified preset settings. Supported source and diagram capabilities still determine which controls are shown.

## Storyboard and presentation

Selecting a scene previews its settled composition. Previous/Next use that same behavior while paused; during playback they begin the destination scene's entrance. Timeline scrubbing remains an exact time seek. The editor identifies the current preview and keeps selection aligned with navigation. Active playback provides a Pause-to-edit action so changing fields cannot silently fight the playhead.

Duration and transition fields accept a complete draft instead of clamping each keystroke. Enter or blur commits; Escape restores the previous value. Scene deletion and explicit removal of missing targets have Undo. Missing IDs are retained unless the user chooses cleanup. Target lists mount when opened, show a bounded page of results, and support search and canvas selection.

On mobile, Preview this scene opens Canvas. Present can start from Story and returns to that panel on exit. Inactive panels are hidden and inert so keyboard focus cannot move behind them. The stage restores the editing camera after presentation. Reduced-motion preferences continue to suppress moving effects while retaining scene contents.

## Exports

Export formats describe their purpose: a still PNG, scalable SVG, offline HTML presentation, editable Project, or Mermaid source. PNG resolution shows its exact final dimensions and identifies browser size limits before download. The calculation is shared with rasterization. A stale render offers Render now; a syntax error or blank source offers Open source. Project and source downloads remain available. Busy exports disable conflicting actions and dialog closure.

## Removed duplicate work

Application entry, the studio, project persistence, render lifecycle, and focused dialogs have separate responsibilities. Home and the new-project dialog share the same start choices. Heading edits share one form. Downloads share one Blob lifecycle and filename helper. Inspector fields share control implementations. PNG sizing is calculated once. Studio preview and HTML export share one self-contained storyboard runtime.

Rendering now separates frame updates, decoration, and Mermaid layout. Latest-only scheduling drops obsolete waiting work, and bounded caches reuse sanitized layouts and completed results. Frame building returns SVG and dimensions together. Scene edits keep the existing SVG DOM, and playback precomputes target lookups and avoids redundant static writes. Source editor configuration and callback identities stay stable. See [PERFORMANCE.md](PERFORMANCE.md) for measurements and limits.

## Verification and limits

The production browser suite covers these workflows using isolated projects, so validation does not modify a user's real browser workspace. Existing six-theme and ten-example pixel comparisons remain in place. Local unit/build/integrity checks and the GitHub browser workflow are separate evidence; a local browser launch failure is never reported as a passed browser test.

Automated UI coverage uses pinned Chromium. Physical touch hardware, screen-reader behavior, and Safari/Firefox still need device-specific validation. Loading-byte reductions and eliminated render work are measurable. Frame rate and load time depend on the device and document.

## Manual acceptance sessions

Record the Meridian build SHA, device model, OS, browser, screen reader version, input method, viewport and zoom for each run. Start with a clean browser profile and a fresh copy of the fixture for each comparison. Use a desktop screen reader and a phone screen reader with touch. Also run keyboard-only, touch without dragging, 200% zoom, forced colors or the platform high-contrast setting, and reduced motion. Record the action, control or announcement where each error occurred and how the participant recovered.

| Task | Expected evidence |
| --- | --- |
| Create a five-step process, branch to Approve or Reject and join at End | Both routes reach End. Any proposed cross-branch connection is noticed and reviewed. Reorder, branch and join with keyboard and tap controls. |
| Rename and connect two nodes with the same visible label | The author can distinguish endpoints, identify a deliberately wrong endpoint, return from the review dialog and keep the intended selection. |
| Filter a bulk selection, fix low contrast and compare two layouts | Hidden selections are discoverable and the retained scope is correct. The author can explain the tradeoff between fewer crossings and smaller viewed labels. |
| Insert a component through a named port and generate a group story | The chosen port, scene visibility and path are understood. Playback settles with reduced motion and the focus return is logical. |
| Recover a stale preview and export the accepted project | A second tab edits the document after preview. The author notices the refusal, keeps the review inputs, rebuilds the preview, and reopens the accepted local export. |
| Read a chart in studio and downloaded HTML with the network disabled | The author identifies the two axes, units, one value and its aggregation from the chart and displayed-values table. Source data is a separate view. |

For the chart task, import the CSV below. Confirm Requests as a number, set its unit to requests, and enable **Treat empty fields as missing**. Choose a bar chart with Team on the category axis and Requests on the value axis. Aggregate duplicate categories with Sum and set the Y domain to 0–0.4. Ask the author to find North, explain the contribution of the missing value, and identify that South is outside the domain. North is 0.3 requests from two present values across three source rows. South remains in the displayed-values table with its exclusion status.

```csv
Team,Requests
North,0.1
North,0.2
North,
South,0.5
```

Recruit 8–12 consenting participants across Mermaid novices, occasional technical authors and experienced authors, including people who use accessibility features. Counterbalance equivalent archived-app and current-build tasks and preserve each task’s start conditions. For each attempt record completion, topology correctness, wrong-endpoint detection, recovery, abandonment, confidence and elapsed time. Keep observations deidentified. Run the assistant file-flow comparison on the approved pilot separately and include file handling, sign-in and stale recovery in the timing.
