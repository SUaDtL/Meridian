# Authoring implementation ledger

The handoff is Meridian Design Package v1.0. Its baseline and the fetched `main` both resolve to `949e4d181a77a4ffc2c67aaab876dea70a0f1fc7`. The archive CRC check passed and all 193 listed entries matched their recorded byte counts and SHA-256 hashes. The supplied research, initial design and review files are preserved in the original archive. Below, specification paths refer to that archive.

## Current application and migration boundaries

| Capability | Reuse | Migration risk |
| --- | --- | --- |
| Source editing and Undo | `SourceEditor.tsx`, `Studio.tsx`, `workspace.ts` | All editor mutations must agree on one history order. The editor currently normalizes line endings when typing. Source-backed proposals need token checks and exact source spans. |
| Durable projects and files | `useWorkspace.ts`, `storage.ts`, `App.tsx`, `download.ts` | Local storage uses a workspace-wide snapshot and advisory storage events. IndexedDB must compare exact anchors in a transaction and retain the raw v1/v2 recovery snapshot. |
| Flowchart rendering and appearance | `useDiagram.ts`, `render.ts`, `render-queue.ts`, `render-cache.ts`, `design.ts` | Mermaid has shared mutable configuration. Reuse the serialized entry point and detached model. Preview work must preserve framing and decoration invalidation boundaries. |
| Styles, selection and story targets | `design.ts`, `ElementInspector.tsx`, `storyboard.ts`, `storyboard-runtime.ts` | Current node/group keys use source IDs and implicit edges use endpoint/label/ordinal keys. Migrate these consumers, orphans, and the portable runtime together. |
| File and presentation export | `export.ts`, `ExportDialog.tsx`, `tests/validate.py` | v3 project export must materialize metadata and data within the import envelope. Typed target tables require matching studio and offline playback. |
| Independently hosted application | `.github/workflows/pages.yml`, `scripts/stage-pages.mjs`, `scripts/build-standalone.mjs` | Preserve frozen bundle and exact artifact validation, local-only CSP, and lazy studio loading. |

## Acceptance coverage and planned PRs

Each row applies to every listed story. In Progress indicates that a slice is implemented while the track still has open acceptance criteria. Module paths are relative to `src/`. Names in italics describe planned module responsibilities. PR labels indicate review order within the documented milestone, subject to the listed gates and dependencies.

| Track and status | Story IDs | Prerequisites | Source modules | Planned review |
| --- | --- | --- | --- | --- |
| F00 Shared commands and source identity · In Progress | FN01, FN02, FN03, FN04, FN05, FN06, FN07, FN08, FN09, FN10, FN11, FN12 | D01–D05; pinned render and legacy fixtures | `lib/authoring/`, `lib/workspace.ts`, `components/SourceEditor.tsx`, `lib/render.ts`, `lib/storyboard-runtime.ts`; *typed operation registry and target table* | M0 token/history/source proof, proposals, identity projection |
| F00c Persistence, migration and recovery · In Progress | PS01, PS02, PS03, PS04, PS05, PS06, PS07, PS08 | F00a snapshots; F00b identity migration | `hooks/useWorkspace.ts`, `lib/storage.ts`; *IndexedDB saves, migration and drafts* | M0 durable save and migration |
| F01 Smart Create · In Progress | SC-01, SC-02, SC-03, SC-04, SC-05, SC-06, SC-07, SC-08, SC-09 | F00a; F00b writer/IDs; F00c projects and drafts | `App.tsx`, `components/Home.tsx`, `lib/authoring/`; *wizard, rows and draft checkpoints* | M1 guided creation and review |
| F09 Productivity · In Progress | PX01, PX02, PX03, PX04, PX05, PX06, PX07, PX08 | F00a registry, F00b source and durable IDs | `Studio.tsx`, `components/SourceEditor.tsx`; *command search, outline, snippets and bulk actions* | M1 search and outline, M3 bulk actions |
| F07 Visual Builder · In Progress | VB01, VB02, VB03, VB04, VB05, VB06, VB07, VB08, VB09, VB10, VB11, VB12 | F00a/b/c, identity parity and mixed history | `Studio.tsx`, `components/DiagramStage.tsx`, `lib/authoring/`; *structure actions and review* | M1 Add/Rename/Connect, M3 grouping/removal |
| F02 Quality Coach · In Progress | QC-09, QC-10, QC-11, QC-12, QC-13, QC-14, QC-15 | F00a shared render and style; F00b for structural fixes | `lib/design.ts`, `lib/render.ts`; *quality rules and fixes* | M2 local checks, M3 broader fixes |
| F03 Design Director · In Progress | DD-01, DD-02, DD-03, DD-04, DD-05, DD-06, DD-07, DD-08 | F00a preview coordinator; F00b stable targets | `lib/design.ts`, `lib/render-cache.ts`; *recipes and scoped comparisons* | M2 design previews |
| F06 Layout assistance · In Progress | LY01, LY02, LY03, LY04, LY05, LY06, LY07, LY08 | F00a previews and measurements; F00b direction patch | `lib/render.ts`, `lib/render-queue.ts`; *layout metrics and candidate review* | M2 layout comparison |
| F04 Components and libraries · In Progress | CP-01, CP-02, CP-03, CP-04, CP-05, CP-06, CP-07, CP-08, CP-09, CP-10 | F00a atomic proposal; F00b source/identity; F00c library | `lib/authoring/`, `lib/storage.ts`; *component manifests, parameters and ports* | M3 component definition and insertion |
| F05 Automatic stories · In Progress | AS-01, AS-02, AS-03, AS-04, AS-05, AS-06, AS-07, AS-08, AS-09 | F00a one transaction; F00b typed targets; F00c persistence | `lib/storyboard.ts`, `lib/storyboard-runtime.ts`, `lib/export.ts`; *story generation and visibility closure* | M3 story generation |
| F10 Quantitative charts · In Progress | CH01, CH02, CH03, CH04, CH05, CH06, CH07, CH08, CH09 | F00a/c shared shell; exact-number and rendering proof | `lib/storage.ts`, `lib/export.ts`; *typed dataset, transforms and chart renderer* | M4 chart model and marks |
| F11 Engineering imports · In Progress | IM01, IM02, IM03, IM04, IM05, IM06, IM07, IM08 | F00a/b/c; bounded local readers and resolver | `components/OpenApiImportDialog.tsx`, `lib/authoring/openapi-facts.ts`, `lib/authoring/openapi-project.ts`; *multi-file resolver and remaining adapters* | M4 one PR per import adapter |
| F08 External assistant · Blocked | AI01, AI02, AI03, AI04, AI05, AI06, AI07, AI08, AI09, AI10 | F00a/b/c; scoped contracts; approved hosting, identity, spend and operator | `lib/authoring/`; *file exchange and independently operated companion* | M5 local exchange, then separately approved pilot |

## Milestone 0 checkpoint

[Draft PR #7](https://github.com/SUaDtL/Meridian/pull/7) contains the implementation from [commit `9f491c1`](https://github.com/SUaDtL/Meridian/commit/9f491c196ec03c78583550fc210bcdb28b04bfca). The [GitHub Actions run](https://github.com/SUaDtL/Meridian/actions/runs/44761903911) retains browser evidence.

### Exact state identity and bounded source proof

`src/lib/authoring/base-token.ts` implements the four-field base token and canonical JSON/SHA-256 contract. The supplied project and source vectors verify Unicode escapes, source whitespace and metadata-only state changes. This verifies the hashing portion of FN01 and FN02. The existing app has yet to enforce the token in proposal and persistence entry points, so neither end-to-end story is marked complete.

The canonical flowchart writer and UTF-16 patch planner in `src/lib/authoring/` cover explicit top-level declarations, source-independent allocated IDs, label replacement and indexed edge removal, and bounded node/edge addition. Tests compare untouched source exactly, including BOM, CRLF, separators and comments. The corpus refuses ambiguous declarations, unsupported reference scope, stale or overlapping spans and excessive expansion. Browser fixtures use the existing project import and SVG surface, including explicit edge IDs, preserved `linkStyle` after deletion and project JSON export/import.

The local source proof uses a deliberately narrow grammar as permitted by `final/architecture/source-edit-algorithm.md`. It has no general parser fallback. The full before/after Mermaid semantic comparison, detached identity/orphan state, worker lifecycle and application of validated candidates remain open. The source planner is isolated from user-facing controls. G01 remains open. Related decisions and findings include D02–D05, RV09, AR07–AR08, UR03–UR04 and SRV15–SRV16.

The pinned SVG renderer displays numeric Mermaid entities visibly for several supplied vectors, including quotes, square brackets, pipes, a literal entity spelling and a less-than sign. The node-label proof rejects that candidate. The canonical encoder still follows the exact specified encoding. Future integration must refuse mismatches before accepting work and extend the proof to edge labels and semantic projection. See `tests/browser/authoring-foundation.spec.ts` for the observed browser evidence.

### Workspace history

`src/components/SourceEditor.tsx` and `src/Studio.tsx` route CodeMirror keyboard and browser history requests to the project reducer and disable the independent editor history. Paste, drop and replacements break ordinary typing groups. This is part of FN05. Selection restoration, composition lifecycle, guarded generated edits and the full mixed-editor/IME/save corpus are open.

No acceptance story is marked fully verified at this checkpoint. G02 and G03 remain open pending typed identity/runtime parity and exact durable transactions. G06's legacy baselines and the canonical fixture round trip provide regression evidence only. F08 operation remains blocked on the independently approved service dependencies.

### Continuation

1. Add closed operation schemas and the local proposal lifecycle, connecting the full base-token guard to atomic reducer commits with one Undo snapshot.
2. Finish the source proof against the pinned Mermaid parser and rendered target table. Fix or refuse each literal mismatch before Apply, and finish source/canvas selection and IME history.
3. Migrate v1/v2 projects with the typed identity and orphan rules. Verify styles and storyboard behavior in the studio and offline export.
4. Connect captured snapshots to IndexedDB compare-and-swap and recovery, and run G01–G03 against the integrated app before Smart Create, command search/outline and the thin visual builder.

### Build evidence

- Local verification passed `npm run typecheck`, `npm test` (118 tests), `npm run verify:legacy`, `npm run build:pages`, `npm run verify:artifact`, `npm run build:standalone` and `npm run verify:standalone`.
- The generated Pages artifact has 106 files and totals 6,847,382 bytes. The initial dependency graph remains at 336,880 bytes, against the 370,568-byte budget. Portable HTML is 6,914,934 bytes. The before/after artifact checks also verify CSP and dependency integrity.
- All 34 Playwright tests passed locally in pinned Chromium 159.0.8154.6, including six themes, ten example comparisons, standalone offline rendering and the five new authoring checks. The browser spec attaches desktop and touch viewport screenshots. The installed system Chromium blocked standalone file navigation during the baseline run. That baseline case passed with the pinned browser.
- `npm audit --audit-level=high` reported zero advisories.

## Milestone 0 native heading proposals

- The canvas heading editor now prepares a closed `meridian-proposal/v1` envelope against its captured in-memory v2 project snapshot. `src/lib/authoring/proposals.ts` checks the full base token, prepares a privately held candidate, and uses the same UTF-8 byte ceiling as the project file import and export path.
- `src/lib/workspace.ts` rechecks the exact project snapshot and revision at Apply. Title, subtitle and canvas visibility commit together with one Undo entry. Stale, invalid or oversized results preserve authored state and history. A workspace reload advances the revision, while autosave tracks the actual last saved workspace snapshot.
- The heading dialog retains the draft on a stale result and shows the current heading. Reviewing the new base requires an explicit action before resubmitting. Headings use the existing frame path. The performance regression test verifies zero additional Mermaid layouts for a heading edit.
- Unit and browser evidence covers equal-revision metadata mismatch, source change during hashing, forged readiness, out-of-scope fields, one-step Undo/Redo, UTF-8 budget enforcement and draft recovery after a stale Apply. See `src/lib/authoring/proposals.test.ts` and `tests/browser/authoring-foundation.spec.ts`.
- This advances FN01, FN04, FN05, FN10 and FN11 for one native metadata operation. Structural validation, v3 IDs, selection and composition history, durable compare-and-swap, and imported proposals remain open. G01–G03 remain open for visual authoring.

## Milestone 0 source semantic comparison

[PR #8](https://github.com/SUaDtL/Meridian/pull/8) merged the heading proposal increment as [`510b3b2`](https://github.com/SUaDtL/Meridian/commit/510b3b25f973572dc2f9ae107ee7bdb10b1e0396).

- `src/lib/authoring/flowchart-proof.ts` checks the scanner's top-level direction, explicit node declarations, shape and edge order against the pinned Mermaid parser. It then compares the entire before-and-after source graph to the expected Add, Rename, Connect, or indexed edge removal. A matching edge count alone is insufficient.
- The comparison includes unrelated node labels, shapes, edge endpoints, edge notation, surviving indexed styles, and default link styles. New labels must also read back exactly from the sanitized SVG. Unsupported source or a mismatched candidate is refused without dispatching any edit.
- `src/lib/render.ts` detaches source semantics from the existing serialized Mermaid layout job. Sources with design overrides still use their original parsed model for comparison. The bounded renderer caches account for the estimated size of the retained model.
- `tests/browser/flowchart-proof.spec.ts` runs the exact validator in Chromium with the installed Mermaid dependency. The fixture includes BOM and CRLF, an explicit parallel edge, multiple indexed styles, link interpolation and a default link style. Unit adversarial cases reject a modified unrelated label, endpoint, surviving style or default style.
- This advances G01 and the source validation portions of FN04, FN10 and FN12 for the declared flat subset. Cross-revision structural Apply, a source worker and broader grammar, typed identity and orphan tracking, and full runtime/export migration remain open. The proof is available to future commands behind those gates.

## Milestone 0 legacy identity migration preflight

[PR #9](https://github.com/SUaDtL/Meridian/pull/9) merged the source proof as [`ee11fb0`](https://github.com/SUaDtL/Meridian/commit/ee11fb0ee4c3968650975bcde32f3c401001dab3).

- `src/lib/authoring/identities.ts` reconciles accepted source bindings independently of SVG geometry. It preserves identities across invalid input, retires confirmed deletions, and never guesses a binding between ambiguous implicit connectors. The live and combined retained-record limits are checked before returning a candidate.
- `src/lib/authoring/migrate-legacy-project.ts` prepares a v3 candidate from a validated v2 project and the pinned Mermaid model. It preserves the exact source, resolves annotations against unique targets, expands legacy node accents, and retains missing and ambiguous styles and scene slots as orphans. Invalid material or an over-limit candidate returns the complete original to recovery. Unsupported diagram families retain annotation evidence without assigning guessed UUIDs.
- Storyboard playback now reads the renderer's explicit element kind to identify connectors. The same runtime is embedded in offline HTML. The fixture verifies that an opaque connector ID can receive flow and a node with a connector-looking key cannot.
- Evidence covers FN06, FN07 and FN09 at the identity and migration boundaries. The original stored workspace remains in service. The v3 project loader, typed target table, automatic migration transaction, and operator recovery path are still required before activating production v3 storage.

## Milestone 0 durable storage preflight

[PR #10](https://github.com/SUaDtL/Meridian/pull/10) merged identity migration preparation as [`680450f`](https://github.com/SUaDtL/Meridian/commit/680450fb0db05d96ed4a49c17661c83f28b4800d).

- The v3 decoder uses the design package's project and shared JSON schemas. It adds strict JSON scanning, the portable byte and UTF-16 limits, and checks for conflicting identity bindings, unresolved annotations, mismatched connector kinds and stale component or scene references. Schema references resolve from bundled files and require no network or code generation. The active legacy workspace reader retains its existing compatibility and save format.
- IndexedDB captures and validates an exact document before opening the write transaction. The transaction compares both saved-anchor fields and issues a new generation on success. The reader verifies the saved payload against its digest. Two browser connections starting from the same anchor produce one committed write, and an older generation is rejected even when its state digest still matches.
- Legacy migration prepares projects through the serialized renderer, retains quarantined entries in the exact original backup, and commits admissible projects, the archive and the activation marker in one transaction. Chromium fixtures abort after each write request and verify that neither the archive nor even one project becomes visible. An edit to the old workspace before commit prevents activation. Edits observed after commit leave the completed generation intact.
- This supplies storage-boundary evidence for PS02 and PS03 and part of PS04, PS06 and PS08. The editor still opens the legacy workspace while live v3 rendering, typed targets, save scheduling and recovery UI are integrated.

## Milestone 0 v3 edit and reopen

[PR #11](https://github.com/SUaDtL/Meridian/pull/11) merged durable migration and saved-anchor writes as [`3bc89e6`](https://github.com/SUaDtL/Meridian/commit/3bc89e63c0030b78b1194e0b95adf3feb8e968b1).

- `src/lib/authoring/project-editor.ts` opens a verified v3 project, prepares and applies a guarded heading, and records one bounded Undo entry. Undo and Redo create newer revisions. Both editor formats share the heading envelope and stale-draft check.
- `src/lib/persistence/project-save-queue.ts` schedules after 450 ms of quiet input and starts a checkpoint within two seconds of continuous edits when the writer is idle. It keeps the latest revision while a write is in flight, reports Saved only after the current revision commits, and preserves unsaved edits on storage error or conflict.
- The Chromium fixture migrates an existing project, opens it in two tabs, applies and undoes a heading, rejects a stale proposal, and reopens the committed revision after reload. It checks that the stale tab retains its edit while the stored project and its source and identities stay intact.
- This integrates one heading operation through FN04, FN05, PS02 and the save scheduler. The public editor still opens the legacy workspace. Typed render targets, structural Apply, recovery controls and export/reopen parity remain required before switching the public editor to v3.

## Milestone 0 guarded v3 source edits

[PR #12](https://github.com/SUaDtL/Meridian/pull/12) merged the v3 edit and reopen increment as [`e714848`](https://github.com/SUaDtL/Meridian/commit/e714848c2db66dc52ef6dc3d2f08ed1db53c076c).

- The v3 editor can prepare Add Node, Rename Node or Connect for the supported flat grammar. Rename and Connect take resolved node UUIDs. The pinned Mermaid comparison verifies the exact source delta and visible label before the session can apply the candidate. A prepared candidate from an older snapshot cannot apply after another edit or Undo.
- Apply preserves each existing identity and annotation. A successful Add or Connect creates one new identity. Source and identities enter history and autosave as one snapshot. Removing an element and retaining its annotations uses a separate operation and is outside this slice.
- The Chromium fixture shows a v2 project with a BOM, CRLF, a source comment and a styled node migrating into v3, receiving all three operations, and reopening after Undo and Redo. This advances FN04, FN05, FN06 and FN10 for the tested subset. The browser fixture exercises the editor session directly. Canvas wiring, typed targets, recovery controls and studio/export parity still gate public activation.

## Milestone 0 measured v3 render targets

[PR #13](https://github.com/SUaDtL/Meridian/pull/13) merged the guarded v3 source edits as [`d150023`](https://github.com/SUaDtL/Meridian/commit/d150023fafaa08aadbd3496d877e17b4090e89e2).

- The v3 flowchart renderer matches authored UUIDs to the detached Mermaid model before layout, then applies recipe styles and manual overrides. The result contains a `meridian-targets/v1` table with IDs, explicit kinds, group relationships, connector endpoints and direction, SVG-space bounds, the snapshot token and the render fingerprint.
- Primary and owned SVG targets carry the same IDs as the measured table. Unresolved bindings do not gain interactive IDs. Contradictory group relationships, unresolved endpoints and missing geometry prevent an authoritative target table.
- In Chromium, a migrated project with a styled node, a group and an authored connector yields matching target IDs, measured geometry and the migrated style. One Mermaid layout suffices. A heading-only edit advances the table's base token and reuses the measured render. This advances G02. Studio and offline storyboard playback still need to consume the same table and prove parity.

## Milestone 0 v3 storyboard playback and export

[PR #14](https://github.com/SUaDtL/Meridian/pull/14) merged measured v3 render targets as [`5e34ea2`](https://github.com/SUaDtL/Meridian/commit/5e34ea207f5191564363b4d6012004ff07ed0bf7).

- The same playback engine reads measured UUID targets in the studio fixture and in standalone HTML. It includes required ancestor containers without expanding their contents. Flow uses the explicit edge direction and is available only when both endpoints are visible. Camera bounds are transformed from the measured diagram coordinates into the framed SVG.
- The v3 presentation exporter compares all four base-token fields before embedding the typed table and hashed playback script. The Chromium fixture rejects an old render after a heading edit, then compares scene visibility, camera and bidirectional flow with network access disabled.
- This advances G02 and the playback/export foundation for F05. Public canvas wiring, migration recovery controls and the automatic story generator remain open.

## Milestone 0 workspace migration review

[PR #15](https://github.com/SUaDtL/Meridian/pull/15) merged shared v3 studio and standalone playback as [`634d6c8`](https://github.com/SUaDtL/Meridian/commit/634d6c805c5c82b2a8351723b6904aaba621b93b).

- Manage Projects opens a review of the saved migration receipt. Users can prepare v3 copies, see which legacy records need recovery, and download the checksum-verified original archive or individual verified v3 projects. The existing editing workspace continues to open v1/v2 projects.
- A later legacy write updates the recovery notice. It leaves prior v3 copies and their pre-migration backup available separately. A failed migration keeps Download current legacy workspace available and permits a clean retry.
- Built-app Chromium tests read the downloaded files, verify source and archive preservation after a second-tab write, and simulate a quota error after project writes have been requested within the transaction. This advances PS03 and PS04. Opening and editing v3 projects through the application and importing v3 files remain open.

## Milestone 0 portable v3 project import and preview

[PR #16](https://github.com/SUaDtL/Meridian/pull/16) merged workspace migration review as [`23be89d`](https://github.com/SUaDtL/Meridian/commit/23be89d16b5576c924b7d74dbfc97fde228be06c).

- Migration and recovery accepts strictly validated, size-bounded v3 diagram files. An import creates a new project at revision zero with the same authored source, element identities, settings and annotations. The shared IndexedDB transaction enforces the workspace count for new projects.
- The v3 project list includes copies imported before migration. A later legacy migration adds only new records and commits the converted projects, receipt and original backup together. A capacity error or conflicting key aborts that transaction.
- A saved v3 project can open a read-only diagram preview, display its exact Mermaid source and download a presentation when measured targets are available. The browser test rejects duplicate JSON keys, transfers a project into a fresh mobile-sized browser and verifies its contents after a later migration.
- This advances Mermaid portability under PS06 and exercises the measured renderer through the application. The legacy editor is still the default. The v3 preview does not write editor changes.

## Milestone 0 live v3 heading and save recovery

[PR #17](https://github.com/SUaDtL/Meridian/pull/17) merged portable v3 import and preview as [`dea808e`](https://github.com/SUaDtL/Meridian/commit/dea808e601ddd533769cc636e7a26ed36d4ad6f2).

- Projects opened through migration and recovery now use the durable v3 editor session. The same heading dialog prepares a baseline-checked proposal in either the legacy editor or the v3 session. The v3 session supports Undo and Redo as newer revisions.
- The v3 session reports Saved only when the current revision reaches IndexedDB and attempts a checkpoint before leaving. A stale anchor retains the tab's authored changes and offers download, a separate saved copy or an explicit reload. Save errors also permit retry.
- Browser coverage opens the same migrated project in two tabs, verifies reversible edits and exact saved revisions, and saves the second tab's conflicting changes as a separate project. The original project and legacy backup remain available. This advances PS01, PS02 and PS04. Structural canvas editing and a full v3 replacement for the default editor remain open.

## Milestone 0 live v3 flowchart edits

[PR #18](https://github.com/SUaDtL/Meridian/pull/18) merged live v3 heading and save recovery as [`be48164`](https://github.com/SUaDtL/Meridian/commit/be48164adb30e9eaf856e7bd2a02bbc6ccb2709f).

- The v3 project session offers Add node, Rename node and Connect nodes for supported flat flowcharts. Node choices come from measured targets and show their Mermaid identifiers so duplicate labels remain distinguishable. Other diagram forms retain rendering and heading editing.
- Preview applies the established parser proof to a detached draft and renders the resulting v3 snapshot. Apply is available after the preview image loads and still checks the current snapshot. Cancelling or changing the draft leaves the project data untouched.
- Chromium exercises the public controls, cancellation, all three operations, exact BOM and CRLF source preservation, stable existing identities, durable revisions and one-step Undo. This advances the supported portions of G01 and G03. The default editor still uses v1/v2 storage, and guided creation and broader source editing remain open.

## Milestone 1 guided linear process creation

[PR #19](https://github.com/SUaDtL/Meridian/pull/19) merged the first live v3 flowchart operations as [`a37167d`](https://github.com/SUaDtL/Meridian/commit/a37167d2117796f75e46ca1dcd4450f27028b3fa).

- Build with guidance opens a three-step linear process flow from Home and New Project. Input keeps one row per nonempty line, presents any removed list prefix beside the normalized label, and shows all adjacent relationships before preview.
- Preview uses the canonical writer and pinned Mermaid to verify the exact labels, authored edge IDs and reviewed endpoints. Only the ready image can create the reserved v3 project. The IndexedDB write uses an absent-project anchor, then opens the saved project. Closing the dialog keeps the raw input for the current session.
- Built-app browser coverage creates and exports a five-step flow with four connections and duplicate node labels while preserving separate identities. A punctuation mismatch retains the draft and prevents creation. This advances SC-01 and the exact-label portion of SC-07. Branch decisions, systems and table inputs, insertion, worker lifecycle and durable normalized draft recovery remain open.

## Milestone 1 guided process checkpoints

[PR #20](https://github.com/SUaDtL/Meridian/pull/20) merged the linear process wizard as [`54c4f12`](https://github.com/SUaDtL/Meridian/commit/54c4f122c7f3c01950166694609a0dc5fee3030e).

- Reviewing connections saves normalized linear process rows and explicit edges as a bounded, expiring `meridian-draft/v1` checkpoint. Unreviewed input and the original raw lines stay in the current session. Resume opens a draft for review and displays its saved time and expiry.
- The transaction checks capacity and the exact previously observed checkpoint before replacing it. Discard is explicit. Successful project creation clears its checkpoint after the document commit, and a cleanup failure keeps the saved project available.
- Browser tests cover reload, expiry disclosure, separation from unreviewed input, checkpoint cleanup, and a quota failure that leaves the session usable. This advances SC-05 and SC-08 for the linear process path. Durable branch decisions and systems or table drafts remain open.

## Authoring progress through milestone 3

| Track | Implemented slice | Remaining work |
| --- | --- | --- |
| Guided creation | Local worker review, explicit branching and normalized process/table checkpoints. [#22–26](https://github.com/SUaDtL/Meridian/pulls?q=is%3Apr+is%3Amerged+guided) | Additional input modes and insertion into an existing diagram |
| Navigation and checks | Command search, typed outline and source locations, source suggestions at supported statement positions, label checks and supported rendered contrast. [#25](https://github.com/SUaDtL/Meridian/pull/25) · [#27](https://github.com/SUaDtL/Meridian/pull/27) · [#28](https://github.com/SUaDtL/Meridian/pull/28) · [#29](https://github.com/SUaDtL/Meridian/pull/29) | Source diagnostics, bulk selection, and guarded suggested fixes |
| Design and layout | Diagram-wide recipe previews and measured direction alternatives. [#30](https://github.com/SUaDtL/Meridian/pull/30) · [#31](https://github.com/SUaDtL/Meridian/pull/31) | Scoped design changes and routing verification |
| Visual builder and stories | Atomic Add Next, explicit connection/node deletion with annotation recovery, reviewed group creation and removal for explicit declarations, and group- and path-based storyboard suggestions. [#32](https://github.com/SUaDtL/Meridian/pull/32) · [#33](https://github.com/SUaDtL/Meridian/pull/33) · [#34](https://github.com/SUaDtL/Meridian/pull/34) · [#36](https://github.com/SUaDtL/Meridian/pull/36) · [#40](https://github.com/SUaDtL/Meridian/pull/40) | Nested grouping, moving members, additional story tools and the remaining interaction gates |
| Components | Local library with conflict-safe packs and reviewed projects from flat forward definitions. [#35](https://github.com/SUaDtL/Meridian/pull/35) | Grouped generation, insertion, port binding, and extraction |

## Milestone 2 verified label contrast fixes

- For a measured solid-text contrast finding, the checker previews a single text-color override and measures the rendered result again in the same viewing profile. Apply uses the current project token and the verified preview. Unknown backdrops stay outside the fix.
- Chromium verifies the proposed ratio, a text-only change, the next readability check, and exact restoration with Undo. This advances the measured solid-contrast portion of F02.

## Milestone 3 path-based story suggestions

- Follow a path starts from a selected node and uses individually chosen connections with explicit traversal direction. It stops after the first loop, retains only selected path content and optional one-hop context, and adds group containers without expanding unrelated descendants.
- The shared story proposal and player preview exact coverage before append or replacement. Fixture coverage verifies loops and motion direction. Chromium verifies selection, settled visibility and one saved scene in the existing v3 workspace. This advances AS-02 and AS-06.
- Group and path choices can be saved as seven-day local drafts with the exact project token. A resumed draft from an earlier revision needs a fresh preview. Browser coverage verifies reload, a changed base, preserved choices, and applying only after review.
- Branch scenes and multi-path ordering remain open.

## Milestone 4 typed chart projects

- Chart values in guided creation opens local delimited or JSON data, confirms column types, and previews an independent chart project. The parser keeps exact JSON number tokens until conversion. Confirmed chart drafts and saved projects use IndexedDB. Saved projects reopen from Chart projects and export portable JSON, SVG and offline HTML with a displayed-values table.
- Chart number fixtures verify the golden sum, mean, null, rounding and precision examples. Portable chart tests verify date sorting, duplicate policy and persisted domain metadata. Chromium verifies a typed-data draft across reload, confirms a reviewed project, reopens it and reads its offline export. This advances CH01–CH06, CH08 and CH09.
- Saved charts can preview and apply mapping, heading, frame, and custom Y-range changes with Undo and Redo. The chart save queue compares the previously observed durable anchor. A conflicting tab can retain its work as a separate chart. Preview and export show clipped data without changing the stored values.
- Locale and conversion controls, custom X-range and filter controls, the remaining accessibility controls, and the chart performance gates remain open.

## Milestone 4 OpenAPI operation diagrams

- Engineering file reads one local OpenAPI 3.0 or 3.1 JSON file through a bounded worker. It presents operation IDs, declared tags and the scope excluded because of referenced path items or schema content. Select operations and review their display labels and optional primary tags before creating a new project.
- Generated Mermaid links represent declared tag membership. Outline shows the exact virtual path and escaped JSON Pointer for each generated target. Chromium verifies filtered selection, reviewed generation and a portable export that retains provenance without examples, descriptions or remote URI content.
- This advances IM05, IM06, IM07 and IM08 for the operation view. Restricted YAML, multi-file resolution, schema/reference views, check-pointed facts and further adapters remain open.
