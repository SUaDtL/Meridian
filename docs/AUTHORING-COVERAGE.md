# Meridian acceptance coverage

This checkpoint maps all 118 IDs in the design package’s `final/stories/backlog.csv` to the repository at `ec5591bc51cbe09f55debeafeacd784176a84b8c`. The [implementation ledger](AUTHORING-IMPLEMENTATION.md) records the merged scopes and workflow evidence. Each section gives the dependencies and next independently reviewable work for its stories.

**Scoped evidence** (113) means the current checks exercise the scope described in the row. **Partial** (1) has implementation or evidence with a stated gap. **Open** (0) requires the stated local capability. **Operator gate** (4) needs a separately approved companion or pilot. Shared release gates require the aggregate evidence defined in the design package.

G01 covers source preservation, G02 identity and rendering parity, G03 transactions and recovery, G04 responsiveness and memory, G05 accessibility and usability, G06 portable artifacts, G07 chart accuracy, G08 bounded local imports and G09 assistant operation.

G04 has desktop Chromium and throttled phone-viewport measurements, including render ownership, injected input and renderer memory. The 10- and 50-node fixtures met the 100 ms p95 ordinary-input budget and two larger-graph selection runs exceeded it. Physical mobile measurements remain open. G05 has automated keyboard, touch, focus, reduced-motion and chart semantics checks. Named desktop and phone screen-reader sessions and the formative study remain open. G09 has scoped local evidence through the browser, HTTP interface, SQLite and provider fixture. Operating identity, hosting, provider, spend, retention and incident evidence belong to the separately approved pilot. [Performance report](PERFORMANCE.md) · [Manual acceptance sessions](USABILITY.md#manual-acceptance-sessions)

## F00 Authoring foundation

F00a commands and render ownership, F00b exact source proof and identity, F00c durable recovery.

Keep proposal-aware source commands and portable parity checks independently reviewable.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| FN01 | Base token and stale proposal | G01, G02, G03, G06 | Scoped evidence | [base-token.test.ts](../src/lib/authoring/base-token.test.ts), [proposals.test.ts](../src/lib/authoring/proposals.test.ts) | Cross-tab fixtures use the full authored-state digest. |
| FN02 | Exact source and Unicode | G01, G02, G03, G06 | Scoped evidence | [base-token.test.ts](../src/lib/authoring/base-token.test.ts), [portable-boundaries.spec.ts](../tests/browser/portable-boundaries.spec.ts) | Canonical vectors cover BOM, CRLF, paired and unmatched Unicode and escaped strings. Chromium reimports identical project bytes and explains why plain UTF-8 cannot preserve unmatched code units. |
| FN03 | Invalid source and stale canvas | G01, G02, G03, G06 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts) | The editor retains invalid input and leaves accepted bytes and bindings intact. |
| FN04 | Candidate and post-commit failure | G01, G02, G03, G06 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts), [V3ProjectSession.tsx](../src/components/V3ProjectSession.tsx) | Injected candidate SVG failure leaves accepted bytes and history intact. An accepted image decode failure keeps its project downloadable and undoable, then retries the current drawing. |
| FN05 | Interleaved project history and IME | G01, G02, G03, G06 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts) | Chromium composes Japanese text, reviews a visual rename and a style recipe, then verifies exact Undo and Redo in document order. |
| FN06 | Retirement and source ID reuse | G01, G02, G03, G06 | Scoped evidence | [remove-connection.spec.ts](../tests/browser/remove-connection.spec.ts), [retire-elements.ts](../src/lib/authoring/retire-elements.ts) | Visual deletion followed by source-ID reuse creates a fresh UUID. The old style and scene stay unresolved until Undo restores their exact prior state. |
| FN07 | Migrated story parity | G01, G02, G03, G06 | Scoped evidence | [migrate-legacy-project.test.ts](../src/lib/authoring/migrate-legacy-project.test.ts), [group-story.spec.ts](../tests/browser/group-story.spec.ts) | A migrated directional story uses the same camera viewBox, highlight, visibility and one-way or bidirectional paths in studio and HTTP-blocked HTML. |
| FN08 | Save races and history | G01, G02, G03, G06 | Scoped evidence | [flowchart-proof.spec.ts](../tests/browser/flowchart-proof.spec.ts), [project-save-queue.test.ts](../src/lib/persistence/project-save-queue.test.ts) | A paused IndexedDB transaction, later edits and Undo save the newest revision without a false Saved status. A stale tab keeps its local work and reopening returns the authoritative project. |
| FN09 | Annotation overflow and recovery | G01, G02, G03, G06 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts), [source-recovery.test.ts](../src/lib/authoring/source-recovery.test.ts) | The 500-annotation fixture verifies exact recovery export, reimport after reload, altered bundle refusal and separate reviewed cleanup. |
| FN10 | Closed proposal and exact writes | G01, G02, G03, G06 | Scoped evidence | [proposals.test.ts](../src/lib/authoring/proposals.test.ts), [assist-exchange.spec.ts](../tests/browser/assist-exchange.spec.ts) | Chromium verifies zero render hosts for unsafe duplicate or unknown fields, forged readiness and impact, conflicting writes, scope violations and stale metadata. A valid candidate renders and Undo restores the exact project. |
| FN11 | Portable acceptance bound | G01, G02, G03, G06 | Scoped evidence | [portable-boundaries.spec.ts](../tests/browser/portable-boundaries.spec.ts) | Chromium accepts and reimports the exact maximum Mermaid project and chart dataset, and refuses one extra byte in each input. |
| FN12 | Worker and hostile-source recovery | G01, G02, G03, G06 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts), [authoring-worker.ts](../src/lib/authoring/authoring-worker.ts) | Hosted and offline Chromium terminate a timed-out worker, retry with a fresh worker, and review malformed and resource-bearing drafts. No remote request, authored change, or Undo entry occurs. |

## F00c Persistence and security

F00a authored snapshots and F00b stable identity.

Verify the IndexedDB migration and write-failure matrix before broader default migration.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| PS01 | Latest state under slow saves | G03, G06, G08 | Scoped evidence | [project-save-queue.test.ts](../src/lib/persistence/project-save-queue.test.ts) | Queue tests cover stale captured writes. |
| PS02 | Cross-tab exact state | G03, G06, G08 | Scoped evidence | [base-token.test.ts](../src/lib/authoring/base-token.test.ts), [workspace-migration-review.spec.ts](../tests/browser/workspace-migration-review.spec.ts) | The authored digest and durable anchor are separate checks. |
| PS03 | Interrupted migration boundaries | G03, G06, G08 | Scoped evidence | [workspace-migration-review.spec.ts](../tests/browser/workspace-migration-review.spec.ts), [workspace-migration.ts](../src/lib/persistence/workspace-migration.ts) | An actual IndexedDB abort at each of four write boundaries preserves the exact legacy backup. Retry commits both projects, recovery metadata and the active pointer. |
| PS04 | Quota and blocked upgrade recovery | G03, G06, G08 | Scoped evidence | [workspace-migration-review.spec.ts](../tests/browser/workspace-migration-review.spec.ts), [guided-systems.spec.ts](../tests/browser/guided-systems.spec.ts) | Quota and real blocked-version tests keep the exact legacy download available. Closing the old connection permits retry and preserves a pre-existing v3 project. |
| PS05 | Network-free migrated animation | G03, G06, G08 | Scoped evidence | [migrate-legacy-project.test.ts](../src/lib/authoring/migrate-legacy-project.test.ts), [group-story.spec.ts](../tests/browser/group-story.spec.ts) | The migrated story’s actual downloaded HTML preserves camera and directional playback with HTTP requests blocked. |
| PS06 | Maximum materialized export | G03, G06, G08 | Scoped evidence | [portable-boundaries.spec.ts](../tests/browser/portable-boundaries.spec.ts) | A fresh browser reopens the 2,000,000-byte Unicode Mermaid project and the 1,500,000-byte dataset with 10,000 rows and 100,000 cells. |
| PS07 | Allowlisted retained input | G03, G06, G08 | Scoped evidence | [Browser retention helper](../tests/browser/helpers.ts), [PR #212](https://github.com/SUaDtL/Meridian/pull/212) | The seven guided, engineering, chart and assistant browser fixtures inspect the actual workspace stores for disallowed inputs and check that pending assistant records omit instructions and graph contents. |
| PS08 | Termination before durability | G03, G06, G08 | Scoped evidence | [project-save-queue.test.ts](../src/lib/persistence/project-save-queue.test.ts), [workspace-migration-review.spec.ts](../tests/browser/workspace-migration-review.spec.ts) | Closing Chromium with its IndexedDB transaction still open preserves the exact last completed project on reopen. |

## F01 Smart Create

F00a review, F00b canonical writer and F00c draft persistence.

Verify complete process and systems tasks, then exact draft and expiry handling.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| SC-01 | Five-step independent creation | G01, G03, G05, G06 | Scoped evidence | [guided-process.spec.ts](../tests/browser/guided-process.spec.ts) | Browser fixture verifies five labels, four relationships and the download. |
| SC-02 | Explicit decision paths | G01, G03, G05, G06 | Scoped evidence | [guided-process.spec.ts](../tests/browser/guided-process.spec.ts) | The branch review requires explicit choices and excludes an unintended cross-branch link. |
| SC-03 | Duplicate system labels | G01, G03, G05, G06 | Scoped evidence | [guided-relationship-table.spec.ts](../tests/browser/guided-relationship-table.spec.ts), [guided-systems.spec.ts](../tests/browser/guided-systems.spec.ts) | Browser fixtures verify distinct bindings and portable output. |
| SC-04 | Wizard target changes | G01, G03, G05, G06 | Scoped evidence | [Systems](../tests/browser/guided-systems.spec.ts), [Process](../tests/browser/guided-process.spec.ts), [Relationship table](../tests/browser/guided-relationship-table.spec.ts) | A second tab makes reviewed systems, process and relationship-table insertions stale. Each keeps its draft and explicit attachment, requires review against the current target and applies with one exact Undo. |
| SC-05 | Checkpoint restoration | G01, G03, G05, G06 | Scoped evidence | [guided-process.spec.ts](../tests/browser/guided-process.spec.ts), [guided-systems.spec.ts](../tests/browser/guided-systems.spec.ts), [guided-relationship-table.spec.ts](../tests/browser/guided-relationship-table.spec.ts) | After reload, each wizard restores the reviewed values and announces the original saved and expiry times. Each checkpoint has the exact seven-day interval. |
| SC-06 | No-drag authoring parity | G01, G03, G05, G06 | Scoped evidence | [guided-process.spec.ts](../tests/browser/guided-process.spec.ts) | Keyboard actions and touch emulation review branches, reorder steps and join both outcomes with the same accepted source. Headless native select values are supplied for the emulated touch case. |
| SC-07 | Literal label fidelity | G01, G03, G05, G06 | Scoped evidence | [guided-process.spec.ts](../tests/browser/guided-process.spec.ts), [flowchart-source.test.ts](../src/lib/authoring/flowchart-source.test.ts) | An unrenderable literal retains the input and blocks creation. |
| SC-08 | Unmapped CSV retention | G01, G03, G05, G06 | Scoped evidence | [GuidedRelationshipTableDialog.tsx](../src/components/GuidedRelationshipTableDialog.tsx), [guided-relationship-table.spec.ts](../tests/browser/guided-relationship-table.spec.ts) | The reviewed relationship-table flow checks IndexedDB and local storage. Unmapped cells are absent after the wizard closes and after accepted insertion. |
| SC-09 | Terminal branch recovery | G01, G03, G05, G06 | Scoped evidence | [guided-process.spec.ts](../tests/browser/guided-process.spec.ts) | The resumed decision fixture preserves reviewed choices and branch endpoints. |

## F02 Quality Coach

F00a shared render and measurements, plus shared style resolution.

Extend measured coverage and reversible fixes where the renderer proves the result.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| QC-09 | Exact contrast and reversible fix | G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts) | Browser fixtures cover exact measured color, focus and Apply with Undo. |
| QC-10 | Unknown gradient contrast | G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts) | The measured report identifies a gradient node as unmeasured. |
| QC-11 | Viewing profile and PNG density | G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts), [ExportDialog.tsx](../src/components/ExportDialog.tsx) | The real 1× and 2× PNG downloads differ in raster dimensions. The same 125 CSS pixel document profile reports identical label findings. |
| QC-12 | Separate regions | G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts) | The check discloses both regions without modifying the source. |
| QC-13 | Relevant style dismissal | G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts), [ReadabilityDialog.tsx](../src/components/ReadabilityDialog.tsx) | Dismissing a measured role-paint finding survives a heading edit. A newly measured override reopens it. |
| QC-14 | Partial measurement budget | G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts) | The review exposes the segment and pair caps. Chromium forces both worker deadlines and verifies that the result asks for narrower input. |
| QC-15 | Crossing and text-size tradeoff | G04, G05, G06 | Scoped evidence | [layout-alternatives.spec.ts](../tests/browser/layout-alternatives.spec.ts) | The real layout fixture shows two fewer proper crossings and a smaller minimum viewed label. The comparison presents both measurements. |

## F03 Design Director

F00a preview coordinator, stable identity and shared style ownership.

Separate typography and presentation shape review from scoped paint and scheduler fixtures.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| DD-01 | Preserve explicit overrides | G03, G04, G05, G06 | Scoped evidence | [design-recipes.spec.ts](../tests/browser/design-recipes.spec.ts) | Preview and portable state preserve the scoped user paint override. |
| DD-02 | Scoped global settings | G03, G04, G05, G06 | Scoped evidence | [design-recipes.spec.ts](../tests/browser/design-recipes.spec.ts) | Browser checks reviewed scope and unchanged settings. |
| DD-03 | Typography and external layout movement | G03, G04, G05, G06 | Scoped evidence | [design-recipes.ts](../src/lib/authoring/design-recipes.ts), [design-recipes.spec.ts](../tests/browser/design-recipes.spec.ts) | A reviewed Presentation label-size change targets selected or role-matched nodes, preserves manual font choices, and reports measured movement outside the scope. |
| DD-04 | Foreground supersedes design previews | G03, G04, G05, G06 | Scoped evidence | [render.ts](../src/lib/render.ts), [render.test.ts](../src/lib/render.test.ts) | Deterministic renderer tests cover foreground replacement of queued optional work, promotion of a matching request, and optional cache hits during foreground work. |
| DD-05 | Failure stays scoped to a card | G03, G04, G05, G06 | Scoped evidence | [V3ComparisonDialog.tsx](../src/components/V3ComparisonDialog.tsx), [design-recipes.spec.ts](../tests/browser/design-recipes.spec.ts) | An injected Presentation render failure preserves the previously validated Clear drawing and its independent Apply and Undo. |
| DD-06 | Presentation shape fidelity | G03, G04, G05, G06 | Scoped evidence | [design-recipes.spec.ts](../tests/browser/design-recipes.spec.ts), [presentation-role-shape.ts](../src/lib/authoring/presentation-role-shape.ts) | The opt-in Decision diamond persists in the project and offline HTML. Scope includes the diagram, selected elements or one role. Exact Mermaid source, protected overrides and unselected nodes remain as reviewed. |
| DD-07 | Undo restores recipe and overrides | G03, G04, G05, G06 | Scoped evidence | [design-recipes.spec.ts](../tests/browser/design-recipes.spec.ts) | The scope fixture verifies exact user and recipe layer restoration. |
| DD-08 | Recipe dependency digest | G03, G04, G05, G06 | Scoped evidence | [project-editor-design.test.ts](../src/lib/authoring/project-editor-design.test.ts) | Changing recipe content at the same version invalidates Apply until the refreshed candidate is reviewed. |

## F04 Components

F00a atomic review, F00b group and insertion proof, F00c local library.

Cover exact portable attachment parity, library limits and recovery.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| CP-01 | Repeat insertion distinct identities | G01, G02, G03, G06, G08 | Scoped evidence | [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts) | The nested fixture inserts twice and preserves individual bindings and Undo. |
| CP-02 | Explicit attachment and round-trip | G01, G02, G03, G06, G08 | Scoped evidence | [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts) | A fresh browser imports the exact downloaded project, confirms the explicit attachment ID, and opens the unchanged source span and edge direction. |
| CP-03 | Conflicting definition import | G01, G02, G03, G06, G08 | Scoped evidence | [component-project.spec.ts](../tests/browser/component-project.spec.ts), [component-library.ts](../src/lib/persistence/component-library.ts) | An explicit copy creates a different UUID. Reviewed replacement changes only the original definition, and both portable downloads retain their exact contents after reload. |
| CP-04 | Unsupported extraction footprint | G01, G02, G03, G06, G08 | Scoped evidence | [component-selection.spec.ts](../tests/browser/component-selection.spec.ts) | An unsupported selected reference disables Save as component, links to the exact source, and preserves the exported project. |
| CP-05 | Quota and definition download | G01, G02, G03, G06, G08 | Scoped evidence | [component-selection.spec.ts](../tests/browser/component-selection.spec.ts), [SaveComponentDialog.tsx](../src/components/SaveComponentDialog.tsx) | A real IndexedDB quota failure leaves the reviewed definition downloadable and the library absent from the success state. |
| CP-06 | Parameter retention | G01, G02, G03, G06, G08 | Scoped evidence | [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts) | After the inserted label is edited, the exported instance keeps its definition and bindings. Its prior parameter value is absent. |
| CP-07 | Retired attachment target | G01, G02, G03, G06, G08 | Scoped evidence | [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts) | Another tab removes a target and reuses its Mermaid ID. The old UUID is refused and the new target must be explicitly selected. |
| CP-08 | Aggregate component caps | G01, G02, G03, G06, G08 | Scoped evidence | [component-project.spec.ts](../tests/browser/component-project.spec.ts), [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts), [component-library.ts](../src/lib/persistence/component-library.ts) | Fixtures exercise exact accepted and refused counts and byte ceilings for component packs, stored definitions, and the portable authored project. Refused data changes no accepted drawing. |
| CP-09 | Unanswered and unconnected ports | G01, G02, G03, G06, G08 | Scoped evidence | [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts) | Resumed fixture distinguishes unconnected and directed choices. |
| CP-10 | Definition dependency replacement | G01, G02, G03, G06, G08 | Scoped evidence | [component-insertion.spec.ts](../tests/browser/component-insertion.spec.ts) | An explicit same-version replacement invalidates an older prepared operation from another tab. |

## F05 Stories

F00a shared runtime, stable typed targets and visibility closure.

Finish migrated studio and portable parity and stale-target review fixtures.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| AS-01 | Ordered editable group scenes | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts) | The generated scenes keep reviewed order and saved scenes can be edited. |
| AS-02 | Explicit loop scenes | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts) | The selected return edge appears in a bounded scene review. |
| AS-03 | Append preserves manual scenes | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts) | The browser fixture checks original objects and exact Undo. |
| AS-04 | Reduced-motion playback | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts), [StoryPreviewPlayer.tsx](../src/components/StoryPreviewPlayer.tsx) | Studio and portable playback advance with reduced motion, use the settled camera, preserve intended visibility, and suppress moving flow. |
| AS-05 | Removed target invalidates preview | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts), [project-editor.ts](../src/lib/authoring/project-editor.ts) | Removing a path target in another tab after preview makes Apply refuse the old candidate. The working and saved projects remain exact with no extra Undo. |
| AS-06 | Nested path ancestor visibility | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts), [path-story.ts](../src/lib/authoring/path-story.ts) | Coverage lists three nodes, three connections and two ancestor groups. Both studio and offline HTML show exactly those targets and leave the sibling hidden. |
| AS-07 | Migrated directional story parity | G02, G03, G05, G06 | Scoped evidence | [migrate-legacy-project.test.ts](../src/lib/authoring/migrate-legacy-project.test.ts), [group-story.spec.ts](../tests/browser/group-story.spec.ts) | The migrated Chromium fixture compares exact camera, visibility, highlight and directional animation in the studio and the downloaded HTTP-blocked presentation. |
| AS-08 | Old scene after source ID reuse | G02, G03, G05, G06 | Scoped evidence | [remove-connection.spec.ts](../tests/browser/remove-connection.spec.ts), [retire-elements.ts](../src/lib/authoring/retire-elements.ts) | Chromium verifies the named unresolved scene and retained style after ID reuse. Undo restores the existing identity, scene and camera exactly. |
| AS-09 | Resume ordered paths | G02, G03, G05, G06 | Scoped evidence | [group-story.spec.ts](../tests/browser/group-story.spec.ts) | The browser fixture resumes ordered paths and re-reviews the current revision. |

## F06 Layout assistance

F00a coordinated preview and shared measurements, plus F00b for direction.

Verify explicit candidate review and instrument phase, input and memory budgets.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| LY01 | Latest foreground render | G01, G04, G05, G06 | Scoped evidence | [render.test.ts](../src/lib/render.test.ts), [measure-layout-review.mjs](../scripts/measure-layout-review.mjs) | Three competing previews and two foreground revisions deliver only the latest foreground result with one queue owner. Both declared Chromium profiles observe one measurement host at a time. |
| LY02 | Unsupported direction capability | G01, G04, G05, G06 | Scoped evidence | [layout-alternatives.spec.ts](../tests/browser/layout-alternatives.spec.ts), [V3ComparisonDialog.tsx](../src/components/V3ComparisonDialog.tsx) | A grouped flowchart offers a safe candidate while direction remains disabled. A sequence diagram explains unavailable comparison and the accepted source stays exact. |
| LY03 | Stale preview and refresh | G01, G04, G05, G06 | Scoped evidence | [layout-alternatives.spec.ts](../tests/browser/layout-alternatives.spec.ts), [project-editor.ts](../src/lib/authoring/project-editor.ts) | A concurrent saved edit makes the open preview stale. Explicit refresh reads the current project, retains the selected alternative and direction, and supports exact Undo after fresh review. |
| LY04 | One explicit bounded option | G01, G04, G05, G06 | Scoped evidence | [V3ComparisonDialog.tsx](../src/components/V3ComparisonDialog.tsx), [measure-layout-review.mjs](../scripts/measure-layout-review.mjs) | Manual admission is active. Keep automatic generation gated on measured budgets. |
| LY05 | Aggregate cache and blob lifecycle | G01, G04, G05, G06 | Scoped evidence | [render-cache.ts](../src/lib/render-cache.ts), [layout-alternatives.spec.ts](../tests/browser/layout-alternatives.spec.ts), [measure-layout-review.mjs](../scripts/measure-layout-review.mjs) | The shared 32 MiB estimate covers retained layout and candidate data. Repeated close, cancellation and 30 measured fixtures record the renderer lifecycle, DOM, heap and native process PSS. Physical device memory remains open. |
| LY06 | Density-independent measurement | G01, G04, G05, G06 | Scoped evidence | [readability.spec.ts](../tests/browser/readability.spec.ts) | The 125 CSS pixel profile reports identical findings on the full and Outline-framed canvas while the 1× and 2× PNG dimensions differ as expected. |
| LY07 | Comparable evidence and unknown geometry | G01, G04, G05, G06 | Scoped evidence | [layout-alternatives.spec.ts](../tests/browser/layout-alternatives.spec.ts) | The layout and readability fixtures report partial geometry, equal evidence, and the measured crossing versus label-size tradeoff. |
| LY08 | Exact direction and settings Undo | G01, G04, G05, G06 | Scoped evidence | [layout-alternatives.spec.ts](../tests/browser/layout-alternatives.spec.ts), [project-editor.ts](../src/lib/authoring/project-editor.ts) | An accepted direction and layout use the same geometry in SVG and offline HTML. Undo restores the original settings and exact source. |

## F07 Visual builder

F00a transaction history, F00b source and identity proof, F00c storage and migration.

Land each remaining mutation with exact scope, cancellation and Undo fixtures.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| VB01 | Exact reviewed rename | G01, G02, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts), [flowchart-proof.test.ts](../src/lib/authoring/flowchart-proof.test.ts) | The grouped fixture verifies authored spans, bindings and exact Undo. |
| VB02 | Escape during validation | G01, G02, G03, G05 | Scoped evidence | [workspace-migration-review.spec.ts](../tests/browser/workspace-migration-review.spec.ts), [V3StructureEditor.tsx](../src/components/V3StructureEditor.tsx) | Escape closes a rename while structural validation is held. A focus change and released late candidate leave the portable project and history unchanged before and after reload. |
| VB03 | Resolve dirty rename first | G01, G02, G03, G05 | Scoped evidence | [workspace-migration-review.spec.ts](../tests/browser/workspace-migration-review.spec.ts), [V3StructureEditor.tsx](../src/components/V3StructureEditor.tsx) | A pending label can be kept, discarded or reviewed and saved before changing operations or projects. Reopening confirms the exact accepted source and an unchanged separate project. |
| VB04 | Keyboard and touch connection parity | G01, G02, G03, G05 | Scoped evidence | [edge-direction.spec.ts](../tests/browser/edge-direction.spec.ts), [command-search.spec.ts](../tests/browser/command-search.spec.ts) | The keyboard palette and phone-size touch fixture choose the same source ID among duplicate labels and produce identical connection bytes. Physical input and screen-reader gates remain. |
| VB05 | Decision display-only reorder | G01, G02, G03, G05 | Scoped evidence | [decision.spec.ts](../tests/browser/decision.spec.ts) | Reordering preserves the prepared connection topology and Undo. |
| VB06 | Indexed edge style preservation | G01, G02, G03, G05 | Scoped evidence | [remove-connection.spec.ts](../tests/browser/remove-connection.spec.ts), [source-patches.test.ts](../src/lib/authoring/source-patches.test.ts) | Verified indexed rewrites preserve surviving authored relationships. |
| VB07 | Unsupported deletion footprint | G01, G02, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts), [V3StructureEditor.tsx](../src/components/V3StructureEditor.tsx) | A deletion blocked by an incident connection names that connection and focuses the exact authored node span. The project download stays byte-identical. |
| VB08 | Hidden bulk scope | G01, G02, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts) | Verified counts and explicit subset eligibility keep hidden selections in scope. |
| VB09 | All-or-nothing group review | G01, G02, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts) | The mixed-selection fixture refuses partial grouping. |
| VB10 | Ungroup and distinct destructive action | G01, G02, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts) | Nested fixtures verify exact promotion and separately reviewed deletion. |
| VB11 | Hidden incidence and unresolved annotations | G01, G02, G03, G05 | Scoped evidence | [remove-connection.spec.ts](../tests/browser/remove-connection.spec.ts) | A filtered-out incident edge still appears by name in the node-deletion review. The original annotations and named scene are retained, and Undo restores the exact authored document. |
| VB12 | Rich labels in source | G01, G02, G03, G05 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts), [flowchart-proof.ts](../src/lib/authoring/flowchart-proof.ts) | Visual review refuses to replace existing long or Markdown labels. A reviewed source edit retains exact line endings and bindings. |

## F08 External assistant

F00a/b/c and the closed scope contract. Hosted operation also requires an approved independent service.

Implement remaining local operations separately from named-operator and pilot approval.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| AI01 | Network-free request export | G03, G08, G09 | Scoped evidence | [assist-exchange.spec.ts](../tests/browser/assist-exchange.spec.ts) | Offline request export leaves the current project unchanged. |
| AI02 | Readable and writable scope | G03, G08, G09 | Scoped evidence | [assist-exchange.spec.ts](../tests/browser/assist-exchange.spec.ts), [operations.test.ts](../src/lib/companion/operations.test.ts) | The browser and local companion validators refuse rename or deletion of context-only elements and changes to read-only boundary connections. Aggregated hosted G09 evidence is pending. |
| AI03 | One reservation and invocation | G03, G08, G09 | Operator gate | [generation.test.ts](../src/lib/companion/generation.test.ts), [companion-ui.spec.ts](../tests/browser/companion-ui.spec.ts) | The local reference binds signed issuance, permits one SQLite reservation and invokes the fixture provider once. Approved host and provider evidence is pending. |
| AI04 | Ticket age and replay boundaries | G03, G08, G09 | Scoped evidence | [generation.test.ts](../src/lib/companion/generation.test.ts), [issue-ticket.test.ts](../src/lib/companion/issue-ticket.test.ts) | The local HTTP and SQLite fixtures verify exact ticket expiry, the UUID age and skew limits, and content-free replay retention through the final eligible millisecond. The configured provider fixture receives zero calls. |
| AI05 | Stale authored state on import | G03, G08, G09 | Scoped evidence | [assist-exchange.spec.ts](../tests/browser/assist-exchange.spec.ts), [project-editor.ts](../src/lib/authoring/project-editor.ts) | Another tab changes the subtitle with identical source and numeric revision. Import checks the complete durable digest before rendering and leaves both project versions intact. |
| AI06 | Forged readiness and matching | G03, G08, G09 | Scoped evidence | [assist-exchange.spec.ts](../tests/browser/assist-exchange.spec.ts), [proposals.test.ts](../src/lib/authoring/proposals.test.ts) | Input is treated as an untrusted proposal requiring local validation and matching. |
| AI07 | Concurrent exact spend cap | G03, G08, G09 | Operator gate | [serial-admission.test.ts](../src/lib/companion/serial-admission.test.ts) | Independent local SQLite connections race the last subject and global allowance and verify atomic rollback. Recheck against the approved service accounting store. |
| AI08 | Uncertain provider submission | G03, G08, G09 | Operator gate | [generation.test.ts](../src/lib/companion/generation.test.ts), [companion-ui.spec.ts](../tests/browser/companion-ui.spec.ts) | The local ledger retains an uncertain charge and reports it through the API. Stopping the browser wait permits a read-only recovery check. The approved pilot needs submitted timeout and real status recovery evidence. |
| AI09 | Atomic Apply across authored state | G03, G08, G09 | Scoped evidence | [assist-exchange.spec.ts](../tests/browser/assist-exchange.spec.ts), [PR #220](https://github.com/SUaDtL/Meridian/pull/220) | Removing a reviewed connection updates active selection and keeps its orphan annotations. One Undo restores source, identities, styles, scenes and original Outline selection together. |
| AI10 | Mobile pilot value | G03, G08, G09 | Operator gate | — | Run approved expert pilot on named phones with measured manual comparison. |

## F09 Productivity

F00a command registry, stable IDs for targets and F00b for structural fixes.

Verify pending tasks across mobile panels, exact diagnostic fixes and mixed editor history.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| PX01 | Relevant command palette | G01, G03, G05 | Scoped evidence | [command-search.spec.ts](../tests/browser/command-search.spec.ts), [CommandPalette.tsx](../src/components/CommandPalette.tsx) | Local search and capability-aware commands use the common palette. |
| PX02 | Commands use guarded Connect | G01, G03, G05 | Scoped evidence | [command-search.spec.ts](../tests/browser/command-search.spec.ts), [edge-direction.spec.ts](../tests/browser/edge-direction.spec.ts) | The palette opens the normal connection review and shares the exact guard. |
| PX03 | Hidden selection disclosure | G01, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts) | Complete authored scope survives filters and disclosed eligibility. |
| PX04 | Completion in proven contexts | G01, G03, G05 | Scoped evidence | [source-suggestions.spec.ts](../tests/browser/source-suggestions.spec.ts), [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts) | Browser completion is withheld in comments, quoted labels and active Chromium IME composition. Committing Japanese text and using Undo or Redo affects one draft action. |
| PX05 | Stale diagnostic fix | G01, G03, G05 | Scoped evidence | [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts), [V3SourceEditor.tsx](../src/components/V3SourceEditor.tsx) | A parser-confirmed incomplete node offers one exact closing bracket. A stale draft refuses the repair, and a fresh repair passes normal source review with exact CRLF and Undo. |
| PX06 | Exact parallel source location | G01, G03, G05 | Scoped evidence | [project-outline.spec.ts](../tests/browser/project-outline.spec.ts) | The review disambiguates exact explicit source ranges and restores filtered Outline on return. |
| PX07 | Undo across source and canvas | G01, G03, G05 | Scoped evidence | [authoring-foundation.spec.ts](../tests/browser/authoring-foundation.spec.ts), [v3-source-editor.spec.ts](../tests/browser/v3-source-editor.spec.ts) | Undo a visual rename directly from source and redo an accepted source change. Exact source, caret and current Outline selection survive. |
| PX08 | Four mobile panels | G01, G03, G05 | Scoped evidence | [v3-mobile-panels.spec.ts](../tests/browser/v3-mobile-panels.spec.ts) | The mobile viewport switches all four panels during a held IndexedDB write. It preserves draft, focus, truthful save status and the exact accepted document while inactive controls remain inaccessible. |

## F10 Quantitative charts

F00a/c, a typed dataset and an exact local chart adapter.

Finish whole portable round trips and physical-device accessibility and responsiveness.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| CH01 | Exact sum and mean with missing values | G03, G05, G06, G07 | Scoped evidence | [chart-values.test.ts](../src/lib/authoring/chart-values.test.ts), [chart-project.spec.ts](../tests/browser/chart-project.spec.ts) | Unit and hosted fixtures cover exact decimal aggregation. |
| CH02 | All-missing aggregation | G03, G05, G06, G07 | Scoped evidence | [chart-values.test.ts](../src/lib/authoring/chart-values.test.ts) | Computed values preserve missing values and truthful observation counts. |
| CH03 | Date ordering and duplicates | G03, G05, G06, G07 | Scoped evidence | [chart-values.test.ts](../src/lib/authoring/chart-values.test.ts) | The typed chart layer enforces explicit aggregation for duplicates. |
| CH04 | Inspectable rational mean | G03, G05, G06, G07 | Scoped evidence | [chart-values.test.ts](../src/lib/authoring/chart-values.test.ts), [chart-project.spec.ts](../tests/browser/chart-project.spec.ts) | The exact rational is retained alongside the rendered decimal. |
| CH05 | Unrepresentable typed inputs | G03, G05, G06, G07 | Scoped evidence | [chart-input.test.ts](../src/lib/authoring/chart-input.test.ts), [chart-values.test.ts](../src/lib/authoring/chart-values.test.ts) | Fixtures cover explicit number and time formats and strict typed values. |
| CH06 | Clipping disclosures | G03, G05, G06, G07 | Scoped evidence | [chart-project.spec.ts](../tests/browser/chart-project.spec.ts) | Clipped observations remain inspectable in studio and exported data. |
| CH07 | Retained dataset cap | G03, G05, G06, G07 | Scoped evidence | [chart-project.spec.ts](../tests/browser/chart-project.spec.ts) | The browser fixture reduces data only after explicit column exclusion. |
| CH08 | Accessible table and units | G03, G05, G06, G07 | Partial | [chart-project.spec.ts](../tests/browser/chart-project.spec.ts), [Manual acceptance sessions](USABILITY.md#manual-acceptance-sessions) | A keyboard search in a 1,100-row fixture finds the same exact summed value, axes and units in studio and offline HTML. Run the named desktop and phone screen-reader fixture in the manual guide. |
| CH09 | Portable chart round-trip | G03, G05, G06, G07 | Scoped evidence | [chart-project.spec.ts](../tests/browser/chart-project.spec.ts), [chart-project.ts](../src/lib/authoring/chart-project.ts) | A fresh workspace imports the actual download and retains the exact ordered columns, rows, transforms, clipped values and decimal mean. |

## F11 Engineering imports

F00a/b/c, bounded local readers and local reference resolution.

Deliver corpus, coverage and retention evidence for each adapter independently.

| Story | Scope | Gates | Coverage | Current source and tests | Evidence or next work |
| --- | --- | --- | --- | --- | --- |
| IM01 | Distinct virtual file paths | G01, G06, G08 | Scoped evidence | [schema-import.spec.ts](../tests/browser/schema-import.spec.ts), [openapi-import.spec.ts](../tests/browser/openapi-import.spec.ts) | Review refuses colliding basenames before reference resolution. |
| IM02 | Bounded static logical references | G01, G06, G08 | Scoped evidence | [schema-facts.test.ts](../src/lib/authoring/schema-facts.test.ts), [schema-import.spec.ts](../tests/browser/schema-import.spec.ts) | Nested anchors and physical or absolute pointer aliases produce one canonical fact. Cycles, percent decoding, canonical array indices and unresolved local targets retain exact provenance with blocked network. |
| IM03 | Unsupported semantics disclosure | G01, G06, G08 | Scoped evidence | [schema-import.spec.ts](../tests/browser/schema-import.spec.ts), [openapi-import.spec.ts](../tests/browser/openapi-import.spec.ts), [terraform-import.spec.ts](../tests/browser/terraform-import.spec.ts) | Worker and review fixtures disclose unsupported dialects, dynamic semantics and exact unsupported locations with checked and unresolved counts. |
| IM04 | Sensitive input stays out of artifacts | G01, G06, G08 | Scoped evidence | [terraform-import.spec.ts](../tests/browser/terraform-import.spec.ts) | Browser fixtures check normalized drafts and exported projects for prohibited Terraform fields. |
| IM05 | Declared relationship provenance | G01, G06, G08 | Scoped evidence | [terraform-import.spec.ts](../tests/browser/terraform-import.spec.ts), [openapi-import.spec.ts](../tests/browser/openapi-import.spec.ts) | Browser review confirms path, pointer and declared relationship meaning. |
| IM06 | Independent re-import | G01, G06, G08 | Scoped evidence | [openapi-import.spec.ts](../tests/browser/openapi-import.spec.ts), [engineering-reimport.spec.ts](../tests/browser/engineering-reimport.spec.ts) | Each adapter imports changed input as an independent project with current source provenance. The earlier manually edited project is byte-identical on download. |
| IM07 | Malformed and excess work recovery | G01, G06, G08 | Scoped evidence | [openapi-import.spec.ts](../tests/browser/openapi-import.spec.ts), [schema-facts.test.ts](../src/lib/authoring/schema-facts.test.ts), [terraform-import.spec.ts](../tests/browser/terraform-import.spec.ts) | Negative fixtures cover malformed encodings, duplicate keys, YAML aliases, reference limits and over-budget scope. A fresh worker recovers from the timeout before an independent project is authored. |
| IM08 | Keyboard and touch scope review | G01, G06, G08 | Scoped evidence | [openapi-import.spec.ts](../tests/browser/openapi-import.spec.ts), [schema-import.spec.ts](../tests/browser/schema-import.spec.ts), [terraform-import.spec.ts](../tests/browser/terraform-import.spec.ts) | Six Chromium keyboard and touch scenarios keep exact hidden selections and checked counts, including Terraform reference toggles. |
