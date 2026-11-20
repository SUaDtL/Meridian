# Present a diagram as a story

Meridian's storyboard turns one diagram into a sequence of scenes. Each scene
defines what is visible, what is emphasized, where the camera looks, and which
connections show moving flow. The diagram source remains a single Mermaid
document throughout.

## Build the first sequence

1. Render your diagram successfully, then open **Storyboard** in the side panel.
   On a small screen, open **Story** in the bottom navigation. **Design** and
   **Storyboard** switch the right-hand panel between visual styling and presentation
   editing.
2. Choose **Create first scene** and give it a clear title, such as “Introduce
   the networks.” The first scene initially shows the full diagram.
3. Under **Reveal elements**, switch to **Choose elements**. Select the nodes,
   groups, and connectors needed for this part of the explanation. A selection
   made on the canvas can be added directly. Selecting a group includes nested
   members and connectors entirely inside the group.
4. Duplicate the scene, rename the copy, and add the next elements. This keeps
   already-visible elements in place while introducing the next part of the
   diagram. Use the up/down controls to change the scene order.
5. Open **Camera** to fit the whole diagram or focus a region defined by selected
   elements. Adjust **Breathing room** to leave more space around that region.
6. Open **Spotlight** to keep selected elements bright while other visible
   elements recede. Open **Animate a path** to choose the connectors that show
   directional flow during this scene.
7. Set the timing and movement, then play or scrub the timeline. **Present**
   hides the editing panels and starts the sequence from the beginning.

A storyboard supports up to 50 scenes. Scenes can be named, duplicated, removed,
and reordered. Existing scene targets remain saved when their elements are
temporarily absent from the source. Explicit missing-target cleanup and scene deletion offer Undo. Target lists support search and show 40 results at a time before expansion.

## Timing and playback

| Control | Behavior |
| --- | --- |
| Duration | Total scene time, including its entrance transition; 0.5–120 seconds |
| Transition | Time used for the scene's camera movement and new-element fade; 0–10 seconds, bounded by the scene duration |
| Movement | Steady pace, smooth start and finish, or quick start with a gentle finish |
| Reveal together | New elements appear together; elements already visible in the preceding scene remain in place |
| Reveal one by one | New elements enter in their saved selection order, distributed within the scene's available time |
| Preview this scene / select a scene | Pauses on its complete composition and final camera region; explicit Preview opens Canvas on mobile |
| Play / Pause | Runs or holds the timeline; Play from a settled preview starts that scene's entrance |
| Previous / Next | Shows the adjacent scene's settled composition while paused, or begins its entrance while playing |
| Replay | Returns to the beginning and plays |
| Playhead | Scrubs to a precise time and pauses playback |
| Loop | Repeats the sequence when it reaches the end |
| End preview | Restores the full diagram and ordinary editing interactions |

Timing inputs commit on blur or Enter and cancel with Escape. The editor identifies Preview, Paused, and Playing states and offers Pause to edit while playback is active.

The first scene shown with **Reveal together** is immediately visible. Subsequent
new elements use the configured entrance transition. Elements omitted from a
scene disappear at that scene's boundary. A zero-second transition cuts directly
to the new state. Timing is presentation timing, not a simulation of network
latency or actual system traffic.

During presentation, Space plays or pauses, the left/right arrows change scenes,
and Escape exits. Controls retain their normal keyboard behavior when focused.
The exported HTML additionally supports **R** for replay and **F** for fullscreen.

## Camera and targeting

Camera targets use the elements' rendered SVG geometry. Selecting several
targets frames their combined area. Camera movement changes the viewBox of the
presentation SVG; it does not change node positions, connector layout, Mermaid
text, or the studio's normal pan/zoom state. Returning to a scene with **Fit
diagram** moves back to the complete framed diagram.

Element targeting follows the capabilities exposed by the Mermaid adapter:

- Flowcharts expose stable nodes, connectors, and supported groups. They support
  the complete scene targeting workflow.
- Other Mermaid families can always use full-diagram scenes and presentation
  controls. Individual targeting is available only for elements the adapter
  identifies reliably. An unavailable connector list is accompanied by an
  explanation instead of invented targets.
- Moving flow requires path-based connectors. It is a visual explanation effect
  and does not represent live traffic.
- Node and group identities follow their source IDs. Explicit Mermaid edge IDs
  provide the strongest continuity for connections edited repeatedly. Without
  an explicit ID, an edge key includes its endpoints, label, and ordinal among
  equivalent parallel edges. Changing those identifying properties can leave
  an old scene target unmatched.
- Missing targets remain in the saved project and are called out in the element
  picker. A camera scene with no available targets falls back to the full
  diagram. Reconnect or remove obsolete selections when the source change is
  permanent.

Scene targeting uses a successfully rendered current diagram. Invalid or stale
source keeps the last valid picture available for reference, but it must be
rendered successfully before starting the storyboard or exporting a picture.

## Reduced motion and accessibility

The studio and exported presentation observe the device's reduced-motion
preference. With reduced motion enabled, scene contents still change and the
timeline remains operable, but camera interpolation, staggered fades, and moving
connector flow are suppressed. A focused scene uses its final camera region
immediately. The preference is also respected if it changes while the player is
open.

Transport controls, scene selectors, checkboxes, and sliders support keyboard
use. While previewing, diagram targets are removed from the tab order; editing
interactions return when preview ends. Scene titles and playback state are
available in the presentation controls. Mobile users can switch between Story
editing and the Canvas without losing their scene settings or playhead. Starting Present from Story returns to Story on exit; the editing camera is restored. Inactive mobile panels are inert and do not retain keyboard targets.

## Save and export

**Project JSON** preserves Mermaid source, design overrides, all scenes, timing,
visibility, camera targets, and flow selections. Projects autosave in the current
browser. Download a `.meridian.json` file to keep a portable editable backup.
Existing v1 projects migrate automatically; a project with no storyboard keeps
the original diagram-only presentation experience.

**HTML** contains the diagram, the scene data, and the same playback engine used
for studio preview. It includes scene navigation, replay, a playhead, loop, and
fullscreen controls. It can be opened offline without Meridian, Mermaid,
accounts, scripts from a CDN, or remote assets. The script is protected by a
Content Security Policy that authorizes its exact SHA-256 hash, and user-provided
labels and JSON values are escaped before embedding. HTML is the portable viewing
format; keep project JSON for future editing.

**SVG and PNG** export the complete diagram with its design settings. They are
static exports and do not preserve the storyboard sequence. There is no video or
GIF export in this version.

## Engineering and verification

- The schema is defined in `src/types/storyboard.ts` and validated in
  `src/lib/storyboard.ts` before imported data enters the workspace.
- The shared player reads scene data, renders a deterministic time position,
  and restores original SVG state on teardown. The React stage owns its
  lifecycle; the HTML exporter embeds the compiled player without imports.
- Unit coverage checks validation, independent scene copies, nested group
  selection, timing, project round trips, failed saves, text escaping, executable
  export syntax, and exact script hashes.
- Browser coverage uses the production application, actual file import/download,
  and an offline presentation context. It checks scene edits, sequencing,
  visibility, camera changes, moving flow, pause/scrub behavior, mobile panels,
  reduced motion, and restored editing interaction. Desktop, mobile, preview,
  and offline presentation screenshots are attached to the CI browser report.

The authoritative run results and artifacts are in the repository's workflow
checks; this document describes the implemented behavior and test coverage.
