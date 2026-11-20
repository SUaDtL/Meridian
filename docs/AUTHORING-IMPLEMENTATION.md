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

Each row applies to every listed story. Module paths are relative to `src/`. Names in italics describe planned module responsibilities. PR labels indicate review order within the documented milestone, subject to the listed gates and dependencies.

| Track and status | Story IDs | Prerequisites | Source modules | Planned review |
| --- | --- | --- | --- | --- |
| F00 Shared commands and source identity · In Progress | FN01, FN02, FN03, FN04, FN05, FN06, FN07, FN08, FN09, FN10, FN11, FN12 | D01–D05; pinned render and legacy fixtures | `lib/authoring/`, `lib/workspace.ts`, `components/SourceEditor.tsx`, `lib/render.ts`, `lib/storyboard-runtime.ts`; *typed operation registry and target table* | M0 token/history/source proof, proposals, identity projection |
| F00c Persistence, migration and recovery · Not Started | PS01, PS02, PS03, PS04, PS05, PS06, PS07, PS08 | F00a snapshots; F00b identity migration | `hooks/useWorkspace.ts`, `lib/storage.ts`; *IndexedDB saves, migration and drafts* | M0 durable save and migration |
| F01 Smart Create · Not Started | SC-01, SC-02, SC-03, SC-04, SC-05, SC-06, SC-07, SC-08, SC-09 | F00a; F00b writer/IDs; F00c projects and drafts | `App.tsx`, `components/Home.tsx`, `lib/authoring/`; *wizard, rows and draft checkpoints* | M1 guided creation and review |
| F09 Productivity · Not Started | PX01, PX02, PX03, PX04, PX05, PX06, PX07, PX08 | F00a registry, F00b source and durable IDs | `Studio.tsx`, `components/SourceEditor.tsx`; *command search, outline, snippets and bulk actions* | M1 search and outline, M3 bulk actions |
| F07 Visual Builder · Not Started | VB01, VB02, VB03, VB04, VB05, VB06, VB07, VB08, VB09, VB10, VB11, VB12 | F00a/b/c, identity parity and mixed history | `Studio.tsx`, `components/DiagramStage.tsx`, `lib/authoring/`; *structure actions and review* | M1 Add/Rename/Connect, M3 grouping/removal |
| F02 Quality Coach · Not Started | QC-09, QC-10, QC-11, QC-12, QC-13, QC-14, QC-15 | F00a shared render and style; F00b for structural fixes | `lib/design.ts`, `lib/render.ts`; *quality rules and fixes* | M2 local checks, M3 broader fixes |
| F03 Design Director · Not Started | DD-01, DD-02, DD-03, DD-04, DD-05, DD-06, DD-07, DD-08 | F00a preview coordinator; F00b stable targets | `lib/design.ts`, `lib/render-cache.ts`; *recipes and scoped comparisons* | M2 design previews |
| F06 Layout assistance · Not Started | LY01, LY02, LY03, LY04, LY05, LY06, LY07, LY08 | F00a previews and measurements; F00b direction patch | `lib/render.ts`, `lib/render-queue.ts`; *layout metrics and candidate review* | M2 layout comparison |
| F04 Components and libraries · Not Started | CP-01, CP-02, CP-03, CP-04, CP-05, CP-06, CP-07, CP-08, CP-09, CP-10 | F00a atomic proposal; F00b source/identity; F00c library | `lib/authoring/`, `lib/storage.ts`; *component manifests, parameters and ports* | M3 component definition and insertion |
| F05 Automatic stories · Not Started | AS-01, AS-02, AS-03, AS-04, AS-05, AS-06, AS-07, AS-08, AS-09 | F00a one transaction; F00b typed targets; F00c persistence | `lib/storyboard.ts`, `lib/storyboard-runtime.ts`, `lib/export.ts`; *story generation and visibility closure* | M3 story generation |
| F10 Quantitative charts · Not Started | CH01, CH02, CH03, CH04, CH05, CH06, CH07, CH08, CH09 | F00a/c shared shell; exact-number and rendering proof | `lib/storage.ts`, `lib/export.ts`; *typed dataset, transforms and chart renderer* | M4 chart model and marks |
| F11 Engineering imports · Not Started | IM01, IM02, IM03, IM04, IM05, IM06, IM07, IM08 | F00a/b/c; bounded local readers and resolver | `App.tsx`, `lib/authoring/`; *typed readers, resolver and fact mapping* | M4 one PR per import adapter |
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
