# Authoring implementation ledger

The [acceptance coverage](AUTHORING-COVERAGE.md) maps all 118 package stories to current source, tests, prerequisites and remaining work.

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
| F00 Shared commands and source identity · In Progress | FN01, FN02, FN03, FN04, FN05, FN06, FN07, FN08, FN09, FN10, FN11, FN12 | D01–D05; pinned render and legacy fixtures | `lib/authoring/`, `lib/workspace.ts`, `components/SourceEditor.tsx`, `components/V3SourceEditor.tsx`, `lib/render.ts`, `lib/storyboard-runtime.ts`; *typed operation registry and target table* | M0 token/history/source proof, proposals, identity projection |
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
| F08 External assistant · In Progress | AI01, AI02, AI03, AI04, AI05, AI06, AI07, AI08, AI09, AI10 | F00a/b/c; scoped contracts; approved hosting, identity, spend and operator | `lib/authoring/assist-exchange.ts`, `lib/persistence/pending-assist.ts`; *independently operated companion* | M5 local exchange, then separately approved pilot |

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

## Authoring progress through milestones 1–3

| Track | Implemented slice | Remaining work |
| --- | --- | --- |
| Guided creation | Local worker review, explicit branching and normalized process/table checkpoints. [#22–26](https://github.com/SUaDtL/Meridian/pulls?q=is%3Apr+is%3Amerged+guided) | Insertion into an existing diagram and the full guided-entry accessibility gates |
| Navigation and checks | Command search, typed outline and source locations, source suggestions, guarded-editor diagnostics, and supported rendered label checks. [#25](https://github.com/SUaDtL/Meridian/pull/25) · [#27](https://github.com/SUaDtL/Meridian/pull/27) · [#28](https://github.com/SUaDtL/Meridian/pull/28) · [#69](https://github.com/SUaDtL/Meridian/pull/69) · [#71](https://github.com/SUaDtL/Meridian/pull/71) | Guarded suggested fixes and additional measured geometry |
| Design and layout | Diagram-wide, selection and role recipe previews and measured direction alternatives. [#30](https://github.com/SUaDtL/Meridian/pull/30) · [#31](https://github.com/SUaDtL/Meridian/pull/31) · [#63](https://github.com/SUaDtL/Meridian/pull/63) | Override reset and routing verification |
| Visual builder and stories | Atomic Add Next, explicit connection/node deletion with annotation recovery, reviewed group creation and removal for explicit declarations, and group- and path-based storyboard suggestions. [#32](https://github.com/SUaDtL/Meridian/pull/32) · [#33](https://github.com/SUaDtL/Meridian/pull/33) · [#34](https://github.com/SUaDtL/Meridian/pull/34) · [#36](https://github.com/SUaDtL/Meridian/pull/36) · [#40](https://github.com/SUaDtL/Meridian/pull/40) | Nested grouping, moving members, additional story tools and the remaining interaction gates |
| Components | Local library with conflict-safe packs, reviewed creation and insertion from flat forward definitions, explicit port binding, detachment and saving reviewed node selections. [#35](https://github.com/SUaDtL/Meridian/pull/35) · [#51](https://github.com/SUaDtL/Meridian/pull/51) · [#64](https://github.com/SUaDtL/Meridian/pull/64) · [#65](https://github.com/SUaDtL/Meridian/pull/65) | Grouped definitions and durable component argument drafts |

## Milestone 2 verified label contrast fixes

- For a measured solid-text contrast finding, the checker previews a single text-color override and measures the rendered result again in the same viewing profile. Apply uses the current project token and the verified preview. Unknown backdrops stay outside the fix.
- Chromium verifies the proposed ratio, a text-only change, the next readability check, and exact restoration with Undo. This advances the measured solid-contrast portion of F02.

## Milestone 3 path-based story suggestions

- Follow a path starts from a selected node and uses individually chosen connections with explicit traversal direction. It stops after the first loop, retains only selected path content and optional one-hop context, and adds group containers without expanding unrelated descendants.
- The shared story proposal and player preview exact coverage before append or replacement. Fixture coverage verifies loops and motion direction. Chromium verifies selection, settled visibility and one saved scene in the existing v3 workspace. This advances AS-02 and AS-06.
- Group and path choices can be saved as seven-day local drafts with the exact project token. A resumed draft from an earlier revision needs a fresh preview. Browser coverage verifies reload, a changed base, preserved choices, and applying only after review.
- Authors can save a separate story copy, then build explicit branch paths from reviewed nodes. Ordered paths and individual titles survive a local checkpoint. The shared preview verifies exact visible nodes and connections before one Append transaction. The narrower UI still needs the package’s full story authoring and mobile parity coverage.

## Milestone 4 typed chart projects

- Chart values in guided creation opens local delimited or JSON data, confirms column types, and previews an independent chart project. The parser keeps exact JSON number tokens until conversion. Confirmed chart drafts and saved projects use IndexedDB. Saved projects reopen from Chart projects and export portable JSON, SVG and offline HTML with a displayed-values table.
- Chart number fixtures verify the golden sum, mean, null, rounding and precision examples. Portable chart tests verify date sorting, duplicate policy and persisted domain metadata. Chromium verifies a typed-data draft across reload, confirms a reviewed project, reopens it and reads its offline export. This advances CH01–CH06, CH08 and CH09.
- Saved charts can preview and apply mapping, heading, frame, and custom Y-range changes with Undo and Redo. The chart save queue compares the previously observed durable anchor. A conflicting tab can retain its work as a separate chart. Preview and export show clipped data without changing the stored values.
- Delimited numeric columns let users choose decimal and grouping separators before conversion. JSON numeric tokens retain their standard interpretation. A localized exact-decimal fixture verifies that only the confirmed canonical values enter the project.
- Invalid-value conversion options, remaining transforms and accessibility controls, and the chart performance gates remain open.

## Milestone 4 OpenAPI operation diagrams

- Engineering file reads one local OpenAPI 3.0 or 3.1 JSON file through a bounded worker. It presents operation IDs, declared tags and the scope excluded because of referenced path items or schema content. Select operations and review their display labels and optional primary tags before creating a new project.
- Generated Mermaid links represent declared tag membership. Outline shows the exact virtual path and escaped JSON Pointer for each generated target. Chromium verifies filtered selection, reviewed generation and a portable export that retains provenance without examples, descriptions or remote URI content.
- This advances IM05, IM06, IM07 and IM08 for the operation view. OpenAPI schema/reference views and checkpointed facts remain open.

## Milestone 4 chart filter review

- Chart mappings accept explicit typed filters and apply them before aggregation. Review and offline chart summaries show exclusion counts. The source table retains every row and identifies the first filter that excluded it.
- Fixtures verify typed comparison and null predicates. Chromium verifies the reviewed preview, the portable filter, its unchanged dataset, and exact Undo.


## Milestone 4 chart ranges and display units

- Continuous X mappings accept reviewed numeric, date or datetime ranges. Numeric axes support exact decimal power-of-ten scaling and unit text. The mapping stores unit and range choices, while the source table preserves underlying typed values. Preview and export disclose clipped records and show the scaled table headings.
- Chromium verifies that 2,500 remains the stored value when plotted as 2.5 at ×10⁻³, and that clipping uses the plotted value. This advances CH04 and CH06. A chart created before these fields were introduced still validates and opens with its original mapping.
- [Implementation PR #50](https://github.com/SUaDtL/Meridian/pull/50) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44821053437)

## Milestone 3 component instance detachment

- Project details show the instance and its currently bound elements. Review detachment to remove the instance record, retaining its authored source, identities and presentation data. The revision-bound apply uses one project Undo entry.
- Chromium compares the full portable project before detachment, after detachment and after Undo. This advances the detachment portion of F04. Insertion into an existing project and port binding remain open.
- [Implementation PR #51](https://github.com/SUaDtL/Meridian/pull/51) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44821062375)

## Milestone 4 Terraform inventory

- The local worker reads supported Terraform show JSON 1.x plans and state. The scope review selects explicit resources and optionally includes known configuration references between selected endpoints. Planned inventory and state-only coverage are identified separately.
- Browser and unit fixtures verify selected relationships, source paths and pointers, fresh project creation, and exclusion of values, outputs, changes, constants and indexed resource keys. This advances IM04–IM08. Indexed resources and broader configuration semantics remain open.
- [Implementation PR #49](https://github.com/SUaDtL/Meridian/pull/49) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44820571241)

## Milestone 4 JSON Schema relationships

- Users review virtual paths for up to 20 local draft 2020-12 JSON Schema files. The resolver recognizes supplied logical IDs, anchors and JSON Pointers. It records direct references against one identity per schema location, including cycles, without fetching or recursively expanding referenced schemas.
- The review offers declared property relationships, required-property facts, editable display labels and optional unresolved placeholders. Composition and dynamic semantics are disclosed as coverage limitations. A browser fixture confirms duplicate basename recovery, hidden selection, precise exported provenance, no raw description or unresolved URI retention, and no external request.
- This advances IM01–IM03 and IM05–IM08 for the supported JSON Schema subset. Restricted YAML, broader dialect constructs, import checkpointing and the full accessible scope corpus remain open.
- [Implementation PR #52](https://github.com/SUaDtL/Meridian/pull/52) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44822219196)


## Milestone 1 manual systems

- Manual entry assigns each system a distinct draft ID, with independently selected semantic role and source shape. Relationships use named endpoints and preserve the selected one-way, bidirectional or arrow-free notation.
- The Chromium fixture tests incomplete endpoints, two systems with identical display labels, checkpoint recovery after reload, two explicit directions and exact portable source and role bindings. The relationship-table fixture also passes in the standalone artifact. This advances SC-03, SC-05 and SC-07.
- [Implementation PR #58](https://github.com/SUaDtL/Meridian/pull/58) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44825753385)

## Milestone 3 outline bulk label color

- The outline distinguishes selecting visible results from selecting the whole diagram. A filtered selection counts hidden elements. The appearance proposal enumerates labels with verified text color, previews the affected count and checks that every eligible label received the reviewed result.
- Chromium filters eleven selected elements to two visible nodes, applies to all ten eligible labels and verifies source and identity preservation and one Undo. This advances PX03 and the appearance portion of VB08. Structural bulk editing and remaining style controls are open.
- [Implementation PR #56](https://github.com/SUaDtL/Meridian/pull/56) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44825729432)

## Milestone 3 ordered paths and project copies

- Story suggestions can be saved as a separate project. Browser evidence verifies that the original portable project matches byte for byte afterward and that the copy opens with independent history.
- The branch-scene browser journey selects branch starts and edges explicitly, reorders paths, resumes them after reload, verifies exact omitted content and undoes one append. This advances AS-02, AS-03, AS-06 and AS-09. Old single-path checkpoints remain readable.
- [Copy PR #53](https://github.com/SUaDtL/Meridian/pull/53) · [Branch-scene PR #57](https://github.com/SUaDtL/Meridian/pull/57) · [Branch workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44824959675)

## Milestone 5 local assistant exchange

- The local exchange exports only scoped flat-flowchart facts and a reviewed instruction. The stored matching record contains the digest, full project token, readable and writable IDs, permitted operation, and expiry. Expired records are removed when the file exchange opens or another request is saved.
- The supported proposal applies one node rename through the same source proof as native editing. The database compares the saved anchor and consumes the matching request atomically with the project write. A separate Undo restores the prior working project.
- Chromium runs the exchange with networking disabled and verifies scoped disclosure, forged origin and digest rejection, a context-only rename rejection, exact Undo and replay refusal. This advances AI01, AI02, AI05, AI06 and AI09 for the supported rename. More operations and independent hosted pilot work require their separate gates. Hosting, identity, provider, spend and operation approvals remain open.
- [Implementation PR #55](https://github.com/SUaDtL/Meridian/pull/55) · [Workflow and browser evidence](https://github.com/SUaDtL/Meridian/actions/runs/44824348209)

## Exact connection label review

- The structure dialog edits a single explicit connection ID. Chromium verifies a labeled parallel connection retains its stable identity, storyboard references, original line endings and adjacent indexed styles through edit, clear and Undo. This advances the connection label portion of VB03. [PR #59](https://github.com/SUaDtL/Meridian/pull/59) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44826567038)

## Duplicate names and disconnected regions

- Quality Coach finds duplicate node and group names after normalizing Unicode and whitespace for comparison. A reviewed node rename uses the same structural proof as other source edits. The region check follows declared connections and reports unknown coverage when endpoints cannot be resolved. Browser fixtures verify separate region membership and session-only dismissals across a title change. This advances QC-05, QC-06 and QC-12. [PR #61](https://github.com/SUaDtL/Meridian/pull/61) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44827300965)

## Restricted OpenAPI YAML

- The local operation importer accepts restricted single-document YAML with explicit key and scalar type checks. It rejects aliases, tags, duplicate keys and excess structure. Chromium verifies that a rejected file leaves the user in control of choosing a replacement. The generated project retains provenance and omits descriptions and examples. [PR #62](https://github.com/SUaDtL/Meridian/pull/62) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44828433046)

## Scoped design recipes

- The recipe review applies eligible paint to a reviewed selection or to its selected semantic role. It discloses hidden selected elements and protects manual property overrides. Chromium checks unrelated elements and document settings, then verifies exact Undo. This advances F03 scoped recipe application. [PR #63](https://github.com/SUaDtL/Meridian/pull/63) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44828939286)

## Save a selection as a component

- The outline action turns reviewed flat-flowchart nodes and internal connections into a local definition. Authors choose ports and label parameters. Chromium verifies the selected elements, unchanged original project and reopening the definition after reload. This advances F04 extraction for flat selections. [PR #64](https://github.com/SUaDtL/Meridian/pull/64) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44830351027)

## Chart table reading controls

- The displayed-values and source-data tables support column selection, searching across pages and focused-row navigation. The saved offline HTML can search the local table and choose visible columns. Its runtime uses a matching script hash in the Content Security Policy. Chromium verifies results beyond the first 50 rows and offline use. This advances CH08. [PR #66](https://github.com/SUaDtL/Meridian/pull/66) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44831176296)

## Review, insert and edit verified authoring changes

- Component insertion resolves reviewed parameter values and port destinations against the accepted flat flowchart. Apply uses the reviewed definition digest. The browser fixture proves exact source and identity retention, attachment and one Undo. This advances F04 insertion. [PR #65](https://github.com/SUaDtL/Meridian/pull/65) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44831786607)
- The connection editor uses explicit endpoints and one-way, bidirectional or arrow-free notation. An identical connection needs acknowledgment. Add decision creates a diamond, two labeled branches and any explicitly requested destination step in one transaction. Chromium verifies the notation, stable references, reviewed targets and exact Undo. This advances F07 connection and decision editing. [Connection PR #67](https://github.com/SUaDtL/Meridian/pull/67) · [Connection evidence](https://github.com/SUaDtL/Meridian/actions/runs/44833042611) · [Decision PR #76](https://github.com/SUaDtL/Meridian/pull/76) · [Decision evidence](https://github.com/SUaDtL/Meridian/actions/runs/44837039066)
- The saved-scene editor previews and changes title, duration, entrance, easing, reveal order and element-camera padding. The existing story runtime verifies settled visibility and the offline export uses the same scene. The browser fixture checks stable selected scene IDs, surrounding scenes, keyboard focus and Undo. This advances AS-01. [PR #73](https://github.com/SUaDtL/Meridian/pull/73) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44837093589)
- Scoped design recipes protect user paint by default. Authors can opt in to clearing individual eligible paint properties, with affected counts and reviewed colors. The fixture checks retained non-paint styles, unrelated paint, and exact Undo. This advances the scoped DD-07 path. [PR #72](https://github.com/SUaDtL/Meridian/pull/72) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44834633686)

## Findings, guarded source diagnostics and offline exchange

- Quality Coach measures label containment for supported square-corner rectangles in the accepted SVG. It reports unsupported geometry as unknown. Cancellation terminates active work and returns keyboard focus to the check action. Browser evidence covers measured spill at two pixel densities and restarting a cancelled analysis. This advances QC-04 and worker lifecycle. [Containment PR #69](https://github.com/SUaDtL/Meridian/pull/69) · [Containment evidence](https://github.com/SUaDtL/Meridian/actions/runs/44833524106) · [Cancellation PR #74](https://github.com/SUaDtL/Meridian/pull/74) · [Cancellation evidence](https://github.com/SUaDtL/Meridian/actions/runs/44835621260)
- The guarded source editor distinguishes syntax, resource restrictions, valid diagrams outside the supported editing subset, and stale previews. Parser details are collapsed. Verified locations can be selected in the draft. This advances the F09 diagnostic path. [PR #71](https://github.com/SUaDtL/Meridian/pull/71) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44834405635)
- Offline assistant proposals can change one explicitly writable connection label. Both endpoints must be in scope. Chromium verifies context-only endpoints, refusal to change a read-only parallel edge, and exact Undo. This advances a second operation in the local F08 exchange. [PR #70](https://github.com/SUaDtL/Meridian/pull/70) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44834746465)

## Engineering references and typed chart conversions

- The OpenAPI schema view draws selected same-file references between named components, including a two-way reference cycle. The review counts unresolved references and retains exact provenance pointers. Chromium verifies hidden selections, ignored annotations and zero external requests. This advances F11 schema relationships. [PR #75](https://github.com/SUaDtL/Meridian/pull/75) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44836097312)
- Chart import blocks invalid values by default. Authors can separately choose how to handle invalid nonempty values and empty fields. Mapping and preview show exact conversion counts for the import session. Local drafts retain the confirmed rules and typed dataset. The browser fixture verifies default refusal, explicit conversion, and exact aggregate and offline table results. This advances F10 typed conversion. [PR #77](https://github.com/SUaDtL/Meridian/pull/77) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44837138979)

## Verified engineering reference scopes

- `openapi-schema-facts.ts` resolves direct references across explicitly supplied documents with distinct, case-sensitive virtual paths. The browser fixture covers a cross-file cycle between duplicate basenames and preserves each connection's source pointer. The resolver supports named components in the admitted OpenAPI 3.0 and 3.1 subsets. This advances IM02, IM05 and IM08. [PR #78](https://github.com/SUaDtL/Meridian/pull/78) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44838069946)
- `OpenApiImportDialog.tsx` offers labeled placeholders for unresolved references in the selected schemas. The preview counts included and omitted references, and the portable project retains source locations and reason categories. Chromium verifies default omission, explicit inclusion, no raw URI retention and no external requests. This advances IM02 and IM05–IM08. [PR #88](https://github.com/SUaDtL/Meridian/pull/88) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44843091385)
- OpenAPI schema review can save and resume a bounded local draft containing extracted facts, exact locations and author choices. Chromium verifies reload, fresh preview, cross-schema relationships, omitted raw inputs and cleanup after creation. Other adapter drafts and broader schema semantics remain open. [PR #96](https://github.com/SUaDtL/Meridian/pull/96) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44847123087)

## Verified readability and layout evidence

- `readability.ts` applies the document-width profile's declared CSS width to supported geometry. Browser evidence verifies the scale independently of raster density. This advances the viewing-profile portion of QC-11 and QC-12. [PR #79](https://github.com/SUaDtL/Meridian/pull/79) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44838705918)
- `route-geometry.ts` and `crossing-findings.ts` measure bounded route candidates in diagram coordinates. The layout review compares both layouts' checked pairs, unknown routes and skipped work. A real Dagre fixture produces a crossing and the proposed ELK frame reports its bridge arc as unknown. Unsupported route geometry and incomplete coverage stay visible. Comparative geometry gates remain open. This advances QC-07 and F06 comparison. [Crossing PR #83](https://github.com/SUaDtL/Meridian/pull/83) · [Crossing evidence](https://github.com/SUaDtL/Meridian/actions/runs/44840951763) · [Layout PR #86](https://github.com/SUaDtL/Meridian/pull/86) · [Layout evidence](https://github.com/SUaDtL/Meridian/actions/runs/44842701600)
- The recipe audit measures paint on accepted nodes with explicit semantic roles and compares it with the applied recipe. Findings identify the layer contributing supported measurements and retain unknown and inapplicable results. Broader semantic style rules and automatic application gates remain open. [PR #94](https://github.com/SUaDtL/Meridian/pull/94) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44845906249)

## Verified outline and component operations

- `project-flowchart.ts` and `V3ProjectOutline.tsx` prepare a single deletion for the complete explicit connection selection. The fixture verifies hidden members, rejected mixed selections, exact surviving indexed styles, retained annotations and one Undo. Group-content deletion and broader group editing remain open. This advances VB06 and VB08. [PR #81](https://github.com/SUaDtL/Meridian/pull/81) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44838888977)
- `component-drafts.ts` checks a resumed component's exact definition digest and base. A browser case verifies restored parameters, unconnected and unanswered ports, the chosen attachment direction and successful draft cleanup. This advances the checkpoint portion of CP-09. [PR #82](https://github.com/SUaDtL/Meridian/pull/82) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44840268311)
- `component-library.ts` compares the reviewed definition before removing it and offers one session Undo. The browser fixture checks cancel, exact backup, export after removal and durable restoration. Inserted instances remain owned by their projects. This advances F04 library management. [PR #84](https://github.com/SUaDtL/Meridian/pull/84) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44841802508)
- The outline offers touch selection with persistent checkboxes and a maximum of 200 targets. The full reviewed selection still includes entries hidden by filters. The outline and command search can start a connection from one selected node. [PR #89](https://github.com/SUaDtL/Meridian/pull/89) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44845774523)
- Component import lets an author compare and explicitly replace a local definition at the same ID and version. Chromium covers the default copy, a competing replacement and unchanged previously inserted instances. Grouped component extraction and insertion remain open. [PR #92](https://github.com/SUaDtL/Meridian/pull/92) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44844861505)

## Verified design, storyboard and local storage reviews

- Scoped recipe review can separately reset selected user paint properties and the recipe layer. The proposed render shows effective inheritance before Apply. Chromium verifies the unaffected layers and one Undo for each review. [PR #85](https://github.com/SUaDtL/Meridian/pull/85) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44843552187)
- The saved-scene editor can reorder and delete a selected scene after review. The Chromium fixture verifies focus recovery, offline playback order and Undo. [PR #87](https://github.com/SUaDtL/Meridian/pull/87) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44844705795)
- Chart review reports the typed dataset and downloadable project sizes in UTF-8 bytes. The Unicode fixture compares reported size with the exact download and verifies the existing limits. [PR #90](https://github.com/SUaDtL/Meridian/pull/90) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44844138823)
- A local assistant request can authorize deleting one identified connection. The reviewed proposal uses the existing removal proof, retained-annotation review and Undo. Chromium verifies that rename permission cannot authorize removal. The hosted pilot remains separately gated. [PR #93](https://github.com/SUaDtL/Meridian/pull/93) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44845577171)

## Verified scoped scenes, group edits and quality findings

- The saved-scene editor can create a first overview or append one manually. Its scoped creation action uses the complete outline selection, including filtered targets. Selected edges bring their verified endpoints, and selected content brings required group containers. Chromium verifies that unrelated siblings stay hidden in the exported offline presentation and that Undo restores the exact storyboard. [Overview PR #95](https://github.com/SUaDtL/Meridian/pull/95) · [Overview evidence](https://github.com/SUaDtL/Meridian/actions/runs/44848391134) · [Outline scope PR #103](https://github.com/SUaDtL/Meridian/pull/103) · [Outline scope evidence](https://github.com/SUaDtL/Meridian/actions/runs/44850205032)
- Group creation reviews all selected declarations, including hidden selections, and rejects mixed or unsupported scopes. A supported single top-level group can receive one current standalone declaration. The renderer verifies its revised membership and exact existing connections. Browser evidence covers stable bindings, indexed styles, CRLF, BOM, and exact Undo. [Group selection PR #99](https://github.com/SUaDtL/Meridian/pull/99) · [Group selection evidence](https://github.com/SUaDtL/Meridian/actions/runs/44847858147) · [Move PR #101](https://github.com/SUaDtL/Meridian/pull/101) · [Move evidence](https://github.com/SUaDtL/Meridian/actions/runs/44849543851)
- Readability findings open a static accepted diagram with the exact named targets highlighted. Keyboard focus returns to the originating control. Unlabeled straight connectors on a verified solid canvas can receive an unrounded stroke ratio and a rendered, reversible color proposal. Arrowheads, complex routes and uncertain or layered backgrounds remain unknown. [Highlight PR #98](https://github.com/SUaDtL/Meridian/pull/98) · [Highlight evidence](https://github.com/SUaDtL/Meridian/actions/runs/44847858079) · [Stroke PR #102](https://github.com/SUaDtL/Meridian/pull/102) · [Stroke evidence](https://github.com/SUaDtL/Meridian/actions/runs/44850025378)
- Terraform inventory accepts numeric resource and module instances. Scope uses exact addresses and provenance locations. Labels use full-width bracket characters because the pinned renderer changes ASCII bracket entities in these labels. Relationships require a verified configuration address, and the importer discloses missing outgoing coverage. String instance keys and raw values remain outside the extracted facts. [PR #97](https://github.com/SUaDtL/Meridian/pull/97) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44847519448)

## Verified nested components and review recovery

- Supported nested component definitions create verified projects and insert into grouped diagrams. Chromium inserts one definition twice, checks distinct identities, and restores the exact prior source with Undo. Reviewed extraction includes descendants of explicitly selected groups and keeps contextual ancestor containers free of unselected siblings. This advances F04 containment, reuse, and extraction. [Insertion PR #108](https://github.com/SUaDtL/Meridian/pull/108) · [Insertion evidence](https://github.com/SUaDtL/Meridian/actions/runs/44852919448) · [Extraction PR #112](https://github.com/SUaDtL/Meridian/pull/112) · [Extraction evidence](https://github.com/SUaDtL/Meridian/actions/runs/44854478686)
- Authors can reorder the two decision rows by keyboard. Chromium verifies that the previously prepared candidate and authored connections retain their order and that Undo restores the exact original. This advances the decision review portion of F07. [PR #109](https://github.com/SUaDtL/Meridian/pull/109) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44852963103)
- The offline assistant scope disclosure reports the measured solid, dashed, or dotted style for each shared connection. Chromium checks that reviewed parallel connections retain their separate styles, labels, and write permissions in the request. This advances F08 local disclosure. [PR #110](https://github.com/SUaDtL/Meridian/pull/110) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44853325761)
- JSON Schema scope review can save and resume bounded normalized facts, physical provenance, and reviewed choices. Chromium verifies that required-property facts and unresolved placeholder choices survive reload, raw input is absent from the checkpoint, and successful creation removes it. This advances F11 draft recovery. [PR #111](https://github.com/SUaDtL/Meridian/pull/111) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44854478908)
- Authors can cancel an in-flight layout or design preview, retain the selected option, and try again. Comparative crossing copy distinguishes equal measured counts from incomplete coverage and reports smaller measured text when supported. Chromium verifies cancellation with controlled pending work and exact Undo after retry. This advances F06 comparison and lifecycle handling. [PR #113](https://github.com/SUaDtL/Meridian/pull/113) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44854763000)

## Verified source, presentation, and file review controls

- In supported grouped flowcharts, Outline locates the exact group declaration and member label. Authors can preview a rename of a member or explicit connection with the existing label already filled in. Chromium verifies nested containment, indexed styles, stable identities, BOM and CRLF source, and exact Undo. Switching actions or targets resolves an unsaved label through reviewed Save or Discard. This advances F07 VB01 and VB03 and F09 PX06. [Source locations #114](https://github.com/SUaDtL/Meridian/pull/114) · [Labels #115](https://github.com/SUaDtL/Meridian/pull/115) · [Integration repair #120](https://github.com/SUaDtL/Meridian/pull/120) · [Draft transitions #121](https://github.com/SUaDtL/Meridian/pull/121)
- Generated and saved story previews use the shared runtime with keyboard Previous and Next, scene position and title announcements, explicit Play and Pause, and settled navigation. Chromium verifies unchanged selected visibility, focus at scene boundaries, and offline playback. This advances F05 preview controls. [PR #116](https://github.com/SUaDtL/Meridian/pull/116) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44855792695)
- The offline assistant request can explicitly authorize removing a writable node and its complete set of writable incident connections. The import validator checks request scope, and the current Mermaid source proves exact incidence. Chromium rejects omitted or unauthorized connections and verifies annotation retention and exact Undo. This advances F08 AI02 and AI09. [PR #118](https://github.com/SUaDtL/Meridian/pull/118) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44856413196)
- Scatter review and exported HTML report coincident points across series. The table preserves clipped observations and their overlap counts. Chromium requires explicit filtering above 500 line and 2,000 scatter observations and verifies every mark at the caps. A local warm Chromium run with 30 samples per fixture and profile recorded p95 review-to-paint of 90.2 ms and 101.3 ms on the desktop profile, and 135.0 ms and 488.7 ms at 4× CPU throttling with a 390 × 844 viewport. The full lab conditions and ranges are on the PR. This advances F10 and G07. [PR #119](https://github.com/SUaDtL/Meridian/pull/119) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44856860042)
- OpenAPI operation drafts retain selected facts, reviewed labels, tags in source order, exact source locations, and omitted coverage counts. Chromium verifies reopen without the input file, precise tag provenance, and successful cleanup. The architecture records the closed extension to the local draft shape. This advances F11 IM05 and IM08. [PR #122](https://github.com/SUaDtL/Meridian/pull/122) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44858377261)
- Readability keeps the chosen viewing profile in the active project session and displays the unrounded measured text ratio. Dismissal keys bind to measured paint, so an unrelated title change keeps the dismissal and a paint change at the same ratio triggers a new finding. This advances F02 QC09 and the session dismissal requirement. [PR #123](https://github.com/SUaDtL/Meridian/pull/123) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44858440984)

## Layout preview timing and verified authoring updates

- The three explicit layout options were exercised on ten distinct warm-module diagrams per profile, with 50 nodes and 75 edges each. The production artifact was `1acdb5065dc0f3478e75e2fe1ef98e3c50fd63bc`. Chromium 159.0.8154.6 ran on an AMD EPYC 9V74 host with a four-core cgroup quota and 16 GiB limit. The desktop viewport was 1280 × 900. The mobile viewport was 390 × 844 at 4× CPU throttling. A real click or tap began each review. The sample ended two animation frames after the proposed image made Apply available. One complete fixture warmed up each profile before measurements.
- The desktop profile recorded 483 ms p95 across 30 candidates. Its first warm candidate took at most 478 ms. The longest sum of three sequential review times was 1.35 s. Its longest observed task was 309 ms.
- The mobile profile recorded 2.09 s p95 across 30 candidates. Its first warm candidate took at most 2.01 s. The longest sum of three sequential review times was 6.22 s. Its longest observed task was 1.65 s.
- A second run with other local Chromium suites active reproduced the gate failures. It recorded 860 ms desktop and 2.81 s mobile p95. The longest task was 578 ms on desktop and 2.78 s on mobile.
- Both profiles exceeded the 100 ms automatic preview blocking limit. The mobile profile also exceeded the 1.5 s first-candidate and 4 s three-candidate targets. Layout review continues to require explicit activation. Separate phase timings and physical mobile measurements remain open for G04. The layout memory and ordinary input sections record additional measured evidence.
- Build Pages from a clean checkout and serve its `site` directory. Run the lab with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173/ node scripts/measure-layout-review.mjs`. The script reads the build manifest, records host and device profiles, and emits individual candidates as JSON.
- Chart review lets authors explicitly exclude a column when a valid data file expands past the stored dataset ceiling. The verified fixture preserves all 760 rows after column reduction. [PR #124](https://github.com/SUaDtL/Meridian/pull/124)
- Outline can frame a current element or the entire selection, including hidden elements. Ungroup promotes a reviewed nested container's members without altering their identities. A reviewed node move preserves its authored declaration, connections and indexed styles, and restores exact source with Undo. [Framing PR #125](https://github.com/SUaDtL/Meridian/pull/125) · [Ungroup PR #128](https://github.com/SUaDtL/Meridian/pull/128) · [Move PR #130](https://github.com/SUaDtL/Meridian/pull/130)
- Closing an in-flight engineering preview aborts the outstanding work and retains the normalized selected scope. The Chromium fixture held a production Mermaid module request and reopened the saved scope after reload. [PR #127](https://github.com/SUaDtL/Meridian/pull/127)
- The offline assistant exchange permits one solid connection between current nodes when a writable node and its second endpoint have explicit authorization. A read-only attachment grants permission for the connection only. The preview, Apply and Undo use the pinned source proof and local request matching. [PR #129](https://github.com/SUaDtL/Meridian/pull/129)
- The OpenAPI 3.1 importer resolves static anchors and registered logical IDs declared on supported supplied components. Cyclic references produce declared edges without expanding the target, making external requests, or retaining the logical URLs. [PR #131](https://github.com/SUaDtL/Meridian/pull/131)
- Small-screen story review opens a separate canvas for the selected scene. Playback starts only on request. Returning restores the originating scene control, and Escape closes only the canvas. [PR #132](https://github.com/SUaDtL/Meridian/pull/132)

## Verified recovery, chart tables, and Outline return

- Process and manual systems creation can download a normalized draft after a storage failure and continue through creation. Process drafts omit raw paste. Manual systems drafts retain authored text, roles, shapes and reviewed directions. [PR #134](https://github.com/SUaDtL/Meridian/pull/134) · [Published workflow](https://github.com/SUaDtL/Meridian/actions/runs/44864674531)
- A reviewed nested deletion inventories descendants, direct container links, scene annotations and the exact indexed-style changes. Chromium confirms exact source, identities, cancellation and Undo. [PR #135](https://github.com/SUaDtL/Meridian/pull/135)
- Offline assistant exchange accepts one explicitly enabled standalone node. Its read-only context remains bound to the reviewed request, and the Chromium fixture refuses a context rename, verifies exact Apply and Undo, and checks request consumption. The dedicated service still requires operator and deployment decisions. [PR #136](https://github.com/SUaDtL/Meridian/pull/136)
- The chart table identifies each observation through a row header and retains measurement units. Count aggregations use counts. Chromium compares the accessible title, description, row context and the exact measure in studio and portable HTML. Physical screen-reader validation remains open. [PR #139](https://github.com/SUaDtL/Meridian/pull/139) · [Workflow evidence](https://github.com/SUaDtL/Meridian/actions/runs/44865281885)
- Jumping from a reviewed relationship to source can return to the same filtered Outline view while the authored source is current. Chromium verifies the exact relationship, active focus, selection and filter after a switch to phone width. [PR #133](https://github.com/SUaDtL/Meridian/pull/133)

## Layout preview memory lifecycle

The memory run used the same 50-node, 75-connection diagrams as the responsiveness run, with three explicitly requested choices per fixture. The production application source was at `054cfff51deb7c35d0f9845c41e8436aa17ae398`. Its clean lab artifact was built from `7b472506e431fedcc62c53ec99e666c75e8f640b`, which adds instrumentation only. Chromium 159.0.8154.6 ran on an AMD EPYC 9V74 host with a four-core CPU quota and 16 GiB memory ceiling. The profiles were 1280 × 900 desktop and 390 × 844 mobile with 4× CPU throttling.

One warm fixture preceded ten distinct projects per profile. Chromium reported the counts below after forced garbage collection. The baseline was after migration and before the first workspace opened. A mutation observer saw at most one connected measurement host in either profile and up to 1,067 descendant elements in an observed host.

| Profile and state | Live JS heap in decimal MB | Page-wide DOM nodes | Documents |
| --- | --- | --- | --- |
| Desktop baseline | 3.44 | 317 | 2 |
| Desktop settled review | 18.96–20.88 | 7,004–9,786 | 5 |
| Desktop after closing project | 19.23–20.95 | 4,837–7,162 | 3 |
| Throttled mobile baseline | 3.63 | 318 | 2 |
| Throttled mobile settled review | 19.01–20.92 | 7,004–9,786 | 5 |
| Throttled mobile after closing project | 18.70–20.61 | 4,837–7,162 | 3 |

Closing the workspace reduced documents and node counts. Later projects retained more DOM nodes than early projects after closure. These browser-wide counters do not separate renderer caches from page and browser state. Longer churn, exact aggregate string accounting, native memory, physical mobile devices and injected input response remain open. The instrumented timing samples are excluded from the automatic-preview gate.

Run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173/ node scripts/measure-layout-review.mjs --memory` against a clean Pages artifact. The JSON includes per-fixture active and closed samples alongside the browser and host profile.
